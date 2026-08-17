import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { RabbitMQService } from '../../rabbitmq/rabbitmq.service';
import { KitchenService, OrderConfirmedEvent } from '../kitchen.service';

@Injectable()
export class KitchenConsumer implements OnModuleInit {
  private readonly logger = new Logger(KitchenConsumer.name);

  constructor(
    private readonly rabbitMQService: RabbitMQService,
    private readonly kitchenService: KitchenService,
  ) {}

  async onModuleInit() {
    // Đăng ký nhận sự kiện xác nhận đơn hàng từ RabbitMQ.
    await this.rabbitMQService.subscribe<OrderConfirmedEvent>(
      'order.confirmed',
      (eventData) => {
        this.logger.log(
          `Đã nhận sự kiện xác nhận cho đơn ${eventData.orderId} (${eventData.orderNumber})`,
        );
        this.kitchenService.handleOrderConfirmedEvent(eventData);
      },
    );
  }
}
