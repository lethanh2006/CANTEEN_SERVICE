import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Table, TableDocument } from '../../schemas/tables.schema';
import { CreateTableDto } from './dto/create-table.dto';
import { UpdateTableDto } from './dto/update-table.dto';
import { UpdateTableStatusDto } from './dto/update-table-status.dto';
import { AllocateTableDto } from './dto/allocate-table.dto';
import { TableAllocationService, TableItem } from './utils/table-allocation';
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

  /**
   * POST /api/canteen/tables/allocate
   * Phân bổ hoặc gộp bàn tự động theo số lượng khách.
   */
  async allocateTables(dto: AllocateTableDto): Promise<unknown> {
    const emptyTableDocs = await this.model.find({ status: 'empty' }).exec();

    const emptyTables: TableItem[] = emptyTableDocs.map((t) => ({
      id: t._id.toString(),
      name: t.name,
      capacity: t.capacity,
      status: t.status as 'empty',
    }));

    const result = TableAllocationService.allocateTables(
      emptyTables,
      dto.partySize,
    );
    if (!result) {
      throw new ConflictException(
        `Không đủ bàn trống để xếp chỗ cho nhóm ${dto.partySize} người (Tổng sức chứa hiện có: ${emptyTables.reduce((acc, t) => acc + t.capacity, 0)})`,
      );
    }

    // Đánh dấu các bàn vừa được phân bổ là đang sử dụng.
    const objectIds = result.allocatedTableIds.map(
      (id) => new Types.ObjectId(id),
    );
    await this.model
      .updateMany({ _id: { $in: objectIds } }, { $set: { status: 'occupied' } })
      .exec();

    const allocatedTables = await this.model
      .find({ _id: { $in: objectIds } })
      .exec();

    return {
      message: result.isMerged
        ? `Đã gộp ${result.allocatedTableIds.length} bàn thành công cho nhóm ${dto.partySize} người`
        : `Đã phân bổ 1 bàn phù hợp cho nhóm ${dto.partySize} người`,
      allocationDetails: result,
      tables: allocatedTables,
    };
  }

  protected prepareCreate(dto: CreateTableDto): Record<string, unknown> {
    const name = dto.name.trim();
    return {
      ...dto,
      name,
      qrCodeUrl: dto.qrCodeUrl?.trim() || this.buildQrCodeUrl(name),
      status: 'empty',
    };
  }

  protected prepareUpdate(
    dto: UpdateTableDto,
    current: TableDocument,
  ): Record<string, unknown> {
    const name = dto.name?.trim();
    const shouldRegenerateQr =
      name !== undefined &&
      dto.qrCodeUrl === undefined &&
      current.qrCodeUrl === this.buildQrCodeUrl(current.name);

    return {
      ...dto,
      ...(name !== undefined ? { name } : {}),
      ...(dto.qrCodeUrl !== undefined
        ? { qrCodeUrl: dto.qrCodeUrl.trim() }
        : {}),
      ...(shouldRegenerateQr ? { qrCodeUrl: this.buildQrCodeUrl(name) } : {}),
    };
  }

  protected beforeDelete(table: TableDocument): void {
    if (table.status !== 'empty') {
      throw new ConflictException(
        `Không thể xóa bàn '${table.name}' khi trạng thái là '${table.status}'`,
      );
    }
  }

  private buildQrCodeUrl(name: string): string {
    return `https://canteen.domain.com/qr/tables/${encodeURIComponent(name)}`;
  }
}
