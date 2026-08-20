import {
  ConflictException,
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Order, OrderDocument } from '../../../schemas/orders.schema';
import { Table, TableDocument } from '../../../schemas/tables.schema';
import { RabbitMQService } from '../../rabbitmq/rabbitmq.service';

interface PaymentSucceededEvent {
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
    @InjectModel(Table.name)
    private readonly tableModel: Model<TableDocument>,
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
    const order = await this.orderModel.findById(event.data.orderId).exec();
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
    if (
      order.paymentStatus === 'PAID' &&
      order.paymentId &&
      order.paymentId !== event.data.paymentId
    ) {
      throw new ConflictException('Đơn hàng đã được trả bởi payment khác');
    }

    if (order.paymentStatus !== 'PAID') {
      order.paymentStatus = 'PAID';
      order.paymentId = event.data.paymentId;
      order.providerTransactionId = event.data.providerTransactionId;
      order.paidAt = new Date(event.data.paidAt);
      await order.save();
      this.logger.log(
        `Đã cập nhật payment '${event.data.paymentId}' cho order '${order._id.toString()}'`,
      );
    }

    // Thanh toán trước không đồng nghĩa bàn đã trống. Chỉ giải phóng bàn khi
    // vòng đời phục vụ món đã COMPLETED; nhánh này cũng chạy lại khi event lặp.
    if (order.status === 'COMPLETED' && order.tableId) {
      await this.tableModel
        .updateOne({ _id: order.tableId }, { $set: { status: 'empty' } })
        .exec();
    }
  }

  private validateEvent(event: PaymentSucceededEvent): void {
    if (
      !event ||
      event.eventType !== 'payment.succeeded.v1' ||
      event.version !== 1 ||
      !event.data ||
      !Types.ObjectId.isValid(event.data.orderId) ||
      !Types.ObjectId.isValid(event.data.userId) ||
      !Number.isSafeInteger(event.data.amount) ||
      event.data.amount <= 0 ||
      event.data.currency !== 'VND' ||
      event.data.paymentMethod !== 'VIETQR' ||
      Number.isNaN(new Date(event.data.paidAt).getTime())
    ) {
      throw new ConflictException('Payment event không hợp lệ');
    }
  }
}
