import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Order, OrderDocument } from '../../schemas/orders.schema';
import { MenuItem, MenuItemDocument } from '../../schemas/menu_items.schema';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderDiscountCalculator, OrderItemPriceInfo } from './utils/discount-calculator';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';

@Injectable()
export class OrderService {
  constructor(
    @InjectModel(Order.name) private readonly orderModel: Model<OrderDocument>,
    @InjectModel(MenuItem.name) private readonly menuItemModel: Model<MenuItemDocument>,
    private readonly rabbitMQService: RabbitMQService,
  ) {}

  /**
   * Tạo giỏ hàng và đặt món (Trạng thái ban đầu: CREATED)
   */
  async createOrder(dto: CreateOrderDto, user: any): Promise<Order> {
    const rawUserId = user?._id || user?.id;
    if (!rawUserId || !Types.ObjectId.isValid(rawUserId)) {
      throw new BadRequestException('Thông tin người dùng không hợp lệ hoặc thiếu User ID');
    }
    const userId = new Types.ObjectId(rawUserId);
    const userRole = (user?.role || 'user').toLowerCase();

    if (!dto.items || dto.items.length === 0) {
      throw new BadRequestException('Đơn hàng phải có ít nhất một món ăn');
    }

    if (dto.tableId && !Types.ObjectId.isValid(dto.tableId)) {
      throw new BadRequestException('ID bàn ăn (tableId) không đúng định dạng ObjectId');
    }

    const orderItems: any[] = [];
    const itemPriceInfos: OrderItemPriceInfo[] = [];

    for (const itemDto of dto.items) {
      if (!Types.ObjectId.isValid(itemDto.menuItemId)) {
        throw new BadRequestException(`ID món ăn '${itemDto.menuItemId}' không đúng định dạng ObjectId`);
      }

      const menuItem = await this.menuItemModel.findById(itemDto.menuItemId).exec();
      if (!menuItem) {
        throw new NotFoundException(`Món ăn với ID '${itemDto.menuItemId}' không tồn tại`);
      }

      if (menuItem.isAvailable === false) {
        throw new BadRequestException(`Món ăn '${menuItem.name}' tạm thời ngưng phục vụ`);
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

    // Calculate totals & discounts via OrderDiscountCalculator
    const discountResult = OrderDiscountCalculator.calculateFinalPrice(itemPriceInfos, {
      dailySubsidyAmount: userRole === 'user' || userRole === 'vip' ? 0 : 0, // Adjustable business subsidy
    });

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
  async getMyOrders(user: any): Promise<Order[]> {
    const rawUserId = user?._id || user?.id;
    if (!rawUserId || !Types.ObjectId.isValid(rawUserId)) {
      throw new BadRequestException('Thông tin người dùng không hợp lệ hoặc thiếu User ID');
    }

    return await this.orderModel
      .find({ userId: new Types.ObjectId(rawUserId) })
      .sort({ createdAt: -1 })
      .exec();
  }

  /**
   * Lấy thông tin chi tiết của một đơn hàng
   */
  async getOrderById(id: string): Promise<Order> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('ID đơn hàng không đúng định dạng ObjectId');
    }

    const order = await this.orderModel.findById(id).exec();
    if (!order) {
      throw new NotFoundException(`Đơn hàng với ID '${id}' không tồn tại`);
    }

    return order;
  }

  /**
   * Xác nhận đơn hàng, tính điểm ưu tiên và gửi sự kiện chế biến
   * Formula: Score = (userRoleScore * 100) + (isTakeaway * 50) + (waitingMinutes * 1.5)
   */
  async confirmOrder(id: string): Promise<Order> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('ID đơn hàng không đúng định dạng ObjectId');
    }

    const order = await this.orderModel.findById(id).exec();
    if (!order) {
      throw new NotFoundException(`Đơn hàng với ID '${id}' không tồn tại`);
    }

    if (order.status !== 'CREATED') {
      throw new BadRequestException(`Đơn hàng ở trạng thái '${order.status}' không thể xác nhận (Chỉ đơn CREATED mới được xác nhận)`);
    }

    // Compute userRoleScore
    const roleLower = (order.userRole || '').toLowerCase();
    let userRoleScore = 0;
    if (roleLower === 'vip' || roleLower === 'bgd') {
      userRoleScore = 2;
    } else if (roleLower === 'manager' || roleLower === 'admin') {
      userRoleScore = 1;
    }

    // Compute isTakeaway (1 if tableId is null, 0 if seated)
    const isTakeaway = order.tableId ? 0 : 1;

    // Compute waitingMinutes
    const createdAtTime = (order as any).createdAt ? new Date((order as any).createdAt).getTime() : Date.now();
    const waitingMinutes = Math.max(0, Math.floor((Date.now() - createdAtTime) / 60000));

    // Calculate Priority Score
    const priorityScore = (userRoleScore * 100) + (isTakeaway * 50) + (waitingMinutes * 1.5);

    order.status = 'CONFIRMED';
    order.priorityScore = priorityScore;

    const updatedOrder = await order.save();

    // Send order.confirmed event to RabbitMQ
    await this.rabbitMQService.publish('order.confirmed', {
      orderId: updatedOrder._id.toString(),
      orderNumber: updatedOrder.orderNumber,
      priorityScore: updatedOrder.priorityScore,
      confirmedAt: (updatedOrder as any).updatedAt || new Date(),
      userRole: updatedOrder.userRole,
      isTakeaway: !updatedOrder.tableId,
    });

    return updatedOrder;
  }

  /**
   * Xác nhận khách đã nhận món ăn thành công, đóng Order
   */
  async completeOrder(id: string): Promise<Order> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('ID đơn hàng không đúng định dạng ObjectId');
    }

    const order = await this.orderModel.findById(id).exec();
    if (!order) {
      throw new NotFoundException(`Đơn hàng với ID '${id}' không tồn tại`);
    }

    if (order.status === 'COMPLETED') {
      throw new BadRequestException('Đơn hàng đã được hoàn thành trước đó');
    }

    if (order.status === 'CANCELLED') {
      throw new BadRequestException('Đơn hàng đã bị hủy, không thể hoàn thành');
    }

    order.status = 'COMPLETED';
    if (order.paymentStatus === 'PENDING' && order.paymentMethod === 'CASH') {
      order.paymentStatus = 'PAID';
    }

    return await order.save();
  }
}
