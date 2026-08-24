import {
  IsDateString,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  Max,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class CreateInventoryBatchDto {
  @IsNotEmpty({ message: 'ID nguyên liệu (ingredientId) không được để trống' })
  @IsMongoId({ message: 'ID nguyên liệu không đúng định dạng ObjectId' })
  ingredientId: string;

  @IsNotEmpty({ message: 'Số lượng nhập không được để trống' })
  @IsNumber({}, { message: 'Số lượng phải là số' })
  @Min(0.001, { message: 'Số lượng nhập phải lớn hơn 0' })
  quantity: number;

  @IsNotEmpty({ message: 'Hạn sử dụng (expiryDate) không được để trống' })
  @IsDateString(
    {},
    { message: 'Hạn sử dụng phải đúng định dạng ISO Date (YYYY-MM-DD)' },
  )
  expiryDate: string;

  @IsNotEmpty({ message: 'Giá nhập không được để trống' })
  @IsInt({ message: 'Giá nhập phải là số nguyên VND' })
  @Min(0, { message: 'Giá nhập phải lớn hơn hoặc bằng 0' })
  @Max(Number.MAX_SAFE_INTEGER, { message: 'Giá nhập vượt giới hạn hỗ trợ' })
  costPrice: number;

  @IsOptional()
  @IsString({ message: 'Tên nhà cung cấp phải là chuỗi ký tự' })
  supplier?: string;
}
