import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { Types } from 'mongoose';

/** Kiểm tra tham số đường dẫn có đúng định dạng MongoDB ObjectId hay không. */
@Injectable()
export class ParseObjectIdPipe implements PipeTransform<string, string> {
  constructor(private readonly fieldName = 'ID tài nguyên') {}

  transform(value: string): string {
    if (!Types.ObjectId.isValid(value)) {
      throw new BadRequestException(
        `${this.fieldName} không đúng định dạng ObjectId`,
      );
    }

    return value;
  }
}
