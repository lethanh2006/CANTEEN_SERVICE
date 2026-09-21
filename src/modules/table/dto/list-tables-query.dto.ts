import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class ListTablesQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'page phải là số nguyên' })
  @Min(1, { message: 'page phải lớn hơn hoặc bằng 1' })
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit phải là số nguyên' })
  @Min(1, { message: 'limit phải lớn hơn hoặc bằng 1' })
  @Max(100, { message: 'limit không được lớn hơn 100' })
  limit = 20;

  @IsOptional()
  @IsString({ message: 'q phải là chuỗi ký tự' })
  q?: string;

  @IsOptional()
  @IsString({ message: 'sortBy phải là chuỗi ký tự' })
  sortBy?: string;

  @IsOptional()
  @IsIn(['asc', 'desc'], { message: 'sortOrder chỉ nhận asc hoặc desc' })
  sortOrder?: 'asc' | 'desc';
}
