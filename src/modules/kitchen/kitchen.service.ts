import { Injectable, OnModuleInit, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Order, OrderDocument } from '../../schemas/orders.schema';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';
import { KitchenPriorityQueue, KitchenOrderNode } from './utils/priority_queue';

@Injectable()
export class KitchenService implements OnModuleInit {
  private readonly priorityQueue = new KitchenPriorityQueue();
  private readonly logger = new Logger(KitchenService.name);

  constructor(
    @InjectModel(Order.name) private readonly orderModel: Model<OrderDocument>,
    private readonly rabbitMQService: RabbitMQService,
  ) {}

  /**
   * On module init, hydrate RAM Priority Queue from active CONFIRMED orders in DB
   */
  async onModuleInit() {
    await this.hydrateQueueFromDB();
  }

  /**
   * Hydrate in-memory Priority Queue from DB
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
          confirmedAt: (order as any).updatedAt || (order as any).createdAt || new Date(),
          userRole: order.userRole,
          isTakeaway: !order.tableId,
        });
      }
      this.logger.log(`Hydrated Kitchen Priority Queue with ${this.priorityQueue.size()} orders from DB`);
    } catch (err: any) {
      this.logger.error(`Failed to hydrate Kitchen Priority Queue: ${err.message}`);
    }
  }

  /**
   * Handle order.confirmed event published by OrderService/RabbitMQ
   */
  async handleOrderConfirmedEvent(eventData: {
    orderId: string;
    orderNumber: string;
    priorityScore: number;
    confirmedAt: Date;
    userRole?: string;
    isTakeaway?: boolean;
  }): Promise<void> {
    this.priorityQueue.push({
      orderId: eventData.orderId,
      orderNumber: eventData.orderNumber,
      priorityScore: eventData.priorityScore,
      confirmedAt: new Date(eventData.confirmedAt),
      userRole: eventData.userRole,
      isTakeaway: eventData.isTakeaway,
    });
    this.logger.log(`Pushed Order ${eventData.orderNumber} to RAM Kitchen Priority Queue (Score: ${eventData.priorityScore})`);
  }

  /**
   * GET /api/canteen/kitchen/queue
   * View orders in Priority Queue sorted by Priority Score
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
    const orders = await this.orderModel.find({ _id: { $in: orderIds } }).exec();

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
   * Pop highest priority order from Max Heap RAM Priority Queue and mark as COOKING
   */
  async getNextOrder(): Promise<Order> {
    let nextNode = this.priorityQueue.pop();

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
      throw new NotFoundException('Không có đơn hàng nào đang chờ trong hàng đợi nhà bếp');
    }

    nextOrder.status = 'COOKING';
    return await nextOrder.save();
  }

  /**
   * PATCH /api/canteen/kitchen/orders/:id/cooking
   * Mark order status as COOKING
   */
  async setOrderCooking(id: string): Promise<Order> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('ID đơn hàng không đúng định dạng ObjectId');
    }

    const order = await this.orderModel.findById(id).exec();
    if (!order) {
      throw new NotFoundException(`Đơn hàng với ID '${id}' không tồn tại`);
    }

    if (order.status === 'COOKING') {
      return order;
    }

    if (order.status !== 'CONFIRMED') {
      throw new BadRequestException(`Đơn hàng ở trạng thái '${order.status}' không thể chuyển sang COOKING (Chỉ đơn CONFIRMED mới có thể nấu)`);
    }

    order.status = 'COOKING';
    return await order.save();
  }

  /**
   * PATCH /api/canteen/kitchen/orders/:id/ready
   * Mark dish preparation as READY and publish order.ready event
   */
  async setOrderReady(id: string): Promise<Order> {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException('ID đơn hàng không đúng định dạng ObjectId');
    }

    const order = await this.orderModel.findById(id).exec();
    if (!order) {
      throw new NotFoundException(`Đơn hàng với ID '${id}' không tồn tại`);
    }

    if (order.status === 'READY') {
      return order;
    }

    if (order.status !== 'COOKING' && order.status !== 'CONFIRMED') {
      throw new BadRequestException(`Đơn hàng ở trạng thái '${order.status}' không thể chuyển sang READY (Cần ở trạng thái CONFIRMED hoặc COOKING)`);
    }

    order.status = 'READY';
    const updatedOrder = await order.save();

    await this.rabbitMQService.publish('order.ready', {
      orderId: updatedOrder._id.toString(),
      orderNumber: updatedOrder.orderNumber,
      status: updatedOrder.status,
      updatedAt: (updatedOrder as any).updatedAt || new Date(),
    });

    return updatedOrder;
  }
}
