import {
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class UpdateTableDto {
  @IsOptional()
  @IsString({ message: 'Tên bàn phải là chuỗi ký tự' })
  @IsNotEmpty({ message: 'Tên bàn không được để trống' })
  name?: string;

  @IsOptional()
  @IsNumber({}, { message: 'Sức chứa phải là số' })
  @Min(1, { message: 'Sức chứa phải lớn hơn hoặc bằng 1' })
  capacity?: number;

  @IsOptional()
  @IsString({ message: 'Đường dẫn QR phải là chuỗi ký tự' })
  @IsNotEmpty({ message: 'Đường dẫn QR không được để trống' })
  qrCodeUrl?: string;
}
