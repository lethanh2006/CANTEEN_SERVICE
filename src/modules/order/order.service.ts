import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Order, OrderDocument, OrderItem } from '../../schemas/orders.schema';
import { MenuItem, MenuItemDocument } from '../../schemas/menu_items.schema';
import { CreateOrderDto } from './dto/create-order.dto';
import {
  OrderDiscountCalculator,
  OrderItemPriceInfo,
} from './utils/discount-calculator';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { Table, TableDocument } from '../../schemas/tables.schema';

@Injectable()
export class OrderService {
  constructor(
    @InjectModel(Order.name) private readonly orderModel: Model<OrderDocument>,
    @InjectModel(MenuItem.name)
    private readonly menuItemModel: Model<MenuItemDocument>,
    @InjectModel(Table.name)
    private readonly tableModel: Model<TableDocument>,
    private readonly rabbitMQService: RabbitMQService,
  ) {}

  /**
   * Tạo đơn hàng với trạng thái ban đầu là CREATED.
   */
  async createOrder(
    dto: CreateOrderDto,
    user: AuthenticatedUser,
  ): Promise<Order> {
    const rawUserId = user._id ?? user.id;
    if (!rawUserId || !Types.ObjectId.isValid(rawUserId)) {
      throw new UnauthorizedException(
        'Thông tin người dùng không hợp lệ hoặc thiếu ID người dùng',
      );
    }
    const userId = new Types.ObjectId(rawUserId);
    const userRole = (user.role ?? 'user').toLowerCase();

    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('Đơn hàng phải có ít nhất một món ăn');
    }

    const orderItems: OrderItem[] = [];
    const itemPriceInfos: OrderItemPriceInfo[] = [];

    for (const itemDto of dto.items) {
      const menuItem = await this.menuItemModel
        .findById(itemDto.menuItemId)
        .exec();
      if (!menuItem) {
        throw new NotFoundException(
          `Món ăn với ID '${itemDto.menuItemId}' không tồn tại`,
        );
      }

      if (menuItem.isAvailable === false) {
        throw new ConflictException(
          `Món ăn '${menuItem.name}' tạm thời ngưng phục vụ`,
        );
      }

      let optionsTotalPrice = 0;
      const selectedOptions: Array<{ name: string; price: number }> = [];

      if (itemDto.selectedOptions && itemDto.selectedOptions.length > 0) {
        for (const opt of itemDto.selectedOptions) {
          optionsTotalPrice += opt.price || 0;
          selectedOptions.push({
            name: opt.name,
            price: opt.price || 0,
          });
        }
      }

      const unitPrice = menuItem.price;
      itemPriceInfos.push({
        unitPrice,
        quantity: itemDto.quantity,
        optionsPrice: optionsTotalPrice,
      });

      orderItems.push({
        menuItemId: menuItem._id,
        name: menuItem.name,
        quantity: itemDto.quantity,
        unitPrice: unitPrice,
        selectedOptions: selectedOptions,
        note: itemDto.note || '',
      });
    }

    // Tính tổng tiền và các khoản giảm giá của đơn hàng.
    const discountResult = OrderDiscountCalculator.calculateFinalPrice(
      itemPriceInfos,
      {
        // Khoản trợ cấp có thể được cấu hình theo chính sách doanh nghiệp.
        dailySubsidyAmount: userRole === 'user' || userRole === 'vip' ? 0 : 0,
      },
    );

    const count = await this.orderModel.countDocuments().exec();
    const orderNumber = `#${1001 + count}`;

    const newOrder = new this.orderModel({
      orderNumber,
      userId,
      userRole,
      tableId: dto.tableId ? new Types.ObjectId(dto.tableId) : null,
      items: orderItems,
      totalAmount: discountResult.rawTotal,
      discountAmount: discountResult.totalDiscount,
      finalAmount: discountResult.finalAmount,
      status: 'CREATED',
      priorityScore: 0,
      paymentStatus: 'PENDING',
      paymentMethod: dto.paymentMethod || 'CASH',
    });

    return await newOrder.save();
  }

  /**
   * Xem lịch sử đơn hàng cá nhân
   */
  async getMyOrders(user: AuthenticatedUser): Promise<Order[]> {
    const rawUserId = user._id ?? user.id;
    if (!rawUserId || !Types.ObjectId.isValid(rawUserId)) {
      throw new UnauthorizedException(
        'Thông tin người dùng không hợp lệ hoặc thiếu ID người dùng',
      );
    }

    return await this.orderModel
      .find({ userId: new Types.ObjectId(rawUserId) })
      .sort({ createdAt: -1 })
      .exec();
  }

  /**
   * Lấy thông tin chi tiết của một đơn hàng
   */
  async getOrderById(id: string, user?: AuthenticatedUser): Promise<Order> {
    const order = await this.orderModel.findById(id).exec();
    if (!order) {
      throw new NotFoundException(`Đơn hàng với ID '${id}' không tồn tại`);
    }

    if (user) {
      const requesterId = user._id ?? user.id;
      const privilegedRoles = new Set([
        'admin',
        'manager',
        'cashier',
        'waiter',
        'chef',
      ]);
      if (
        order.userId.toString() !== requesterId &&
        !privilegedRoles.has(user.role?.toLowerCase() ?? '')
      ) {
        throw new UnauthorizedException('Bạn không có quyền xem đơn hàng này');
      }
    }

    return order;
  }

  /**
   * Xác nhận đơn hàng, tính điểm ưu tiên và phát sự kiện chế biến.
   * Công thức: điểm = điểm vai trò * 100 + điểm mang đi * 50 + số phút chờ * 1,5.
   */
  async confirmOrder(id: string): Promise<Order> {
    const order = await this.orderModel.findById(id).exec();
    if (!order) {
      throw new NotFoundException(`Đơn hàng với ID '${id}' không tồn tại`);
    }

    if (order.status !== 'CREATED') {
      throw new ConflictException(
        `Đơn hàng ở trạng thái '${order.status}' không thể xác nhận (chỉ đơn CREATED mới được xác nhận)`,
      );
    }

    // Tính điểm ưu tiên theo vai trò người dùng.
    const roleLower = (order.userRole || '').toLowerCase();
    let userRoleScore = 0;
    if (roleLower === 'vip' || roleLower === 'bgd') {
      userRoleScore = 2;
    } else if (roleLower === 'manager' || roleLower === 'admin') {
      userRoleScore = 1;
    }

    // Đơn mang đi nhận 1 điểm quy đổi, đơn dùng tại bàn nhận 0.
    const isTakeaway = order.tableId ? 0 : 1;

    // Tính tổng số phút khách đã chờ.
    const createdAtTime = order.createdAt.getTime();
    const waitingMinutes = Math.max(
      0,
      Math.floor((Date.now() - createdAtTime) / 60000),
    );

    // Tính điểm ưu tiên cuối cùng.
    const priorityScore =
      userRoleScore * 100 + isTakeaway * 50 + waitingMinutes * 1.5;

    order.status = 'CONFIRMED';
    order.priorityScore = priorityScore;

    const updatedOrder = await order.save();

    await this.rabbitMQService.publish('order.confirmed', {
      orderId: updatedOrder._id.toString(),
      orderNumber: updatedOrder.orderNumber,
      priorityScore: updatedOrder.priorityScore,
      confirmedAt: updatedOrder.updatedAt,
      userRole: updatedOrder.userRole,
      isTakeaway: !updatedOrder.tableId,
    });

    return updatedOrder;
  }

  /**
   * Xác nhận khách đã nhận món và đóng đơn hàng.
   */
  async completeOrder(id: string): Promise<Order> {
    const order = await this.orderModel.findById(id).exec();
    if (!order) {
      throw new NotFoundException(`Đơn hàng với ID '${id}' không tồn tại`);
    }

    if (order.status === 'COMPLETED') {
      throw new ConflictException('Đơn hàng đã được hoàn thành trước đó');
    }

    if (order.status === 'CANCELLED') {
      throw new ConflictException('Đơn hàng đã bị hủy, không thể hoàn thành');
    }

    order.status = 'COMPLETED';
    if (order.paymentStatus === 'PENDING' && order.paymentMethod === 'CASH') {
      order.paymentStatus = 'PAID';
    }

    const updatedOrder = await order.save();
    if (updatedOrder.paymentStatus === 'PAID' && updatedOrder.tableId) {
      await this.tableModel
        .updateOne({ _id: updatedOrder.tableId }, { $set: { status: 'empty' } })
        .exec();
    }

    return updatedOrder;
  }
}
