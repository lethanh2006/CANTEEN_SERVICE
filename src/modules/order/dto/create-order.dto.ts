import {
  IsArray,
  IsEnum,
  IsInt,
  IsMongoId,
  IsNotEmpty,
  Max,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class OrderSelectedOptionDto {
  @IsNotEmpty({ message: 'Tên tùy chọn không được để trống' })
  @IsString({ message: 'Tên tùy chọn phải là chuỗi ký tự' })
  name!: string;

  @IsOptional()
  @IsInt({ message: 'Giá tùy chọn phải là số nguyên VND' })
  @Min(0, { message: 'Giá tùy chọn phải lớn hơn hoặc bằng 0' })
  @Max(Number.MAX_SAFE_INTEGER, {
    message: 'Giá tùy chọn vượt giới hạn hỗ trợ',
  })
  price?: number;
}

export class CreateOrderItemDto {
  @IsNotEmpty({ message: 'ID món ăn (menuItemId) không được để trống' })
  @IsMongoId({ message: 'ID món ăn không đúng định dạng ObjectId' })
  menuItemId!: string;

  @IsNotEmpty({ message: 'Số lượng không được để trống' })
  @IsInt({ message: 'Số lượng phải là số nguyên' })
  @Min(1, { message: 'Số lượng phải lớn hơn hoặc bằng 1' })
  @Max(Number.MAX_SAFE_INTEGER, { message: 'Số lượng vượt giới hạn hỗ trợ' })
  quantity!: number;

  @IsOptional()
  @IsArray({ message: 'Danh sách tùy chọn phải là mảng' })
  @ValidateNested({ each: true })
  @Type(() => OrderSelectedOptionDto)
  selectedOptions?: OrderSelectedOptionDto[];

  @IsOptional()
  @IsString({ message: 'Ghi chú phải là chuỗi ký tự' })
  note?: string;
}

export class CreateOrderDto {
  @IsMongoId({ message: 'ID bàn ăn không đúng định dạng ObjectId' })
  tableId!: string;

  @IsNotEmpty({ message: 'Danh sách món ăn (items) không được để trống' })
  @IsArray({ message: 'Danh sách món ăn phải là mảng' })
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items!: CreateOrderItemDto[];

  @IsOptional()
  @IsEnum(['CASH'], {
    message: 'Phương thức thanh toán hiện chỉ hỗ trợ tiền mặt (CASH)',
  })
  paymentMethod?: string;
}
