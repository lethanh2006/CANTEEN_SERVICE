import {
  applyDecorators,
  Body,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type { Document } from 'mongoose';
import { Roles } from '../decorators/roles.decorator';
import { ParseObjectIdPipe } from '../pipes/parse-object-id.pipe';
import { BaseCrudService } from './base-crud.service';
import { CrudQueryDto } from './crud-query.dto';
import { DtoValidationPipe } from './dto-validation.pipe';
import {
  CrudControllerOptions,
  CrudListResponse,
  CrudResponse,
} from './crud.types';

type CrudControllerConstructor<
  TDocument extends Document,
  TCreateDto extends object,
  TUpdateDto extends object,
> = new (
  service: BaseCrudService<TDocument, TCreateDto, TUpdateDto>,
) => BaseCrudController<TDocument, TCreateDto, TUpdateDto>;

export abstract class BaseCrudController<
  TDocument extends Document,
  TCreateDto extends object,
  TUpdateDto extends object,
> {
  constructor(
    protected readonly service: BaseCrudService<
      TDocument,
      TCreateDto,
      TUpdateDto
    >,
  ) { }
}


export function createCrudController<
  TDocument extends Document,
  TCreateDto extends object,
  TUpdateDto extends object,
>(
  options: CrudControllerOptions<TCreateDto, TUpdateDto>,
): CrudControllerConstructor<TDocument, TCreateDto, TUpdateDto> {
  const idPipe = new ParseObjectIdPipe(options.idFieldName);
  const createPipe = new DtoValidationPipe(options.createDto);
  const updatePipe = new DtoValidationPipe(options.updateDto);
  const writeRoles = options.writeRoles ?? [];
  const WriteAuthorization = applyDecorators(
    ...(writeRoles.length > 0 ? [Roles(...writeRoles)] : []),
  );

  class CrudController extends BaseCrudController<
    TDocument,
    TCreateDto,
    TUpdateDto
  > {
    @Get()
    async findAll(
      @Query() query: CrudQueryDto,
    ): Promise<CrudListResponse<TDocument>> {
      const result = await this.service.findAll(query);
      return { success: true, ...result };
    }

    @Get(':id')
    async findOne(
      @Param('id', idPipe) id: string,
    ): Promise<CrudResponse<TDocument>> {
      return { success: true, data: await this.service.findOne(id) };
    }

    @Post()
    @WriteAuthorization
    async create(
      @Body(createPipe) dto: TCreateDto,
    ): Promise<CrudResponse<TDocument>> {
      return { success: true, data: await this.service.create(dto) };
    }

    @Patch(':id')
    @WriteAuthorization
    async update(
      @Param('id', idPipe) id: string,
      @Body(updatePipe) dto: TUpdateDto,
    ): Promise<CrudResponse<TDocument>> {
      return { success: true, data: await this.service.update(id, dto) };
    }

    @Delete(':id')
    @WriteAuthorization
    async delete(
      @Param('id', idPipe) id: string,
    ): Promise<CrudResponse<TDocument>> {
      return {
        success: true,
        data: await this.service.delete(id),
        message: 'Xóa dữ liệu thành công',
      };
    }
  }

  return CrudController;
}
