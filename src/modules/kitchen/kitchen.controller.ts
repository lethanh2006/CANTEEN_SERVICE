import { Controller, Get, Post, Patch, Param, UseGuards } from '@nestjs/common';
import { KitchenService } from './kitchen.service';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';

@Controller('api/canteen/kitchen')
@UseGuards(RolesGuard)
export class KitchenController {
  constructor(private readonly kitchenService: KitchenService) {}

  /**
   * GET /api/canteen/kitchen/queue
   * Xem danh sách các đơn hàng đang chờ trong hàng đợi ưu tiên.
   * Quyền hạn: Đầu bếp / Admin / Manager
   */
  @Get('queue')
  @Roles(Role.CHEF, Role.ADMIN, Role.MANAGER)
  async getQueue() {
    return this.kitchenService.getQueue();
  }

  /**
   * POST /api/canteen/kitchen/next
   * Lấy đơn hàng có độ ưu tiên cao nhất ra khỏi hàng đợi để chế biến.
   * Quyền hạn: Đầu bếp / Admin / Manager
   */
  @Post('next')
  @Roles(Role.CHEF, Role.ADMIN, Role.MANAGER)
  async getNextOrder() {
    return this.kitchenService.getNextOrder();
  }

  /**
   * PATCH /api/canteen/kitchen/orders/:id/cooking
   * Chuyển trạng thái đơn hàng sang COOKING.
   * Quyền hạn: Đầu bếp / Admin / Manager
   */
  @Patch('orders/:id/cooking')
  @Roles(Role.CHEF, Role.ADMIN, Role.MANAGER)
  async setOrderCooking(@Param('id') id: string) {
    return this.kitchenService.setOrderCooking(id);
  }

  /**
   * PATCH /api/canteen/kitchen/orders/:id/ready
   * Đánh dấu món ăn đã chuẩn bị xong, chuyển trạng thái READY.
   * Quyền hạn: Đầu bếp / Admin / Manager
   */
  @Patch('orders/:id/ready')
  @Roles(Role.CHEF, Role.ADMIN, Role.MANAGER)
  async setOrderReady(@Param('id') id: string) {
    return this.kitchenService.setOrderReady(id);
  }
}
