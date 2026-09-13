import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export const ORDER_NUMBER_COUNTER_KEY = 'order-number';

export type OrderCounterDocument = OrderCounter & Document;

@Schema({ timestamps: true, collection: 'counters' })
export class OrderCounter {
  @Prop({ required: true, unique: true })
  key!: string;

  @Prop({
    required: true,
    min: 0,
    max: Number.MAX_SAFE_INTEGER,
    validate: Number.isSafeInteger,
  })
  sequence!: number;
}

export const OrderCounterSchema = SchemaFactory.createForClass(OrderCounter);
