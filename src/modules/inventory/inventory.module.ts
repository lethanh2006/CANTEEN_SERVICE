import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Ingredient, IngredientSchema } from '../../schemas/ingredients.schema';
import { InventoryBatch, InventoryBatchSchema } from '../../schemas/inventory_batches.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Ingredient.name, schema: IngredientSchema },
      { name: InventoryBatch.name, schema: InventoryBatchSchema },
    ]),
  ],
  controllers: [],
  providers: [],
  exports: [],
})
export class InventoryModule {}
