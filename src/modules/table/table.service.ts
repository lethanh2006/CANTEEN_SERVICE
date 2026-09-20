import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Table, TableDocument } from '../../schemas/tables.schema';
import { CreateTableDto } from './dto/create-table.dto';
import { UpdateTableDto } from './dto/update-table.dto';
import { UpdateTableStatusDto } from './dto/update-table-status.dto';
import { BaseCrudService } from '../../common/crud';

@Injectable()
export class TableService extends BaseCrudService<
  TableDocument,
  CreateTableDto,
  UpdateTableDto
> {
  constructor(@InjectModel(Table.name) tableModel: Model<TableDocument>) {
    super(tableModel, {
      resourceName: 'Bàn ăn',
      defaultSort: { field: 'name', order: 'asc' },
      allowedSortFields: [
        'name',
        'capacity',
        'status',
        'createdAt',
        'updatedAt',
      ],
      searchFields: ['name'],
      uniqueFields: ['name'],
    });
  }

  /**
   * PATCH /api/canteen/tables/:id/status
   * Cập nhật trạng thái bàn ăn: trống, đang sử dụng hoặc đã đặt trước.
   */
  async updateTableStatus(
    id: string,
    dto: UpdateTableStatusDto,
  ): Promise<Table> {
    const table = await this.model.findById(id).exec();
    if (!table) {
      throw new NotFoundException(`Bàn ăn với ID '${id}' không tồn tại`);
    }

    table.status = dto.status;
    return await table.save();
  }

  protected prepareCreate(dto: CreateTableDto): Record<string, unknown> {
    const name = dto.name.trim();
    return {
      ...dto,
      name,
      status: 'empty',
    };
  }

  protected prepareUpdate(dto: UpdateTableDto): Record<string, unknown> {
    const name = dto.name?.trim();

    return {
      ...dto,
      ...(name !== undefined ? { name } : {}),
    };
  }

  protected beforeDelete(table: TableDocument): void {
    if (table.status !== 'empty') {
      throw new ConflictException(
        `Không thể xóa bàn '${table.name}' khi trạng thái là '${table.status}'`,
      );
    }
  }
}
