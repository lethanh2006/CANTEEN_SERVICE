import {
  ArgumentMetadata,
  Injectable,
  PipeTransform,
  ValidationPipe,
} from '@nestjs/common';
import type { Type } from '@nestjs/common';

/**
 * Gắn DTO runtime cho controller generic vì generic TypeScript bị xóa khi chạy.
 */
@Injectable()
export class DtoValidationPipe<T extends object> implements PipeTransform {
  private readonly validationPipe = new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  });

  constructor(private readonly dtoType: Type<T>) {}

  transform(value: unknown, metadata: ArgumentMetadata): Promise<T> {
    return this.validationPipe.transform(value, {
      ...metadata,
      type: 'body',
      metatype: this.dtoType,
    }) as Promise<T>;
  }
}
