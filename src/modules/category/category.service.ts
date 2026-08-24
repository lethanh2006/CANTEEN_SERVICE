import { ConflictException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { BaseCrudService } from '../../common/crud';
import { Category, CategoryDocument } from '../../schemas/categories.schema';
import { MenuItem, MenuItemDocument } from '../../schemas/menu_items.schema';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@Injectable()
export class CategoryService extends BaseCrudService<
  CategoryDocument,
  CreateCategoryDto,
  UpdateCategoryDto
> {
  constructor(
    @InjectModel(Category.name)
    categoryModel: Model<CategoryDocument>,
    @InjectModel(MenuItem.name)
    private readonly menuItemModel: Model<MenuItemDocument>,
  ) {
    super(categoryModel, {
      resourceName: 'Danh mục',
      defaultSort: { field: 'displayOrder', order: 'asc' },
      allowedSortFields: [
        'name',
        'displayOrder',
        'isActive',
        'createdAt',
        'updatedAt',
      ],
      searchFields: ['name', 'description'],
      uniqueFields: ['name'],
    });
  }

  protected prepareCreate(dto: CreateCategoryDto): Record<string, unknown> {
    return {
      ...dto,
      name: dto.name.trim(),
      description: dto.description.trim(),
    };
  }

  protected prepareUpdate(dto: UpdateCategoryDto): Record<string, unknown> {
    return {
      ...dto,
      ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
      ...(dto.description !== undefined
        ? { description: dto.description.trim() }
        : {}),
    };
  }

  protected async beforeDelete(category: CategoryDocument): Promise<void> {
    const hasMenuItem = await this.menuItemModel
      .exists({ categoryId: category._id })
      .exec();
    if (hasMenuItem) {
      throw new ConflictException(
        `Không thể xóa danh mục '${category.name}' vì vẫn còn món ăn liên quan`,
      );
    }
  }
}
