import { IsMongoId, IsNotEmpty, IsNumber, Min } from 'class-validator';

export class ConsumeIngredientDto {
  @IsNotEmpty({ message: 'ID nguyên liệu (ingredientId) không được để trống' })
  @IsMongoId({ message: 'ID nguyên liệu không đúng định dạng ObjectId' })
  ingredientId: string;

  @IsNotEmpty({ message: 'Số lượng khấu trừ không được để trống' })
  @IsNumber({}, { message: 'Số lượng phải là số' })
  @Min(0.001, { message: 'Số lượng khấu trừ phải lớn hơn 0' })
  quantity: number;
}
