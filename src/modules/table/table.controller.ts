import { Controller, Patch, Body, Param, UseGuards } from '@nestjs/common';
import { TableService } from './table.service';
import { CreateTableDto } from './dto/create-table.dto';
import { UpdateTableDto } from './dto/update-table.dto';
import { UpdateTableStatusDto } from './dto/update-table-status.dto';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import { createCrudController } from '../../common/crud';
import { TableDocument } from '../../schemas/tables.schema';

const TableCrudController = createCrudController<
  TableDocument,
  CreateTableDto,
  UpdateTableDto
>({
  createDto: CreateTableDto,
  updateDto: UpdateTableDto,
  idFieldName: 'ID bàn ăn',
  writeRoles: [Role.ADMIN],
});

@Controller('api/canteen/tables')
@UseGuards(RolesGuard)
export class TableController extends TableCrudController {
  constructor(private readonly tableService: TableService) {
    super(tableService);
  }

  /**
   * PATCH /api/canteen/tables/:id/status
   * Cập nhật trạng thái bàn ăn
   * Quyền hạn: Quản trị viên, quản lý hoặc nhân viên phục vụ.
   */
  @Patch(':id/status')
  @Roles(Role.ADMIN)
  async updateTableStatus(
    @Param('id', new ParseObjectIdPipe('ID bàn ăn')) id: string,
    @Body() updateStatusDto: UpdateTableStatusDto,
  ) {
    return this.tableService.updateTableStatus(id, updateStatusDto);
  }
}
