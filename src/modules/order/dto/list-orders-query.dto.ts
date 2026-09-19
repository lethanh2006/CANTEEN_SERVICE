import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsISO8601,
  IsMongoId,
  IsOptional,
  Max,
  Min,
} from 'class-validator';

export const ORDER_STATUSES = [
  'CREATED',
  'CONFIRMED',
  'COOKING',
  'READY',
  'COMPLETED',
  'PAID',
  'CANCELLED',
] as const;

export const ORDER_PAYMENT_STATUSES = ['PENDING', 'PAID', 'REFUNDED'] as const;

export class ListOrdersQueryDto {
  @IsOptional()
  @IsEnum(ORDER_STATUSES, { message: 'Trạng thái đơn hàng không hợp lệ' })
  status?: (typeof ORDER_STATUSES)[number];

  @IsOptional()
  @IsEnum(ORDER_PAYMENT_STATUSES, {
    message: 'Trạng thái thanh toán không hợp lệ',
  })
  paymentStatus?: (typeof ORDER_PAYMENT_STATUSES)[number];

  @IsOptional()
  @IsMongoId({ message: 'ID người dùng không đúng định dạng ObjectId' })
  userId?: string;

  @IsOptional()
  @IsMongoId({ message: 'ID bàn ăn không đúng định dạng ObjectId' })
  tableId?: string;

  @IsOptional()
  @IsISO8601({}, { message: 'Thời gian bắt đầu không hợp lệ' })
  from?: string;

  @IsOptional()
  @IsISO8601({}, { message: 'Thời gian kết thúc không hợp lệ' })
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Trang phải là số nguyên' })
  @Min(1, { message: 'Trang phải lớn hơn hoặc bằng 1' })
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'Giới hạn phải là số nguyên' })
  @Min(1, { message: 'Giới hạn phải lớn hơn hoặc bằng 1' })
  @Max(100, { message: 'Giới hạn tối đa là 100' })
  limit = 20;
}
