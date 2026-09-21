import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Role, Roles } from '../../common/auth';
import { ParseObjectIdPipe } from '../../common/parse-object-id.pipe';
import { RolesGuard } from '../../common/roles.guard';
import { CreateTableDto } from './dto/create-table.dto';
import { ListTablesQueryDto } from './dto/list-tables-query.dto';
import { UpdateTableDto } from './dto/update-table.dto';
import { UpdateTableStatusDto } from './dto/update-table-status.dto';
import { TableService } from './table.service';

@Controller('api/canteen/tables')
@UseGuards(RolesGuard)
export class TableController {
  constructor(private readonly tableService: TableService) {}

  @Get()
  async findAll(@Query() query: ListTablesQueryDto) {
    const result = await this.tableService.findAll(query);
    return { success: true, ...result };
  }

  @Get(':id')
  async findOne(@Param('id', new ParseObjectIdPipe('ID bàn ăn')) id: string) {
    return { success: true, data: await this.tableService.findOne(id) };
  }

  @Post()
  @Roles(Role.ADMIN)
  async create(@Body() dto: CreateTableDto) {
    return { success: true, data: await this.tableService.create(dto) };
  }

  @Patch(':id/status')
  @Roles(Role.ADMIN)
  async updateTableStatus(
    @Param('id', new ParseObjectIdPipe('ID bàn ăn')) id: string,
    @Body() dto: UpdateTableStatusDto,
  ) {
    return this.tableService.updateTableStatus(id, dto);
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  async update(
    @Param('id', new ParseObjectIdPipe('ID bàn ăn')) id: string,
    @Body() dto: UpdateTableDto,
  ) {
    return {
      success: true,
      data: await this.tableService.update(id, dto),
    };
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  async delete(@Param('id', new ParseObjectIdPipe('ID bàn ăn')) id: string) {
    return {
      success: true,
      data: await this.tableService.delete(id),
      message: 'Xóa dữ liệu thành công',
    };
  }
}
