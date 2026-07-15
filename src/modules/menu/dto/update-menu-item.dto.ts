import { IsString, IsOptional, IsNumber, Min, IsBoolean, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { MenuItemOptionDto } from './create-menu-item.dto';

export class UpdateMenuItemDto {
  @IsOptional()
  @IsString({ message: 'Danh mục (categoryId) phải là chuỗi ObjectId' })
  categoryId?: string;

  @IsOptional()
  @IsString({ message: 'Tên món ăn phải là chuỗi ký tự' })
  name?: string;

  @IsOptional()
  @IsString({ message: 'Mô tả phải là chuỗi ký tự' })
  description?: string;

  @IsOptional()
  @IsNumber({}, { message: 'Giá món ăn phải là số' })
  @Min(0, { message: 'Giá món ăn phải lớn hơn hoặc bằng 0' })
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
