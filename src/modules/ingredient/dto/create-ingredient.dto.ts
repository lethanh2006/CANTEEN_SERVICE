import { IsNotEmpty, IsNumber, IsString, Min } from 'class-validator';

export class CreateIngredientDto {
  @IsNotEmpty({ message: 'Tên nguyên liệu không được để trống' })
  @IsString({ message: 'Tên nguyên liệu phải là chuỗi ký tự' })
  name: string;

  @IsNotEmpty({ message: 'Đơn vị tính không được để trống' })
  @IsString({ message: 'Đơn vị tính phải là chuỗi ký tự' })
  unit: string;

  @IsNotEmpty({ message: 'Ngưỡng cảnh báo tối thiểu không được để trống' })
  @IsNumber({}, { message: 'Ngưỡng cảnh báo tối thiểu phải là số' })
  @Min(0, { message: 'Ngưỡng cảnh báo tối thiểu phải lớn hơn hoặc bằng 0' })
  minimumThreshold: number;
}
