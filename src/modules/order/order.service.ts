import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, QueryFilter, Types } from 'mongoose';
import { Order, OrderDocument, OrderItem } from '../../schemas/orders.schema';
import { MenuItem, MenuItemDocument } from '../../schemas/menu_items.schema';
import { CreateOrderDto } from './dto/create-order.dto';
import {
  OrderDiscountCalculator,
  OrderItemPriceInfo,
} from './utils/discount-calculator';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';
import { OrderSettlementService } from './order-settlement.service';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto';

@Injectable()
export class OrderService {
  constructor(
    @InjectModel(Order.name) private readonly orderModel: Model<OrderDocument>,
    @InjectModel(MenuItem.name)
    private readonly menuItemModel: Model<MenuItemDocument>,
    private readonly orderSettlementService: OrderSettlementService,
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

      const selectedOptions = this.resolveSelectedOptions(
        menuItem,
        itemDto.selectedOptions,
      );
      const optionsTotalPrice = selectedOptions.reduce(
        (total, option) => total + option.price,
        0,
      );

      const unitPrice = menuItem.price;
      if (!Number.isSafeInteger(unitPrice) || unitPrice < 0) {
        throw new ConflictException(
          `Giá món '${menuItem.name}' không phải số nguyên VND hợp lệ`,
        );
      }
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
    if (
      !Number.isSafeInteger(discountResult.rawTotal) ||
      !Number.isSafeInteger(discountResult.totalDiscount) ||
      !Number.isSafeInteger(discountResult.finalAmount)
    ) {
      throw new ConflictException(
        'Tổng tiền đơn hàng không phải số nguyên VND an toàn',
      );
    }

    const paymentMethod = dto.paymentMethod ?? 'CASH';
    if (paymentMethod === 'VIETQR' && discountResult.finalAmount === 0) {
      throw new BadRequestException(
        'Đơn hàng 0 đồng không cần và không thể thanh toán bằng VIETQR',
      );
    }

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
      paymentMethod,
    });

    return await newOrder.save();
  }

  /**
   * Giá option luôn được lấy từ MenuItem trong MongoDB. Trường `price` mà
   * client cũ gửi lên chỉ được giữ để tương thích DTO và không tham gia tính
   * tiền.
   */
  private resolveSelectedOptions(
    menuItem: MenuItemDocument,
    requestedOptions: Array<{ name: string }> | undefined,
  ): Array<{ name: string; price: number }> {
    if (!requestedOptions?.length) {
      return [];
    }

    const availableOptions = new Map(
      (menuItem.options ?? []).map((option) => [
        this.normalizeOptionName(option.name),
        option,
      ]),
    );
    const selectedNames = new Set<string>();

    return requestedOptions.map((requested) => {
      const normalizedName = this.normalizeOptionName(requested.name);
      const authoritative = availableOptions.get(normalizedName);
      if (!authoritative) {
        throw new BadRequestException(
          `Tùy chọn '${requested.name}' không tồn tại trong món '${menuItem.name}'`,
        );
      }
      if (selectedNames.has(normalizedName)) {
        throw new BadRequestException(
          `Tùy chọn '${requested.name}' bị chọn trùng trong món '${menuItem.name}'`,
        );
      }
      if (
        !Number.isSafeInteger(authoritative.price) ||
        authoritative.price < 0
      ) {
        throw new ConflictException(
          `Giá tùy chọn '${authoritative.name}' của món '${menuItem.name}' không hợp lệ`,
        );
      }

      selectedNames.add(normalizedName);
      return {
        name: authoritative.name,
        price: authoritative.price,
      };
    });
  }

  private normalizeOptionName(name: string): string {
    return name.trim().normalize('NFKC').toLocaleLowerCase('vi-VN');
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
   * Danh sách đơn dành cho màn hình vận hành căn tin.
   */
  async listOrders(query: ListOrdersQueryDto) {
    const filter: QueryFilter<OrderDocument> = {};
    if (query.status) filter.status = query.status;
    if (query.paymentStatus) filter.paymentStatus = query.paymentStatus;
    if (query.userId) filter.userId = new Types.ObjectId(query.userId);

    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;
    if (from && to && from > to) {
      throw new BadRequestException(
        'Thời gian bắt đầu phải nhỏ hơn hoặc bằng thời gian kết thúc',
      );
    }
    if (from || to) {
      filter.createdAt = {
        ...(from ? { $gte: from } : {}),
        ...(to ? { $lte: to } : {}),
      };
    }

    const page = query.page || 1;
    const limit = query.limit || 20;
    const [orders, total] = await Promise.all([
      this.orderModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .exec(),
      this.orderModel.countDocuments(filter).exec(),
    ]);

    return {
      orders,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
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
        throw new ForbiddenException('Bạn không có quyền xem đơn hàng này');
      }
    }

    return order;
  }

  /**
   * Hủy đơn có kiểm tra chủ sở hữu, vai trò và trạng thái hiện tại.
   */
  async cancelOrder(
    id: string,
    user: AuthenticatedUser,
    reason?: string,
  ): Promise<Order> {
    const rawUserId = user._id ?? user.id;
    if (!rawUserId || !Types.ObjectId.isValid(rawUserId)) {
      throw new UnauthorizedException(
        'Thông tin người dùng không hợp lệ hoặc thiếu ID người dùng',
      );
    }

    const order = await this.orderModel.findById(id).exec();
    if (!order) {
      throw new NotFoundException(`Đơn hàng với ID '${id}' không tồn tại`);
    }

    const isOwner = order.userId.toString() === rawUserId;
    const isOperator = new Set(['admin', 'manager', 'cashier', 'waiter']).has(
      user.role?.toLowerCase() ?? '',
    );
    if (!isOwner && !isOperator) {
      throw new ForbiddenException('Bạn không có quyền hủy đơn hàng này');
    }

    if (order.status === 'CANCELLED') {
      return order;
    }
    const allowedStatuses = isOperator
      ? new Set(['CREATED', 'CONFIRMED'])
      : new Set(['CREATED']);
    if (!allowedStatuses.has(order.status)) {
      throw new ConflictException(
        `Đơn hàng ở trạng thái '${order.status}' không thể hủy`,
      );
    }

    order.status = 'CANCELLED';
    order.cancelledAt = new Date();
    order.cancelledBy = new Types.ObjectId(rawUserId);
    order.cancellationReason = reason?.trim() || undefined;
    const cancelledOrder = await order.save();
    await this.orderSettlementService.reconcileTableForOrder(
      cancelledOrder._id,
    );
    return cancelledOrder;
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
      await this.orderSettlementService.reconcileTableForOrder(order._id);
      return order;
    }

    if (order.status !== 'READY') {
      throw new ConflictException(
        `Đơn hàng ở trạng thái '${order.status}' không thể hoàn thành (chỉ đơn READY mới được hoàn thành)`,
      );
    }

    order.status = 'COMPLETED';
    if (order.paymentStatus === 'PENDING' && order.paymentMethod === 'CASH') {
      order.paymentStatus = 'PAID';
    }

    const updatedOrder = await order.save();
    await this.orderSettlementService.reconcileTableForOrder(updatedOrder._id);

    return updatedOrder;
  }
}
