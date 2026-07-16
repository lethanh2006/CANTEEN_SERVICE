import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Category, CategoryDocument } from '../../schemas/categories.schema';
import { MenuItem, MenuItemDocument } from '../../schemas/menu_items.schema';
import { CreateMenuItemDto } from './dto/create-menu-item.dto';
import { UpdateMenuItemDto } from './dto/update-menu-item.dto';
import { MenuHistoryManager } from './utils/undo-stack';

@Injectable()
export class MenuService {
  constructor(
    @InjectModel(Category.name) private readonly categoryModel: Model<CategoryDocument>,
    @InjectModel(MenuItem.name) private readonly menuItemModel: Model<MenuItemDocument>,
    private readonly menuHistoryManager: MenuHistoryManager,
  ) { }

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

    const newData = updatedMenuItem.toObject();

    await this.menuHistoryManager.pushCommand(userId, {
      type: 'UPDATE',
      menuItemId: id,
      previousData,
      newData,
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

    if (type === 'UPDATE') {
      const menuItem = await this.menuItemModel.findById(menuItemId).exec();
      if (!menuItem) {
        const restoredItem = new this.menuItemModel(previousData);
        await restoredItem.save();
        return { message: 'Hoàn tác thành công (Khôi phục món ăn đã bị xóa)', item: restoredItem };
      }

      Object.assign(menuItem, previousData);
      const saved = await menuItem.save();
      return { message: 'Hoàn tác cập nhật thành công', item: saved };
    }

    if (type === 'CREATE') {
      await this.menuItemModel.findByIdAndDelete(menuItemId).exec();
      return { message: 'Hoàn tác tạo mới thành công (Đã xóa món ăn)', menuItemId };
    }

    if (type === 'DELETE') {
      const restoredItem = new this.menuItemModel(previousData);
      await restoredItem.save();
      return { message: 'Hoàn tác xóa thành công (Khôi phục món ăn)', item: restoredItem };
    }

    return { message: 'Kiểu thao tác không hỗ trợ hoàn tác' };
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

    if (type === 'UPDATE') {
      const menuItem = await this.menuItemModel.findById(menuItemId).exec();
      if (!menuItem) {
        throw new NotFoundException(`Không tìm thấy món ăn với ID '${menuItemId}' để làm lại cập nhật`);
      }

      Object.assign(menuItem, newData);
      const saved = await menuItem.save();
      return { message: 'Làm lại cập nhật thành công', item: saved };
    }

    if (type === 'CREATE') {
      const recreatedItem = new this.menuItemModel(newData);
      await recreatedItem.save();
      return { message: 'Làm lại tạo mới thành công', item: recreatedItem };
    }

    if (type === 'DELETE') {
      await this.menuItemModel.findByIdAndDelete(menuItemId).exec();
      return { message: 'Làm lại xóa thành công (Đã xóa lại món ăn)', menuItemId };
    }

    return { message: 'Kiểu thao tác không hỗ trợ làm lại' };
  }
}
