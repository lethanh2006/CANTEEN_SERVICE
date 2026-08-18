import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
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
   * Xem các đơn trong hàng đợi theo điểm ưu tiên giảm dần.
   */
  async getQueue(): Promise<Order[]> {
    return await this.orderModel
      .find({ status: 'CONFIRMED' })
      .sort({ priorityScore: -1, createdAt: 1 })
      .exec();
  }

  /**
   * POST /api/canteen/kitchen/next
   * Lấy và nhận xử lý nguyên tử đơn có độ ưu tiên cao nhất.
   */
  async getNextOrder(): Promise<Order> {
    const nextOrder = await this.orderModel
      .findOneAndUpdate(
        { status: 'CONFIRMED' },
        { $set: { status: 'COOKING' } },
        {
          new: true,
          sort: { priorityScore: -1, createdAt: 1 },
        },
      )
      .exec();

    if (!nextOrder) {
      throw new NotFoundException(
        'Không có đơn hàng nào đang chờ trong hàng đợi nhà bếp',
      );
    }

    return nextOrder;
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
