import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document, Types } from 'mongoose';

export type OrderDocument = Order & Document;

@Schema({ _id: false })
export class SelectedOption {
  @Prop({ required: true })
  name!: string;

  @Prop({
    required: true,
    default: 0,
    min: 0,
    max: Number.MAX_SAFE_INTEGER,
    validate: Number.isSafeInteger,
  })
  price!: number;
}

const SelectedOptionSchema = SchemaFactory.createForClass(SelectedOption);

@Schema({ _id: false })
export class OrderItem {
  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: 'MenuItem',
    required: true,
  })
  menuItemId!: Types.ObjectId;

  @Prop({ required: true })
  name!: string;

  @Prop({
    required: true,
    min: 1,
    max: Number.MAX_SAFE_INTEGER,
    default: 1,
    validate: Number.isSafeInteger,
  })
  quantity!: number;

  @Prop({
    required: true,
    min: 0,
    max: Number.MAX_SAFE_INTEGER,
    validate: Number.isSafeInteger,
  })
  unitPrice!: number;

  @Prop({ type: [SelectedOptionSchema], default: [] })
  selectedOptions!: SelectedOption[];

  @Prop({ required: false })
  note!: string;
}

const OrderItemSchema = SchemaFactory.createForClass(OrderItem);

@Schema({ timestamps: true })
export class Order {
  createdAt!: Date;
  updatedAt!: Date;

  @Prop({ required: true, unique: true })
  orderNumber!: string;

  @Prop({ type: mongoose.Schema.Types.ObjectId, required: true })
  userId!: Types.ObjectId;

  @Prop({ required: true, default: 'user' })
  userRole!: string;

  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Table',
    required: true,
  })
  tableId!: Types.ObjectId;

  @Prop({ type: [OrderItemSchema], required: true })
  items!: OrderItem[];

  @Prop({
    required: true,
    min: 0,
    max: Number.MAX_SAFE_INTEGER,
    validate: Number.isSafeInteger,
  })
  totalAmount!: number;

  @Prop({
    required: true,
    min: 0,
    max: Number.MAX_SAFE_INTEGER,
    validate: Number.isSafeInteger,
  })
  finalAmount!: number;

  @Prop({
    required: true,
    enum: ['CREATED', 'COMPLETED', 'CANCELLED'],
    default: 'CREATED',
  })
  status!: string;

  @Prop({
    required: true,
    enum: ['PENDING', 'PAID'],
    default: 'PENDING',
  })
  paymentStatus!: string;

  @Prop({
    required: true,
    enum: ['CASH'],
    default: 'CASH',
  })
  paymentMethod!: string;

  @Prop({ required: false })
  paidAt?: Date;

  @Prop({ type: mongoose.Schema.Types.ObjectId, required: false })
  paidBy?: Types.ObjectId;

  @Prop({ required: false })
  cancelledAt?: Date;

  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    required: false,
  })
  cancelledBy?: Types.ObjectId;

  @Prop({ required: false, maxlength: 500 })
  cancellationReason?: string;
}

export const OrderSchema = SchemaFactory.createForClass(Order);

// Danh sách vận hành; _id giữ thứ tự ổn định khi nhiều đơn cùng createdAt.
OrderSchema.index({ createdAt: -1, _id: -1 });
OrderSchema.index({ status: 1, createdAt: -1, _id: -1 });
// Lịch sử cá nhân và danh sách lọc theo người đặt.
OrderSchema.index({ userId: 1, createdAt: -1, _id: -1 });
// Đối soát và hoàn tác trạng thái bàn chỉ cần xét các đơn cùng bàn.
OrderSchema.index({ tableId: 1 });
