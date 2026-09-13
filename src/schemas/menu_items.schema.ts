import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import mongoose, { Document, Types } from 'mongoose';

export type MenuItemDocument = MenuItem & Document;

@Schema({ _id: false })
export class MenuItemOption {
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

const MenuItemOptionSchema = SchemaFactory.createForClass(MenuItemOption);

@Schema({ timestamps: true })
export class MenuItem {
  @Prop({
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Category',
    required: true,
  })
  categoryId!: Types.ObjectId;

  @Prop({ required: true, unique: true, trim: true })
  name!: string;

  @Prop({ required: false })
  description!: string;

  @Prop({
    required: true,
    min: 0,
    max: Number.MAX_SAFE_INTEGER,
    validate: Number.isSafeInteger,
  })
  price!: number;

  @Prop({ required: false })
  imageUrl!: string;

  @Prop({ required: true, default: true })
  isAvailable!: boolean;

  @Prop({ type: [MenuItemOptionSchema], default: [] })
  options!: MenuItemOption[];
}

export const MenuItemSchema = SchemaFactory.createForClass(MenuItem);

// Lọc món theo danh mục/trạng thái bán; prefix categoryId phục vụ kiểm tra xóa.
MenuItemSchema.index({ categoryId: 1, isAvailable: 1 });
