import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { OrderService } from './order.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { Authenticated } from '../../common/decorators/authenticated.decorator';
import { type AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { Role } from '../../common/enums/role.enum';
import { Roles } from '../../common/decorators/roles.decorator';
import { User } from '../../common/decorators/user.decorator';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import { RolesGuard } from '../../common/guards/roles.guard';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto';
import { CancelOrderDto } from './dto/cancel-order.dto';

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
   * GET /api/canteen/orders
   * Danh sách vận hành có lọc và phân trang.
   */
  @Get()
  @Roles(Role.ADMIN)
  async listOrders(@Query() query: ListOrdersQueryDto) {
    return this.orderService.listOrders(query);
  }

  /**
   * GET /api/canteen/orders/:id
   * Lấy thông tin chi tiết của một đơn hàng
   * Quyền hạn: Chủ đơn hoặc quản trị viên.
   */
  @Get(':id')
  @Authenticated()
  async getOrderById(
    @Param('id', new ParseObjectIdPipe('ID đơn hàng')) id: string,
    @User() user: AuthenticatedUser,
  ) {
    return this.orderService.getOrderById(id, user);
  }

  /**
   * PATCH /api/canteen/orders/:id/cancel
   * Chủ đơn hoặc admin được hủy đơn mới, chưa thanh toán.
   */
  @Patch(':id/cancel')
  @Authenticated()
  async cancelOrder(
    @Param('id', new ParseObjectIdPipe('ID đơn hàng')) id: string,
    @Body() body: CancelOrderDto,
    @User() user: AuthenticatedUser,
  ) {
    return this.orderService.cancelOrder(id, user, body.reason);
  }

  /** PATCH /api/canteen/orders/:id/payment/cash — admin xác nhận đã thu tiền mặt. */
  @Patch(':id/payment/cash')
  @Roles(Role.ADMIN)
  async confirmCashPayment(
    @Param('id', new ParseObjectIdPipe('ID đơn hàng')) id: string,
    @User() user: AuthenticatedUser,
  ) {
    return this.orderService.confirmCashPayment(id, user);
  }
}
