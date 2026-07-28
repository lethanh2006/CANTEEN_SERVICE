import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { RabbitMQService } from '../../rabbitmq/rabbitmq.service';
import { KitchenService } from '../kitchen.service';

@Injectable()
export class KitchenConsumer implements OnModuleInit {
  private readonly logger = new Logger(KitchenConsumer.name);

  constructor(
    private readonly rabbitMQService: RabbitMQService,
    private readonly kitchenService: KitchenService,
  ) {}

  async onModuleInit() {
    // Subscribe to order.confirmed event from RabbitMQ
    await this.rabbitMQService.subscribe('order.confirmed', async (eventData) => {
      this.logger.log(`Received 'order.confirmed' event for order ${eventData.orderId} (${eventData.orderNumber})`);
      await this.kitchenService.handleOrderConfirmedEvent(eventData);
    });
  }
}