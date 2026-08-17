import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { InventoryService } from './inventory.service';
import { CreateInventoryBatchDto } from './dto/create-inventory-batch.dto';
import { ConsumeIngredientDto } from './dto/consume-ingredient.dto';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';

@Controller('api/canteen/inventory')
@UseGuards(RolesGuard)
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  /**
   * POST /api/canteen/inventory/batches
   * Nhập lô hàng mới vào Min Heap quản lý hạn sử dụng.
   * Quyền hạn: Quản trị viên hoặc quản lý.
   */
  @Post('batches')
  @Roles(Role.ADMIN, Role.MANAGER)
  async createBatch(@Body() dto: CreateInventoryBatchDto) {
    return this.inventoryService.createBatch(dto);
  }

  /**
   * GET /api/canteen/inventory/expiry-alerts
   * Lấy danh sách lô nguyên liệu cần sử dụng trước theo hạn dùng.
   * Quyền hạn: Quản trị viên, quản lý hoặc đầu bếp.
   */
  @Get('expiry-alerts')
  @Roles(Role.ADMIN, Role.MANAGER, Role.CHEF)
  async getExpiryAlerts() {
    return this.inventoryService.getExpiryAlerts();
  }

  /**
   * POST /api/canteen/inventory/consume
   * Khấu trừ nguyên liệu sau khi nấu ăn (tự động trừ lô hết hạn trước).
   * Quyền hạn: Đầu bếp, quản trị viên hoặc quản lý.
   */
  @Post('consume')
  @Roles(Role.CHEF, Role.ADMIN, Role.MANAGER)
  async consumeIngredient(@Body() dto: ConsumeIngredientDto) {
    return this.inventoryService.consumeIngredient(dto);
  }
}
