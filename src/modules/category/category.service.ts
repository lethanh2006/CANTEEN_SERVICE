import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, QueryFilter } from 'mongoose';
import { Category, CategoryDocument } from '../../schemas/categories.schema';
import { MenuItem, MenuItemDocument } from '../../schemas/menu_items.schema';
import { CreateCategoryDto } from './dto/create-category.dto';
import { ListCategoriesQueryDto } from './dto/list-categories-query.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

interface MongoDuplicateKeyError {
  code?: number;
  keyPattern?: Record<string, number>;
}

const CATEGORY_SORT_FIELDS: readonly string[] = [
  'name',
  'displayOrder',
  'isActive',
  'createdAt',
  'updatedAt',
];

@Injectable()
export class CategoryService {
  constructor(
    @InjectModel(Category.name)
    private readonly categoryModel: Model<CategoryDocument>,
    @InjectModel(MenuItem.name)
    private readonly menuItemModel: Model<MenuItemDocument>,
  ) {}

  async findAll(query: ListCategoriesQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const sortBy = query.sortBy ?? 'displayOrder';
    const sortOrder = query.sortOrder ?? 'asc';

    if (!CATEGORY_SORT_FIELDS.includes(sortBy)) {
      throw new BadRequestException(
        `Không hỗ trợ sắp xếp theo '${sortBy}'. Các trường hợp lệ: ${CATEGORY_SORT_FIELDS.join(', ')}`,
      );
    }

    const filter = this.buildSearchFilter(query.q);
    const [data, total] = await Promise.all([
      this.categoryModel
        .find(filter)
        .sort({ [sortBy]: sortOrder === 'asc' ? 1 : -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.categoryModel
        .countDocuments(
          filter,
          Object.keys(filter).length === 0 ? { hint: '_id_' } : {},
        )
        .exec(),
    ]);

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string): Promise<CategoryDocument> {
    const category = await this.categoryModel.findById(id).exec();
    if (!category) {
      throw new NotFoundException(`Danh mục với ID '${id}' không tồn tại`);
    }

    return category;
  }

  async create(dto: CreateCategoryDto): Promise<CategoryDocument> {
    const data = {
      ...dto,
      name: dto.name.trim(),
      description: dto.description.trim(),
    };
    await this.ensureUniqueName(data.name);

    try {
      return await new this.categoryModel(data).save();
    } catch (error: unknown) {
      this.rethrowPersistenceError(error);
    }
  }

  async update(id: string, dto: UpdateCategoryDto): Promise<CategoryDocument> {
    const category = await this.findOne(id);
    const data = {
      ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
      ...(dto.description !== undefined
        ? { description: dto.description.trim() }
        : {}),
      ...(dto.displayOrder !== undefined
        ? { displayOrder: dto.displayOrder }
        : {}),
      ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
    };

    if (Object.keys(data).length === 0) {
      throw new BadRequestException(
        'Cần cung cấp ít nhất một trường để cập nhật',
      );
    }
    if (data.name !== undefined) {
      await this.ensureUniqueName(data.name, id);
    }

    try {
      category.set(data);
      return await category.save();
    } catch (error: unknown) {
      this.rethrowPersistenceError(error);
    }
  }

  async delete(id: string): Promise<CategoryDocument> {
    const category = await this.findOne(id);
    const hasMenuItem = await this.menuItemModel
      .exists({ categoryId: category._id })
      .exec();
    if (hasMenuItem) {
      throw new ConflictException(
        `Không thể xóa danh mục '${category.name}' vì vẫn còn món ăn liên quan`,
      );
    }

    await category.deleteOne();
    return category;
  }

  private buildSearchFilter(search?: string): QueryFilter<CategoryDocument> {
    const keyword = search?.trim();
    if (!keyword) {
      return {};
    }

    const safeKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return {
      $or: [
        { name: { $regex: safeKeyword, $options: 'i' } },
        { description: { $regex: safeKeyword, $options: 'i' } },
      ],
    };
  }

  private async ensureUniqueName(name: string, excludeId?: string) {
    const exists = await this.categoryModel
      .exists({
        name,
        ...(excludeId ? { _id: { $ne: excludeId } } : {}),
      })
      .exec();
    if (exists) {
      throw new ConflictException(`Danh mục có name '${name}' đã tồn tại`);
    }
  }

  private rethrowPersistenceError(error: unknown): never {
    if (this.isDuplicateKeyError(error)) {
      const field = Object.keys(error.keyPattern ?? {})[0] ?? 'dữ liệu';
      throw new ConflictException(`Danh mục có ${field} bị trùng`);
    }
    throw error;
  }

  private isDuplicateKeyError(
    error: unknown,
  ): error is MongoDuplicateKeyError & { code: 11000 } {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 11000
    );
  }
}
