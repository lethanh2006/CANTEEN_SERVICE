import {
  ConflictException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Order, OrderDocument } from '../../../schemas/orders.schema';
import { RabbitMQService } from '../../rabbitmq/rabbitmq.service';
import { OrderSettlementService } from '../order-settlement.service';

export interface PaymentSucceededEvent {
  eventId: string;
  eventType: 'payment.succeeded.v1';
  version: 1;
  occurredAt: string;
  data: {
    paymentId: string;
    orderId: string;
    userId: string;
    amount: number;
    currency: 'VND';
    paymentMethod: 'VIETQR';
    providerTransactionId: string;
    paidAt: string;
  };
}

@Injectable()
export class PaymentConsumer implements OnModuleInit {
  private readonly logger = new Logger(PaymentConsumer.name);

  constructor(
    @InjectModel(Order.name)
    private readonly orderModel: Model<OrderDocument>,
    private readonly orderSettlementService: OrderSettlementService,
    private readonly rabbitMQService: RabbitMQService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.rabbitMQService.subscribe<PaymentSucceededEvent>(
      'canteen.payment.succeeded.v1',
      (event) => this.handle(event),
    );
  }

  async handle(event: PaymentSucceededEvent): Promise<void> {
    this.validateEvent(event);
    const orderId = new Types.ObjectId(event.data.orderId);
    const userId = new Types.ObjectId(event.data.userId);
    const paidAt = new Date(event.data.paidAt);
    const updatedOrder = await this.orderModel
      .findOneAndUpdate(
        {
          _id: orderId,
          status: { $ne: 'CANCELLED' },
          userId,
          finalAmount: event.data.amount,
          paymentMethod: 'VIETQR',
          paymentStatus: 'PENDING',
        },
        {
          $set: {
            paymentStatus: 'PAID',
            paymentId: event.data.paymentId,
            paymentEventId: event.eventId,
            providerTransactionId: event.data.providerTransactionId,
            paidAt,
          },
        },
        { new: true, runValidators: true },
      )
      .exec();

    if (updatedOrder) {
      this.logger.log(
        `Đã cập nhật payment '${event.data.paymentId}' cho order '${updatedOrder._id.toString()}'`,
      );
      await this.orderSettlementService.reconcileTableForOrder(
        updatedOrder._id,
      );
      return;
    }

    const order = await this.orderModel.findById(orderId).exec();
    if (!order) {
      throw new ConflictException(
        `Không tìm thấy đơn hàng '${event.data.orderId}' của payment event`,
      );
    }
    if (order.status === 'CANCELLED') {
      throw new ConflictException('Đơn hàng đã hủy nhưng nhận được thanh toán');
    }
    if (order.userId.toString() !== event.data.userId) {
      throw new ConflictException('Người thanh toán không khớp chủ đơn hàng');
    }
    if (order.finalAmount !== event.data.amount) {
      throw new ConflictException('Số tiền thanh toán không khớp đơn hàng');
    }
    if (order.paymentMethod !== 'VIETQR') {
      throw new ConflictException('Phương thức thanh toán không khớp đơn hàng');
    }
    if (order.paymentStatus !== 'PAID') {
      throw new ConflictException(
        `Đơn hàng ở trạng thái thanh toán '${order.paymentStatus}' không thể nhận payment thành công`,
      );
    }
    if (
      order.paymentId !== event.data.paymentId ||
      (order.paymentEventId !== undefined &&
        order.paymentEventId !== event.eventId) ||
      order.providerTransactionId !== event.data.providerTransactionId ||
      order.paidAt?.getTime() !== paidAt.getTime()
    ) {
      throw new ConflictException('Đơn hàng đã được trả bởi payment khác');
    }

    // Delivery lặp hợp lệ vẫn đối soát lại bàn để tự sửa trạng thái bị kẹt.
    await this.orderSettlementService.reconcileTableForOrder(order._id);
  }

  private validateEvent(event: PaymentSucceededEvent): void {
    if (
      !event ||
      !isRecord(event) ||
      !isUuid(event.eventId) ||
      event.eventType !== 'payment.succeeded.v1' ||
      event.version !== 1 ||
      !isIsoDate(event.occurredAt) ||
      !isRecord(event.data) ||
      !isUuid(event.data.paymentId) ||
      !isObjectId(event.data.orderId) ||
      !isObjectId(event.data.userId) ||
      !Number.isSafeInteger(event.data.amount) ||
      event.data.amount <= 0 ||
      event.data.currency !== 'VND' ||
      event.data.paymentMethod !== 'VIETQR' ||
      !isText(event.data.providerTransactionId, 128) ||
      !isIsoDate(event.data.paidAt)
    ) {
      throw new ConflictException('Payment event không hợp lệ');
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function isObjectId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{24}$/i.test(value);
}

function isText(value: unknown, maxLength: number): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maxLength &&
    value.trim() === value
  );
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}
