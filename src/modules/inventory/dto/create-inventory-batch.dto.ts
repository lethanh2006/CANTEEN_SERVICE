import { IsNotEmpty, IsString, IsNumber, Min, IsOptional, IsDateString } from 'class-validator';

export class CreateInventoryBatchDto {
  @IsNotEmpty({ message: 'ID nguyên liệu (ingredientId) không được để trống' })
  @IsString({ message: 'ID nguyên liệu phải là chuỗi ObjectId' })
  ingredientId: string;

  @IsNotEmpty({ message: 'Số lượng nhập không được để trống' })
  @IsNumber({}, { message: 'Số lượng phải là số' })
  @Min(0.001, { message: 'Số lượng nhập phải lớn hơn 0' })
  quantity: number;

  @IsNotEmpty({ message: 'Hạn sử dụng (expiryDate) không được để trống' })
  @IsDateString({}, { message: 'Hạn sử dụng phải đúng định dạng ISO Date (YYYY-MM-DD)' })
  expiryDate: string;

  @IsNotEmpty({ message: 'Giá nhập không được để trống' })
  @IsNumber({}, { message: 'Giá nhập phải là số' })
  @Min(0, { message: 'Giá nhập phải lớn hơn hoặc bằng 0' })
  costPrice: number;

  @IsOptional()
  @IsString({ message: 'Tên nhà cung cấp phải là chuỗi ký tự' })
  supplier?: string;
}
