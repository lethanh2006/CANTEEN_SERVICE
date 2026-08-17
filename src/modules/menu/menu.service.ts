import {
  Injectable,
  OnModuleInit,
  BadRequestException,
  NotFoundException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Category, CategoryDocument } from '../../schemas/categories.schema';
import { MenuItem, MenuItemDocument } from '../../schemas/menu_items.schema';
import { CreateMenuItemDto } from './dto/create-menu-item.dto';
import { UpdateMenuItemDto } from './dto/update-menu-item.dto';
import { MenuHistoryManager } from './utils/undo-stack';
import { MenuSearchTrie } from './utils/menu-trie';

@Injectable()
export class MenuService implements OnModuleInit {
  private readonly menuTrie = new MenuSearchTrie();
  private readonly logger = new Logger(MenuService.name);

  constructor(
    @InjectModel(Category.name) private readonly categoryModel: Model<CategoryDocument>,
    @InjectModel(MenuItem.name) private readonly menuItemModel: Model<MenuItemDocument>,
    private readonly menuHistoryManager: MenuHistoryManager,
  ) {}

  /**
   * Hydrate in-memory Menu Trie on module startup
   */
  async onModuleInit() {
    await this.rebuildTrieIndex();
  }

  /**
   * Rebuild the Menu Search Trie index from MongoDB
   */
  async rebuildTrieIndex(): Promise<void> {
    try {
      const allItems = await this.menuItemModel.find({ isAvailable: true }).exec();
      this.menuTrie.clear();
      for (const item of allItems) {
        this.menuTrie.insert(item.name, item._id.toString());
      }
      this.logger.log(`Indexed ${allItems.length} menu items into in-memory Search Trie`);
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));

      this.logger.error(
        `Failed to build Menu Search Trie index: ${error.message}`,
        error.stack,
      );

      throw new InternalServerErrorException(
        'Không thể xây dựng lại chỉ mục tìm kiếm thực đơn',
      );
    }
  }

  /**
   * GET /api/canteen/menu/search?q=...
   * Fast real-time prefix search via RAM Trie
   */
  async searchMenuItems(query: string): Promise<MenuItem[]> {
    if (!query || !query.trim()) {
      return await this.menuItemModel.find({ isAvailable: true }).exec();
    }

    const matchedIds = this.menuTrie.searchPrefix(query);
    if (matchedIds.length === 0) {
      return [];
    }

    const objectIds = matchedIds.map((id) => new Types.ObjectId(id));
    return await this.menuItemModel.find({ _id: { $in: objectIds }, isAvailable: true }).exec();
  }

  /**
   * Lấy toàn bộ thực đơn đang bán (phân nhóm theo Category)
   */
  async getMenu(): Promise<any[]> {
    const categories = await this.categoryModel
      .find({ isActive: true })
      .sort({ displayOrder: 1 })
      .exec();

    const menuItems = await this.menuItemModel
      .find({ isAvailable: true })
      .exec();

    return categories.map((category) => {
      const items = menuItems.filter(
        (item) => item.categoryId.toString() === category._id.toString(),
      );
      return {
        category,
        items,
      };
    });
  }

  /**
   * Tạo mới một món ăn
   */
  async createMenuItem(dto: CreateMenuItemDto, userId = 'system'): Promise<MenuItem> {
    if (!Types.ObjectId.isValid(dto.categoryId)) {
      throw new BadRequestException('ID danh mục (categoryId) không đúng định dạng ObjectId');
    }

    const categoryExists = await this.categoryModel.findById(dto.categoryId).exec();
    if (!categoryExists) {
      throw new NotFoundException(`Danh mục với ID '${dto.categoryId}' không tồn tại`);
    }

    const existingMenuItem = await this.menuItemModel
      .findOne({ name: dto.name.trim() })
      .exec();
    if (existingMenuItem) {
      throw new BadRequestException(`Món ăn có tên '${dto.name}' đã tồn tại`);
    }

    const createdMenuItem = new this.menuItemModel({
      ...dto,
      name: dto.name.trim(),
      categoryId: new Types.ObjectId(dto.categoryId),
    });

    const savedItem = await createdMenuItem.save();

    // Update Trie index
    this.menuTrie.insert(savedItem.name, savedItem._id.toString());

    await this.menuHistoryManager.pushCommand(userId, {
      type: 'CREATE',
      menuItemId: savedItem._id.toString(),
      previousData: null,
      newData: savedItem.toObject(),
    });

    return savedItem;
  }

  /**
   * Cập nhật thông tin món ăn (Lưu trạng thái cũ vào Stack)
   */
  async updateMenuItem(id: string, dto: UpdateMenuItemDto, userId = 'system'): Promise<MenuItem> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('ID món ăn không đúng định dạng ObjectId');
    }

    const menuItem = await this.menuItemModel.findById(id).exec();
    if (!menuItem) {
      throw new NotFoundException(`Món ăn với ID '${id}' không tồn tại`);
    }

    if (dto.categoryId) {
      if (!Types.ObjectId.isValid(dto.categoryId)) {
        throw new BadRequestException('ID danh mục (categoryId) không đúng định dạng ObjectId');
      }
      const categoryExists = await this.categoryModel.findById(dto.categoryId).exec();
      if (!categoryExists) {
        throw new NotFoundException(`Danh mục với ID '${dto.categoryId}' không tồn tại`);
      }
    }

    if (dto.name) {
      const trimmedName = dto.name.trim();
      if (trimmedName !== menuItem.name) {
        const existing = await this.menuItemModel.findOne({ name: trimmedName }).exec();
        if (existing) {
          throw new BadRequestException(`Món ăn có tên '${trimmedName}' đã tồn tại`);
        }
      }
    }

    const previousData = menuItem.toObject();

    if (dto.categoryId) menuItem.categoryId = new Types.ObjectId(dto.categoryId);
    if (dto.name) menuItem.name = dto.name.trim();
    if (dto.description !== undefined) menuItem.description = dto.description;
    if (dto.price !== undefined) menuItem.price = dto.price;
    if (dto.imageUrl !== undefined) menuItem.imageUrl = dto.imageUrl;
    if (dto.isAvailable !== undefined) menuItem.isAvailable = dto.isAvailable;
    if (dto.options !== undefined) menuItem.options = dto.options;

    const updatedMenuItem = await menuItem.save();

    // Rebuild Trie on name/availability change
    await this.rebuildTrieIndex();

    await this.menuHistoryManager.pushCommand(userId, {
      type: 'UPDATE',
      menuItemId: id,
      previousData,
      newData: updatedMenuItem.toObject(),
    });

    return updatedMenuItem;
  }

  /**
   * Xóa món ăn khỏi menu (Hard delete khỏi DB, lưu trạng thái cũ vào Stack)
   */
  async deleteMenuItem(id: string, userId = 'system'): Promise<MenuItem> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('ID món ăn không đúng định dạng ObjectId');
    }

    const menuItem = await this.menuItemModel.findById(id).exec();
    if (!menuItem) {
      throw new NotFoundException(`Món ăn với ID '${id}' không tồn tại`);
    }

    const previousData = menuItem.toObject();

    await this.menuItemModel.findByIdAndDelete(id).exec();

    // Rebuild Trie index after delete
    await this.rebuildTrieIndex();

    await this.menuHistoryManager.pushCommand(userId, {
      type: 'DELETE',
      menuItemId: id,
      previousData,
      newData: null,
    });

    return menuItem;
  }

  /**
   * Hoàn tác (Undo) thao tác sửa đổi vừa thực hiện trên Menu
   */
  async undoMenuItemChange(userId = 'system'): Promise<any> {
    const command = await this.menuHistoryManager.popUndo(userId);
    if (!command) {
      throw new BadRequestException('Không có thao tác nào để hoàn tác (Undo Stack rỗng)');
    }

    const { type, menuItemId, previousData } = command;
    let res: any;

    if (type === 'UPDATE') {
      const menuItem = await this.menuItemModel.findById(menuItemId).exec();
      if (!menuItem) {
        const restoredItem = new this.menuItemModel(previousData);
        await restoredItem.save();
        res = { message: 'Hoàn tác thành công (Khôi phục món ăn đã bị xóa)', item: restoredItem };
      } else {
        Object.assign(menuItem, previousData);
        const saved = await menuItem.save();
        res = { message: 'Hoàn tác cập nhật thành công', item: saved };
      }
    } else if (type === 'CREATE') {
      await this.menuItemModel.findByIdAndDelete(menuItemId).exec();
      res = { message: 'Hoàn tác tạo mới thành công (Đã xóa món ăn)', menuItemId };
    } else if (type === 'DELETE') {
      const restoredItem = new this.menuItemModel(previousData);
      await restoredItem.save();
      res = { message: 'Hoàn tác xóa thành công (Khôi phục món ăn)', item: restoredItem };
    }

    await this.rebuildTrieIndex();
    return res;
  }

  /**
   * Làm lại (Redo) thao tác vừa hoàn tác trên Menu
   */
  async redoMenuItemChange(userId = 'system'): Promise<any> {
    const command = await this.menuHistoryManager.popRedo(userId);
    if (!command) {
      throw new BadRequestException('Không có thao tác nào để làm lại (Redo Stack rỗng)');
    }

    const { type, menuItemId, newData } = command;
    let res: any;

    if (type === 'UPDATE') {
      const menuItem = await this.menuItemModel.findById(menuItemId).exec();
      if (!menuItem) {
        throw new NotFoundException(`Không tìm thấy món ăn với ID '${menuItemId}' để làm lại cập nhật`);
      }
      Object.assign(menuItem, newData);
      const saved = await menuItem.save();
      res = { message: 'Làm lại cập nhật thành công', item: saved };
    } else if (type === 'CREATE') {
      const recreatedItem = new this.menuItemModel(newData);
      await recreatedItem.save();
      res = { message: 'Làm lại tạo mới thành công', item: recreatedItem };
    } else if (type === 'DELETE') {
      await this.menuItemModel.findByIdAndDelete(menuItemId).exec();
      res = { message: 'Làm lại xóa thành công (Đã xóa lại món ăn)', menuItemId };
    }

    await this.rebuildTrieIndex();
    return res;
  }
}
