import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CancelOrderDto {
  @IsOptional()
  @IsString({ message: 'Lý do hủy phải là chuỗi ký tự' })
  @MaxLength(500, { message: 'Lý do hủy không được vượt quá 500 ký tự' })
  reason?: string;
}
