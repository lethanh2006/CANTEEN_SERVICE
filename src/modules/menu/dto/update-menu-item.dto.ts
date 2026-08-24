import {
  IsArray,
  IsBoolean,
  IsInt,
  IsMongoId,
  Max,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { MenuItemOptionDto } from './create-menu-item.dto';

export class UpdateMenuItemDto {
  @IsOptional()
  @IsMongoId({ message: 'ID danh mục không đúng định dạng ObjectId' })
  categoryId?: string;

  @IsOptional()
  @IsString({ message: 'Tên món ăn phải là chuỗi ký tự' })
  name?: string;

  @IsOptional()
  @IsString({ message: 'Mô tả phải là chuỗi ký tự' })
  description?: string;

  @IsOptional()
  @IsInt({ message: 'Giá món ăn phải là số nguyên VND' })
  @Min(0, { message: 'Giá món ăn phải lớn hơn hoặc bằng 0' })
  @Max(Number.MAX_SAFE_INTEGER, { message: 'Giá món ăn vượt giới hạn hỗ trợ' })
  price?: number;

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
