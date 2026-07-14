import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Category, CategoryDocument } from '../../schemas/categories.schema';
import { MenuItem, MenuItemDocument } from '../../schemas/menu_items.schema';
import { CreateMenuItemDto } from './dto/create-menu-item.dto';

@Injectable()
export class MenuService {
  constructor(
    @InjectModel(Category.name) private readonly categoryModel: Model<CategoryDocument>,
    @InjectModel(MenuItem.name) private readonly menuItemModel: Model<MenuItemDocument>,
  ) {}

  /**
   * Lấy toàn bộ thực đơn đang bán (phân nhóm theo Category)
   */
  async getMenu(): Promise<any[]> {
    // Lấy tất cả danh mục đang hoạt động, sắp xếp theo thứ tự hiển thị
    const categories = await this.categoryModel
      .find({ isActive: true })
      .sort({ displayOrder: 1 })
      .exec();

    // Lấy tất cả món ăn đang được bán
    const menuItems = await this.menuItemModel
      .find({ isAvailable: true })
      .exec();

    // Phân nhóm món ăn theo danh mục
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
  async createMenuItem(dto: CreateMenuItemDto): Promise<MenuItem> {
    // Kiểm tra danh mục (Category) có tồn tại hay không
    if (!Types.ObjectId.isValid(dto.categoryId)) {
      throw new BadRequestException('ID danh mục (categoryId) không đúng định dạng ObjectId');
    }

    const categoryExists = await this.categoryModel.findById(dto.categoryId).exec();
    if (!categoryExists) {
      throw new NotFoundException(`Danh mục với ID '${dto.categoryId}' không tồn tại`);
    }

    // Kiểm tra tên món ăn có bị trùng lặp không (tên món ăn là unique trong Schema)
    const existingMenuItem = await this.menuItemModel
      .findOne({ name: dto.name.trim() })
      .exec();
    if (existingMenuItem) {
      throw new BadRequestException(`Món ăn có tên '${dto.name}' đã tồn tại`);
    }

    // Tạo và lưu món ăn mới
    const createdMenuItem = new this.menuItemModel({
      ...dto,
      name: dto.name.trim(),
      categoryId: new Types.ObjectId(dto.categoryId),
    });

    return await createdMenuItem.save();
  }
}
