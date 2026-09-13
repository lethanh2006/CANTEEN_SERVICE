import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document, Types } from 'mongoose';

export type InventoryBatchDocument = InventoryBatch & Document;

@Schema({ timestamps: true })
export class InventoryBatch {
  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Ingredient',
    required: true,
  })
  ingredientId!: Types.ObjectId;

  @Prop({ required: true, min: 0 })
  quantity!: number;

  @Prop({ required: true, min: 0 })
  originalQuantity!: number;

  @Prop({ required: true })
  expiryDate!: Date;

  @Prop({ required: true, default: Date.now })
  importDate!: Date;

  @Prop({ required: true, min: 0 })
  costPrice!: number;

  @Prop({ required: false })
  supplier!: string;

  @Prop({
    required: true,
    enum: ['ACTIVE', 'EXPIRED', 'DEPLETED'],
    default: 'ACTIVE',
  })
  status!: string;
}

export const InventoryBatchSchema =
  SchemaFactory.createForClass(InventoryBatch);

// Xuất kho FEFO, cập nhật lô hết hạn và kiểm tra lô theo nguyên liệu.
InventoryBatchSchema.index({
  ingredientId: 1,
  status: 1,
  expiryDate: 1,
  _id: 1,
});
// Cảnh báo chỉ lấy lô ACTIVE còn hàng; ngày hiện tại vẫn lọc tại truy vấn.
InventoryBatchSchema.index(
  { expiryDate: 1 },
  { partialFilterExpression: { status: 'ACTIVE', quantity: { $gt: 0 } } },
);
