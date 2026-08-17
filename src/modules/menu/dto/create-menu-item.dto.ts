import {
  IsArray,
  IsBoolean,
  IsMongoId,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class MenuItemOptionDto {
  @IsNotEmpty({ message: 'Tên tùy chọn không được để trống' })
  @IsString({ message: 'Tên tùy chọn phải là chuỗi ký tự' })
  name: string;

  @IsNotEmpty({ message: 'Giá tùy chọn không được để trống' })
  @IsNumber({}, { message: 'Giá tùy chọn phải là số' })
  @Min(0, { message: 'Giá tùy chọn phải lớn hơn hoặc bằng 0' })
  price: number;
}

export class CreateMenuItemDto {
  @IsNotEmpty({ message: 'Danh mục (categoryId) không được để trống' })
  @IsMongoId({ message: 'ID danh mục không đúng định dạng ObjectId' })
  categoryId: string;

  @IsNotEmpty({ message: 'Tên món ăn không được để trống' })
  @IsString({ message: 'Tên món ăn phải là chuỗi ký tự' })
  name: string;

  @IsOptional()
  @IsString({ message: 'Mô tả phải là chuỗi ký tự' })
  description?: string;

  @IsNotEmpty({ message: 'Giá món ăn không được để trống' })
  @IsNumber({}, { message: 'Giá món ăn phải là số' })
  @Min(0, { message: 'Giá món ăn phải lớn hơn hoặc bằng 0' })
  price: number;

  @IsOptional()
  @IsString({ message: 'Đường dẫn ảnh phải là chuỗi ký tự' })
  imageUrl?: string;

  @IsOptional()
  @IsBoolean({ message: 'Trạng thái có sẵn phải là kiểu boolean' })
  isAvailable?: boolean;

  @IsOptional()
  @IsArray({ message: 'Danh sách tùy chọn phải là mảng' })
  @ValidateNested({ each: true })
  @Type(() => MenuItemOptionDto)
  options?: MenuItemOptionDto[];
}
