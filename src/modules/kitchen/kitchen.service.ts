import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Order, OrderDocument } from '../../schemas/orders.schema';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';
import { KitchenPriorityQueue } from './utils/priority_queue';
import { toError } from '../../common/utils/error.util';

@Injectable()
export class KitchenService implements OnModuleInit {
  private readonly priorityQueue = new KitchenPriorityQueue();
  private readonly logger = new Logger(KitchenService.name);

  constructor(
    @InjectModel(Order.name) private readonly orderModel: Model<OrderDocument>,
    private readonly rabbitMQService: RabbitMQService,
  ) {}

  /**
   * Nạp các đơn CONFIRMED vào hàng đợi ưu tiên khi mô-đun khởi động.
   */
  async onModuleInit() {
    await this.hydrateQueueFromDB();
  }

  /**
   * Nạp hàng đợi ưu tiên trong bộ nhớ từ cơ sở dữ liệu.
   */
  private async hydrateQueueFromDB(): Promise<void> {
    try {
      const confirmedOrders = await this.orderModel
        .find({ status: 'CONFIRMED' })
        .sort({ priorityScore: -1 })
        .exec();

      this.priorityQueue.clear();
      for (const order of confirmedOrders) {
        this.priorityQueue.push({
          orderId: order._id.toString(),
          orderNumber: order.orderNumber,
          priorityScore: order.priorityScore || 0,
          confirmedAt: order.updatedAt ?? order.createdAt,
          userRole: order.userRole,
          isTakeaway: !order.tableId,
        });
      }
      this.logger.log(
        `Đã nạp ${this.priorityQueue.size()} đơn hàng vào hàng đợi ưu tiên của bếp`,
      );
    } catch (err: unknown) {
      const error = toError(err);
      this.logger.error(
        `Không thể nạp hàng đợi ưu tiên của bếp: ${error.message}`,
        error.stack,
      );
    }
  }

  /**
   * Xử lý sự kiện xác nhận đơn hàng nhận từ RabbitMQ.
   */
  handleOrderConfirmedEvent(eventData: OrderConfirmedEvent): void {
    this.priorityQueue.push({
      orderId: eventData.orderId,
      orderNumber: eventData.orderNumber,
      priorityScore: eventData.priorityScore,
      confirmedAt: new Date(eventData.confirmedAt),
      userRole: eventData.userRole,
      isTakeaway: eventData.isTakeaway,
    });
    this.logger.log(
      `Đã thêm đơn ${eventData.orderNumber} vào hàng đợi của bếp (điểm: ${eventData.priorityScore})`,
    );
  }

  /**
   * GET /api/canteen/kitchen/queue
   * Xem các đơn trong hàng đợi theo điểm ưu tiên giảm dần.
   */
  async getQueue(): Promise<Order[]> {
    if (this.priorityQueue.isEmpty()) {
      return await this.orderModel
        .find({ status: 'CONFIRMED' })
        .sort({ priorityScore: -1, createdAt: 1 })
        .exec();
    }

    const orderNodes = this.priorityQueue.toArray();
    orderNodes.sort((a, b) => b.priorityScore - a.priorityScore);

    const orderIds = orderNodes.map((node) => new Types.ObjectId(node.orderId));
    const orders = await this.orderModel
      .find({ _id: { $in: orderIds } })
      .exec();

    const orderMap = new Map(orders.map((o) => [o._id.toString(), o]));
    const result: Order[] = [];
    for (const node of orderNodes) {
      const found = orderMap.get(node.orderId);
      if (found) {
        result.push(found);
      }
    }

    return result;
  }

  /**
   * POST /api/canteen/kitchen/next
   * Lấy đơn ưu tiên cao nhất khỏi Max Heap và chuyển sang COOKING.
   */
  async getNextOrder(): Promise<Order> {
    const nextNode = this.priorityQueue.pop();

    let nextOrder: OrderDocument | null = null;

    if (nextNode) {
      nextOrder = await this.orderModel.findById(nextNode.orderId).exec();
    }

    if (!nextOrder || nextOrder.status !== 'CONFIRMED') {
      nextOrder = await this.orderModel
        .findOne({ status: 'CONFIRMED' })
        .sort({ priorityScore: -1, createdAt: 1 })
        .exec();
    }

    if (!nextOrder) {
      throw new NotFoundException(
        'Không có đơn hàng nào đang chờ trong hàng đợi nhà bếp',
      );
    }

    nextOrder.status = 'COOKING';
    return await nextOrder.save();
  }

  /**
   * PATCH /api/canteen/kitchen/orders/:id/cooking
   * Chuyển trạng thái đơn hàng sang COOKING.
   */
  async setOrderCooking(id: string): Promise<Order> {
    const order = await this.orderModel.findById(id).exec();
    if (!order) {
      throw new NotFoundException(`Đơn hàng với ID '${id}' không tồn tại`);
    }

    if (order.status === 'COOKING') {
      return order;
    }

    if (order.status !== 'CONFIRMED') {
      throw new ConflictException(
        `Đơn hàng ở trạng thái '${order.status}' không thể chuyển sang COOKING (chỉ đơn CONFIRMED mới có thể nấu)`,
      );
    }

    order.status = 'COOKING';
    return await order.save();
  }

  /**
   * PATCH /api/canteen/kitchen/orders/:id/ready
   * Chuyển đơn sang READY và phát sự kiện món đã sẵn sàng.
   */
  async setOrderReady(id: string): Promise<Order> {
    const order = await this.orderModel.findById(id).exec();
    if (!order) {
      throw new NotFoundException(`Đơn hàng với ID '${id}' không tồn tại`);
    }

    if (order.status === 'READY') {
      return order;
    }

    if (order.status !== 'COOKING' && order.status !== 'CONFIRMED') {
      throw new ConflictException(
        `Đơn hàng ở trạng thái '${order.status}' không thể chuyển sang READY (cần ở trạng thái CONFIRMED hoặc COOKING)`,
      );
    }

    order.status = 'READY';
    const updatedOrder = await order.save();

    await this.rabbitMQService.publish('order.ready', {
      orderId: updatedOrder._id.toString(),
      orderNumber: updatedOrder.orderNumber,
      status: updatedOrder.status,
      updatedAt: updatedOrder.updatedAt,
    });

    return updatedOrder;
  }
}

export interface OrderConfirmedEvent {
  orderId: string;
  orderNumber: string;
  priorityScore: number;
  confirmedAt: Date;
  userRole?: string;
  isTakeaway?: boolean;
}
