import { Controller, Get, Post, Patch, Body, Param, UseGuards } from '@nestjs/common';
import { TableService } from './table.service';
import { CreateTableDto } from './dto/create-table.dto';
import { UpdateTableStatusDto } from './dto/update-table-status.dto';
import { AllocateTableDto } from './dto/allocate-table.dto';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';

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
  async getTableById(@Param('id') id: string) {
    return this.tableService.getTableById(id);
  }

  /**
   * POST /api/canteen/tables
   * Khởi tạo bàn ăn mới
   * Quyền hạn: Admin / Manager
   */
  @Post()
  @Roles(Role.ADMIN, Role.MANAGER)
  async createTable(@Body() createTableDto: CreateTableDto) {
    return this.tableService.createTable(createTableDto);
  }

  /**
   * PATCH /api/canteen/tables/:id/status
   * Cập nhật trạng thái bàn ăn
   * Quyền hạn: Admin / Manager / Waiter
   */
  @Patch(':id/status')
  @Roles(Role.ADMIN, Role.MANAGER, Role.WAITER)
  async updateTableStatus(
    @Param('id') id: string,
    @Body() updateStatusDto: UpdateTableStatusDto,
  ) {
    return this.tableService.updateTableStatus(id, updateStatusDto);
  }

  /**
   * POST /api/canteen/tables/allocate
   * Giải thuật Phân Bổ & Gộp Bàn Tự Động cho nhóm khách
   * Quyền hạn: Admin / Manager / Waiter
   */
  @Post('allocate')
  @Roles(Role.ADMIN, Role.MANAGER, Role.WAITER)
  async allocateTables(@Body() allocateTableDto: AllocateTableDto) {
    return this.tableService.allocateTables(allocateTableDto);
  }
}
