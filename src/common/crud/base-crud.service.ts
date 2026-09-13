import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Document, Model, QueryFilter, UpdateQuery } from 'mongoose';
import { CrudQueryDto } from './crud-query.dto';
import { BaseCrudOptions, CrudListResult } from './crud.types';

interface MongoDuplicateKeyError {
  code?: number;
  keyPattern?: Record<string, number>;
}

export abstract class BaseCrudService<
  TDocument extends Document,
  TCreateDto extends object,
  TUpdateDto extends object,
> {
  protected constructor(
    protected readonly model: Model<TDocument>,
    protected readonly options: BaseCrudOptions<TDocument>,
  ) {}

  async findAll(query: CrudQueryDto): Promise<CrudListResult<TDocument>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const filter = this.buildSearchFilter(query.q);
    const sort = this.resolveSort(query.sortBy, query.sortOrder);

    const [data, total] = await Promise.all([
      this.model
        .find(filter)
        .sort({ [sort.field]: sort.order === 'asc' ? 1 : -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.model
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

  async findOne(id: string): Promise<TDocument> {
    const document = await this.model.findById(id).exec();
    if (!document) {
      throw this.notFound(id);
    }
    return document;
  }

  async create(dto: TCreateDto): Promise<TDocument> {
    const data = await this.prepareCreate(dto);
    await this.ensureUnique(data);
    await this.beforeCreate(data);

    try {
      const document = new this.model(data);
      const saved = await document.save();
      await this.afterCreate(saved);
      return saved;
    } catch (error: unknown) {
      this.rethrowPersistenceError(error);
    }
  }

  async update(id: string, dto: TUpdateDto): Promise<TDocument> {
    const current = await this.findOne(id);
    const data = await this.prepareUpdate(dto, current);
    if (Object.keys(data).length === 0) {
      throw new BadRequestException(
        'Cần cung cấp ít nhất một trường để cập nhật',
      );
    }
    await this.ensureUnique(data, id);
    await this.beforeUpdate(current, data);

    try {
      current.set(data as UpdateQuery<TDocument>);
      const saved = await current.save();
      await this.afterUpdate(saved);
      return saved;
    } catch (error: unknown) {
      this.rethrowPersistenceError(error);
    }
  }

  async delete(id: string): Promise<TDocument> {
    const current = await this.findOne(id);
    await this.beforeDelete(current);
    await current.deleteOne();
    await this.afterDelete(current);
    return current;
  }

  protected prepareCreate(
    dto: TCreateDto,
  ): Record<string, unknown> | Promise<Record<string, unknown>> {
    return { ...(dto as Record<string, unknown>) };
  }

  protected prepareUpdate(
    dto: TUpdateDto,
    current: TDocument,
  ): Record<string, unknown> | Promise<Record<string, unknown>> {
    void current;
    return { ...(dto as Record<string, unknown>) };
  }

  protected beforeCreate(data: Record<string, unknown>): void | Promise<void> {
    void data;
  }

  protected afterCreate(document: TDocument): void | Promise<void> {
    void document;
  }

  protected beforeUpdate(
    current: TDocument,
    data: Record<string, unknown>,
  ): void | Promise<void> {
    void current;
    void data;
  }

  protected afterUpdate(document: TDocument): void | Promise<void> {
    void document;
  }

  protected beforeDelete(document: TDocument): void | Promise<void> {
    void document;
  }

  protected afterDelete(document: TDocument): void | Promise<void> {
    void document;
  }

  private buildSearchFilter(search?: string): QueryFilter<TDocument> {
    const q = search?.trim();
    const fields = this.options.searchFields ?? [];
    if (!q || fields.length === 0) {
      return {};
    }

    const safeQuery = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return {
      $or: fields.map((field) => ({
        [field]: { $regex: safeQuery, $options: 'i' },
      })),
    };
  }

  private resolveSort(
    requestedField?: string,
    requestedOrder?: 'asc' | 'desc',
  ): { field: string; order: 'asc' | 'desc' } {
    const fallback = this.options.defaultSort ?? {
      field: 'createdAt',
      order: 'desc' as const,
    };
    const field = requestedField ?? fallback.field;
    const allowedFields = this.options.allowedSortFields ?? [fallback.field];

    if (!allowedFields.includes(field)) {
      throw new BadRequestException(
        `Không hỗ trợ sắp xếp theo '${field}'. Các trường hợp lệ: ${allowedFields.join(', ')}`,
      );
    }

    return { field, order: requestedOrder ?? fallback.order };
  }

  private async ensureUnique(
    data: Record<string, unknown>,
    excludeId?: string,
  ): Promise<void> {
    for (const field of this.options.uniqueFields ?? []) {
      if (data[field] === undefined) {
        continue;
      }

      const filter: QueryFilter<TDocument> = {
        [field]: data[field],
        ...(excludeId ? { _id: { $ne: excludeId } } : {}),
      };
      const exists = await this.model.exists(filter).exec();
      if (exists) {
        throw new ConflictException(
          `${this.options.resourceName} có ${field} '${this.formatValue(data[field])}' đã tồn tại`,
        );
      }
    }
  }

  private notFound(id: string): NotFoundException {
    return new NotFoundException(
      `${this.options.resourceName} với ID '${id}' không tồn tại`,
    );
  }

  private rethrowPersistenceError(error: unknown): never {
    if (this.isDuplicateKeyError(error)) {
      const field = Object.keys(error.keyPattern ?? {})[0] ?? 'dữ liệu';
      throw new ConflictException(
        `${this.options.resourceName} có ${field} bị trùng`,
      );
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

  private formatValue(value: unknown): string {
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      typeof value === 'bigint'
    ) {
      return `${value}`;
    }
    return JSON.stringify(value) ?? '[giá trị]';
  }
}
