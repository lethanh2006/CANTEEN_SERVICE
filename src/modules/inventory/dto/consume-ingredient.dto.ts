import { IsNotEmpty, IsString, IsNumber, Min } from 'class-validator';

export class ConsumeIngredientDto {
  @IsNotEmpty({ message: 'ID nguyên liệu (ingredientId) không được để trống' })
  @IsString({ message: 'ID nguyên liệu phải là chuỗi ObjectId' })
  ingredientId: string;

  @IsNotEmpty({ message: 'Số lượng khấu trừ không được để trống' })
  @IsNumber({}, { message: 'Số lượng phải là số' })
  @Min(0.001, { message: 'Số lượng khấu trừ phải lớn hơn 0' })
  quantity: number;
}
