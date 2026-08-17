import { ConflictException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { BaseCrudService } from '../../common/crud';
import {
  Ingredient,
  IngredientDocument,
} from '../../schemas/ingredients.schema';
import {
  InventoryBatch,
  InventoryBatchDocument,
} from '../../schemas/inventory_batches.schema';
import { CreateIngredientDto } from './dto/create-ingredient.dto';
import { UpdateIngredientDto } from './dto/update-ingredient.dto';

@Injectable()
export class IngredientService extends BaseCrudService<
  IngredientDocument,
  CreateIngredientDto,
  UpdateIngredientDto
> {
  constructor(
    @InjectModel(Ingredient.name)
    ingredientModel: Model<IngredientDocument>,
    @InjectModel(InventoryBatch.name)
    private readonly batchModel: Model<InventoryBatchDocument>,
  ) {
    super(ingredientModel, {
      resourceName: 'Nguyên liệu',
      defaultSort: { field: 'name', order: 'asc' },
      allowedSortFields: [
        'name',
        'unit',
        'minimumThreshold',
        'createdAt',
        'updatedAt',
      ],
      searchFields: ['name', 'unit'],
      uniqueFields: ['name'],
    });
  }

  protected prepareCreate(dto: CreateIngredientDto): Record<string, unknown> {
    return {
      ...dto,
      name: dto.name.trim(),
      unit: dto.unit.trim(),
    };
  }

  protected prepareUpdate(dto: UpdateIngredientDto): Record<string, unknown> {
    return {
      ...dto,
      ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
      ...(dto.unit !== undefined ? { unit: dto.unit.trim() } : {}),
    };
  }

  protected async beforeDelete(ingredient: IngredientDocument): Promise<void> {
    const hasInventoryBatch = await this.batchModel
      .exists({ ingredientId: ingredient._id })
      .exec();
    if (hasInventoryBatch) {
      throw new ConflictException(
        `Không thể xóa nguyên liệu '${ingredient.name}' vì đã có lô kho liên quan`,
      );
    }
  }
}
