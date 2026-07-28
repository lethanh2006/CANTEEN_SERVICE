import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Order, OrderDocument } from '../../schemas/orders.schema';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';

@Injectable()
export class KitchenService {
  constructor(
    @InjectModel(Order.name) private readonly orderModel: Model<OrderDocument>,
    private readonly rabbitMQService: RabbitMQService,
  ) {}

  /**
   * GET /api/canteen/kitchen/queue
   * Xem danh sách các đơn hàng đang chờ trong hàng đợi ưu tiên (CONFIRMED)
   */
  async getQueue(): Promise<Order[]> {
    return await this.orderModel
      .find({ status: 'CONFIRMED' })
      .sort({ priorityScore: -1, createdAt: 1 })
      .exec();
  }

  /**
   * POST /api/canteen/kitchen/next
   * Lấy đơn hàng có độ ưu tiên cao nhất ra khỏi hàng đợi để chế biến
   * Tự động chuyển trạng thái đơn hàng sang COOKING
   */
  async getNextOrder(): Promise<Order> {
    const nextOrder = await this.orderModel
      .findOne({ status: 'CONFIRMED' })
      .sort({ priorityScore: -1, createdAt: 1 })
      .exec();

    if (!nextOrder) {
      throw new NotFoundException('Không có đơn hàng nào đang chờ trong hàng đợi nhà bếp');
    }

    nextOrder.status = 'COOKING';
    return await nextOrder.save();
  }

  /**
   * PATCH /api/canteen/kitchen/orders/:id/cooking
   * Chuyển trạng thái đơn hàng sang COOKING
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
   * Đánh dấu món ăn đã chuẩn bị xong, chuyển trạng thái READY
   * Phát sự kiện order.ready qua RabbitMQ
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

    // Publish event 'order.ready' to RabbitMQ
    await this.rabbitMQService.publish('order.ready', {
      orderId: updatedOrder._id.toString(),
      orderNumber: updatedOrder.orderNumber,
      status: updatedOrder.status,
      updatedAt: (updatedOrder as any).updatedAt || new Date(),
    });

    return updatedOrder;
  }
}
