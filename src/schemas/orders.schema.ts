import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document, Types } from 'mongoose';

export type OrderDocument = Order & Document;

@Schema({ _id: false })
export class SelectedOption {
  @Prop({ required: true })
  name: string;

  @Prop({
    required: true,
    default: 0,
    min: 0,
    max: Number.MAX_SAFE_INTEGER,
    validate: Number.isSafeInteger,
  })
  price: number;
}

const SelectedOptionSchema = SchemaFactory.createForClass(SelectedOption);

@Schema({ _id: false })
export class OrderItem {
  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: 'MenuItem',
    required: true,
  })
  menuItemId: Types.ObjectId;

  @Prop({ required: true })
  name: string;

  @Prop({
    required: true,
    min: 1,
    max: Number.MAX_SAFE_INTEGER,
    default: 1,
    validate: Number.isSafeInteger,
  })
  quantity: number;

  @Prop({
    required: true,
    min: 0,
    max: Number.MAX_SAFE_INTEGER,
    validate: Number.isSafeInteger,
  })
  unitPrice: number;

  @Prop({ type: [SelectedOptionSchema], default: [] })
  selectedOptions: SelectedOption[];

  @Prop({ required: false })
  note: string;
}

const OrderItemSchema = SchemaFactory.createForClass(OrderItem);

@Schema({ timestamps: true })
export class Order {
  createdAt: Date;
  updatedAt: Date;

  @Prop({ required: true, unique: true })
  orderNumber: string;

  @Prop({ type: mongoose.Schema.Types.ObjectId, required: true })
  userId: Types.ObjectId;

  @Prop({ required: true, default: 'user' }) // 'user' | 'manager' | 'vip'
  userRole: string;

  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Table',
    required: false,
    default: null,
  })
  tableId: Types.ObjectId | null;

  @Prop({ type: [OrderItemSchema], required: true })
  items: OrderItem[];

  @Prop({
    required: true,
    min: 0,
    max: Number.MAX_SAFE_INTEGER,
    validate: Number.isSafeInteger,
  })
  totalAmount: number;

  @Prop({
    required: true,
    default: 0,
    min: 0,
    max: Number.MAX_SAFE_INTEGER,
    validate: Number.isSafeInteger,
  })
  discountAmount: number;

  @Prop({
    required: true,
    min: 0,
    max: Number.MAX_SAFE_INTEGER,
    validate: Number.isSafeInteger,
  })
  finalAmount: number;

  @Prop({
    required: true,
    enum: [
      'CREATED',
      'CONFIRMED',
      'COOKING',
      'READY',
      'COMPLETED',
      'PAID',
      'CANCELLED',
    ],
    default: 'CREATED',
  })
  status: string;

  @Prop({ required: true, default: 0 })
  priorityScore: number;

  @Prop({
    required: true,
    enum: ['PENDING', 'PAID', 'REFUNDED'],
    default: 'PENDING',
  })
  paymentStatus: string;

  @Prop({
    required: true,
    enum: ['CASH', 'VNPAY', 'MOMO', 'VIETQR'],
    default: 'CASH',
  })
  paymentMethod: string;

  @Prop({ required: false })
  paymentId?: string;

  @Prop({ required: false })
  paymentEventId?: string;

  @Prop({ required: false })
  providerTransactionId?: string;

  @Prop({ required: false })
  paidAt?: Date;
}

export const OrderSchema = SchemaFactory.createForClass(Order);

OrderSchema.index({ status: 1, priorityScore: -1, createdAt: 1 });
OrderSchema.index({ paymentId: 1 }, { unique: true, sparse: true });
OrderSchema.index({ paymentEventId: 1 }, { unique: true, sparse: true });
OrderSchema.index({ providerTransactionId: 1 }, { unique: true, sparse: true });
