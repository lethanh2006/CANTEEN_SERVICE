import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { OrderService } from './order.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { User } from '../../common/decorators/user.decorator';
import { Role } from '../../common/enums/role.enum';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import type { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { Authenticated } from '../../common/decorators/authenticated.decorator';

@Controller('api/canteen/orders')
@UseGuards(RolesGuard)
export class OrderController {
  constructor(private readonly orderService: OrderService) {}

  /**
   * POST /api/canteen/orders
   * Tạo đơn hàng với trạng thái ban đầu là CREATED.
   * Quyền hạn: Người dùng đã đăng nhập.
   */
  @Post()
  @Authenticated()
  async createOrder(
    @Body() createOrderDto: CreateOrderDto,
    @User() user: AuthenticatedUser,
  ) {
    return this.orderService.createOrder(createOrderDto, user);
  }

  /**
   * GET /api/canteen/orders/my-orders
   * Xem lịch sử đơn hàng cá nhân
   * Quyền hạn: Người dùng đã đăng nhập.
   */
  @Get('my-orders')
  @Authenticated()
  async getMyOrders(@User() user: AuthenticatedUser) {
    return this.orderService.getMyOrders(user);
  }

  /**
   * GET /api/canteen/orders/:id
   * Lấy thông tin chi tiết của một đơn hàng
   * Quyền hạn: Nhân viên hoặc bộ phận bếp.
   */
  @Get(':id')
  @Authenticated()
  async getOrderById(
    @Param('id', new ParseObjectIdPipe('ID đơn hàng')) id: string,
  ) {
    return this.orderService.getOrderById(id);
  }

  /**
   * PATCH /api/canteen/orders/:id/confirm
   * Xác nhận đơn hàng, tính điểm ưu tiên và gửi sự kiện chế biến
   * Quyền hạn: Thu ngân, quản trị viên, quản lý hoặc nhân viên phục vụ.
   */
  @Patch(':id/confirm')
  @Roles(Role.ADMIN, Role.MANAGER, Role.CASHIER, Role.WAITER)
  async confirmOrder(
    @Param('id', new ParseObjectIdPipe('ID đơn hàng')) id: string,
  ) {
    return this.orderService.confirmOrder(id);
  }

  /**
   * PATCH /api/canteen/orders/:id/complete
   * Xác nhận khách đã nhận món và đóng đơn hàng.
   * Quyền hạn: Thu ngân, quản trị viên, quản lý hoặc nhân viên phục vụ.
   */
  @Patch(':id/complete')
  @Roles(Role.ADMIN, Role.MANAGER, Role.CASHIER, Role.WAITER)
  async completeOrder(
    @Param('id', new ParseObjectIdPipe('ID đơn hàng')) id: string,
  ) {
    return this.orderService.completeOrder(id);
  }
}
