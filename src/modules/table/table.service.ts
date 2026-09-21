import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, QueryFilter } from 'mongoose';
import { Table, TableDocument } from '../../schemas/tables.schema';
import { CreateTableDto } from './dto/create-table.dto';
import { ListTablesQueryDto } from './dto/list-tables-query.dto';
import { UpdateTableDto } from './dto/update-table.dto';
import { UpdateTableStatusDto } from './dto/update-table-status.dto';

interface MongoDuplicateKeyError {
  code?: number;
  keyPattern?: Record<string, number>;
}

const TABLE_SORT_FIELDS: readonly string[] = [
  'name',
  'capacity',
  'status',
  'createdAt',
  'updatedAt',
];

@Injectable()
export class TableService {
  constructor(
    @InjectModel(Table.name)
    private readonly tableModel: Model<TableDocument>,
  ) {}

  async findAll(query: ListTablesQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const sortBy = query.sortBy ?? 'name';
    const sortOrder = query.sortOrder ?? 'asc';

    if (!TABLE_SORT_FIELDS.includes(sortBy)) {
      throw new BadRequestException(
        `Không hỗ trợ sắp xếp theo '${sortBy}'. Các trường hợp lệ: ${TABLE_SORT_FIELDS.join(', ')}`,
      );
    }

    const filter = this.buildSearchFilter(query.q);
    const [data, total] = await Promise.all([
      this.tableModel
        .find(filter)
        .sort({ [sortBy]: sortOrder === 'asc' ? 1 : -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.tableModel
        .countDocuments(
          filter,
          Object.keys(filter).length === 0 ? { hint: '_id_' } : {},
        )
        .exec(),
    ]);

    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages: total === 0 ? 0 : Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string): Promise<TableDocument> {
    const table = await this.tableModel.findById(id).exec();
    if (!table) {
      throw new NotFoundException(`Bàn ăn với ID '${id}' không tồn tại`);
    }

    return table;
  }

  async create(dto: CreateTableDto): Promise<TableDocument> {
    const data = {
      ...dto,
      name: dto.name.trim(),
      status: 'empty',
    };
    await this.ensureUniqueName(data.name);

    try {
      return await new this.tableModel(data).save();
    } catch (error: unknown) {
      this.rethrowPersistenceError(error);
    }
  }

  async update(id: string, dto: UpdateTableDto): Promise<TableDocument> {
    const table = await this.findOne(id);
    const data = {
      ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
      ...(dto.capacity !== undefined ? { capacity: dto.capacity } : {}),
    };

    if (Object.keys(data).length === 0) {
      throw new BadRequestException(
        'Cần cung cấp ít nhất một trường để cập nhật',
      );
    }
    if (data.name !== undefined) {
      await this.ensureUniqueName(data.name, id);
    }

    try {
      table.set(data);
      return await table.save();
    } catch (error: unknown) {
      this.rethrowPersistenceError(error);
    }
  }

  async delete(id: string): Promise<TableDocument> {
    const table = await this.findOne(id);
    if (table.status !== 'empty') {
      throw new ConflictException(
        `Không thể xóa bàn '${table.name}' khi trạng thái là '${table.status}'`,
      );
    }

    await table.deleteOne();
    return table;
  }

  /** Cập nhật trạng thái bàn ăn: trống, đang sử dụng hoặc đã đặt trước. */
  async updateTableStatus(
    id: string,
    dto: UpdateTableStatusDto,
  ): Promise<TableDocument> {
    const table = await this.findOne(id);
    table.status = dto.status;
    return await table.save();
  }

  private buildSearchFilter(search?: string): QueryFilter<TableDocument> {
    const keyword = search?.trim();
    if (!keyword) {
      return {};
    }

    const safeKeyword = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return { name: { $regex: safeKeyword, $options: 'i' } };
  }

  private async ensureUniqueName(name: string, excludeId?: string) {
    const exists = await this.tableModel
      .exists({
        name,
        ...(excludeId ? { _id: { $ne: excludeId } } : {}),
      })
      .exec();
    if (exists) {
      throw new ConflictException(`Bàn ăn có name '${name}' đã tồn tại`);
    }
  }

  private rethrowPersistenceError(error: unknown): never {
    if (this.isDuplicateKeyError(error)) {
      const field = Object.keys(error.keyPattern ?? {})[0] ?? 'dữ liệu';
      throw new ConflictException(`Bàn ăn có ${field} bị trùng`);
    }
    throw error;
  }

  private isDuplicateKeyError(
    error: unknown,
  ): error is MongoDuplicateKeyError & { code: 11000 } {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 11000
    );
  }
}
