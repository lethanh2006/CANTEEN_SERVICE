import { Controller, Get, Post, Patch, Body, Param, UseGuards } from '@nestjs/common';
import { OrderService } from './order.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { User } from '../../common/decorators/user.decorator';

@Controller('api/canteen/orders')
@UseGuards(RolesGuard)
export class OrderController {
  constructor(private readonly orderService: OrderService) {}

  /**
   * POST /api/canteen/orders
   * Tạo giỏ hàng và đặt món (Trạng thái ban đầu: CREATED)
   * Quyền hạn: Nhân viên (Logged-in user)
   */
  @Post()
  async createOrder(
    @Body() createOrderDto: CreateOrderDto,
    @User() user: any,
  ) {
    return this.orderService.createOrder(createOrderDto, user);
  }

  /**
   * GET /api/canteen/orders/my-orders
   * Xem lịch sử đơn hàng cá nhân
   * Quyền hạn: Nhân viên (Logged-in user)
   */
  @Get('my-orders')
  async getMyOrders(@User() user: any) {
    return this.orderService.getMyOrders(user);
  }

  /**
   * GET /api/canteen/orders/:id
   * Lấy thông tin chi tiết của một đơn hàng
   * Quyền hạn: Nhân viên / Bếp
   */
  @Get(':id')
  async getOrderById(@Param('id') id: string) {
    return this.orderService.getOrderById(id);
  }

  /**
   * PATCH /api/canteen/orders/:id/confirm
   * Xác nhận đơn hàng, tính điểm ưu tiên và gửi sự kiện chế biến
   * Quyền hạn: Thu ngân / Admin / Manager
   */
  @Patch(':id/confirm')
  @Roles('admin', 'manager', 'cashier', 'waiter')
  async confirmOrder(@Param('id') id: string) {
    return this.orderService.confirmOrder(id);
  }

  /**
   * PATCH /api/canteen/orders/:id/complete
   * Xác nhận khách đã nhận món ăn thành công, đóng Order
   * Quyền hạn: Thu ngân / Admin / Manager
   */
  @Patch(':id/complete')
  @Roles('admin', 'manager', 'cashier', 'waiter')
  async completeOrder(@Param('id') id: string) {
    return this.orderService.completeOrder(id);
  }
}
