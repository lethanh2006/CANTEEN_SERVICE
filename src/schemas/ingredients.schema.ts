import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type IngredientDocument = Ingredient & Document;

@Schema({ timestamps: true })
export class Ingredient {
    @Prop({ required: true, unique: true, trim: true })
    name: string;

    @Prop({ required: true })
    unit: string;

    @Prop({ required: true })
    minimumThreshold: number;

}

export const IngredientSchema = SchemaFactory.createForClass(Ingredient);
