import type { Type } from '@nestjs/common';
import type { Document } from 'mongoose';

export interface CrudListResult<T> {
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface CrudResponse<T> {
  success: true;
  data: T;
  message?: string;
}

export interface CrudListResponse<T> extends CrudResponse<T[]> {
  meta: CrudListResult<T>['meta'];
}

export interface BaseCrudOptions<TDocument extends Document> {
  resourceName: string;
  defaultSort?: {
    field: string;
    order: 'asc' | 'desc';
  };
  allowedSortFields?: readonly string[];
  searchFields?: readonly string[];
  uniqueFields?: readonly (keyof TDocument & string)[];
}

export interface CrudControllerOptions<
  TCreateDto extends object,
  TUpdateDto extends object,
> {
  createDto: Type<TCreateDto>;
  updateDto: Type<TUpdateDto>;
  idFieldName?: string;
  writeRoles?: readonly string[];
}
