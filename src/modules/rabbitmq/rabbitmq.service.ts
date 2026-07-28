import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqplib';

@Injectable()
export class RabbitMQService implements OnModuleInit, OnModuleDestroy {
  private connection: amqp.ChannelModel | null = null;
  private channel: amqp.Channel | null = null;
  private readonly logger = new Logger(RabbitMQService.name);

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    try {
      const host = this.configService.get<string>('Rabbitmq_Host') || 'localhost';
      const username = this.configService.get<string>('Rabbitmq_Username') || 'guest';
      const password = this.configService.get<string>('Rabbitmq_Password') || 'guest';

      this.connection = await amqp.connect({
        protocol: 'amqp',
        hostname: host,
        port: 5672,
        username,
        password,
      });
      this.channel = await this.connection.createChannel();
      this.logger.log('Successfully connected to RabbitMQ in Canteen Service');
    } catch (error: any) {
      this.logger.warn(`Could not connect to RabbitMQ: ${error.message}`);
    }
  }

  async publish(queueName: string, message: any): Promise<void> {
    if (!this.channel) {
      this.logger.warn(`RabbitMQ Channel is not initialized. Skipping publishing to ${queueName}`);
      return;
    }
    try {
      await this.channel.assertQueue(queueName, { durable: true });
      this.channel.sendToQueue(
        queueName,
        Buffer.from(JSON.stringify(message)),
        { persistent: true },
      );
      this.logger.log(`Published message to queue '${queueName}'`);
    } catch (error: any) {
      this.logger.error(`Failed to publish message to queue '${queueName}': ${error.message}`);
    }
  }

  async onModuleDestroy() {
    try {
      await this.channel?.close();
      await this.connection?.close();
    } catch (error) {
      // Ignore errors on shutdown
    }
  }
}
