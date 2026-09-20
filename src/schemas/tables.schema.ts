import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type TableDocument = Table & Document;

@Schema({ timestamps: true })
export class Table {
  @Prop({ required: true, unique: true, trim: true })
  name!: string;

  @Prop({ required: true, default: 4 })
  capacity!: number;

  @Prop({
    required: true,
    enum: ['empty', 'occupied', 'reserved'],
    default: 'empty',
  })
  status!: string;
}

export const TableSchema = SchemaFactory.createForClass(Table);
