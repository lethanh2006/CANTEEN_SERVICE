import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { TableService } from './table.service';
import { CreateTableDto } from './dto/create-table.dto';
import { UpdateTableStatusDto } from './dto/update-table-status.dto';
import { AllocateTableDto } from './dto/allocate-table.dto';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';

@Controller('api/canteen/tables')
@UseGuards(RolesGuard)
export class TableController {
  constructor(private readonly tableService: TableService) {}

  /**
   * GET /api/canteen/tables
   * Lấy danh sách tất cả các bàn ăn
   */
  @Get()
  async getAllTables() {
    return this.tableService.getAllTables();
  }

  /**
   * GET /api/canteen/tables/:id
   * Lấy thông tin bàn ăn theo ID
   */
  @Get(':id')
  async getTableById(
    @Param('id', new ParseObjectIdPipe('ID bàn ăn')) id: string,
  ) {
    return this.tableService.getTableById(id);
  }

  /**
   * POST /api/canteen/tables
   * Khởi tạo bàn ăn mới
   * Quyền hạn: Quản trị viên hoặc quản lý.
   */
  @Post()
  @Roles(Role.ADMIN, Role.MANAGER)
  async createTable(@Body() createTableDto: CreateTableDto) {
    return this.tableService.createTable(createTableDto);
  }

  /**
   * PATCH /api/canteen/tables/:id/status
   * Cập nhật trạng thái bàn ăn
   * Quyền hạn: Quản trị viên, quản lý hoặc nhân viên phục vụ.
   */
  @Patch(':id/status')
  @Roles(Role.ADMIN, Role.MANAGER, Role.WAITER)
  async updateTableStatus(
    @Param('id', new ParseObjectIdPipe('ID bàn ăn')) id: string,
    @Body() updateStatusDto: UpdateTableStatusDto,
  ) {
    return this.tableService.updateTableStatus(id, updateStatusDto);
  }

  /**
   * POST /api/canteen/tables/allocate
   * Phân bổ hoặc gộp bàn tự động cho nhóm khách.
   * Quyền hạn: Quản trị viên, quản lý hoặc nhân viên phục vụ.
   */
  @Post('allocate')
  @Roles(Role.ADMIN, Role.MANAGER, Role.WAITER)
  async allocateTables(@Body() allocateTableDto: AllocateTableDto) {
    return this.tableService.allocateTables(allocateTableDto);
  }
}
