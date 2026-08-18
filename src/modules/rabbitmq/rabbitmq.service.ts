import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqplib';
import { toError } from '../../common/utils/error.util';

@Injectable()
export class RabbitMQService implements OnModuleInit, OnModuleDestroy {
  private connection: amqp.ChannelModel | null = null;
  private channel: amqp.Channel | null = null;
  private readonly logger = new Logger(RabbitMQService.name);

  constructor(private readonly configService: ConfigService) {}

  isReady(): boolean {
    return this.connection !== null && this.channel !== null;
  }

  async onModuleInit() {
    try {
      const host =
        this.configService.get<string>('Rabbitmq_Host') || 'localhost';
      const username =
        this.configService.get<string>('RABBITMQ_USER') ||
        this.configService.get<string>('Rabbitmq_Username') ||
        'guest';
      const password =
        this.configService.get<string>('RABBITMQ_PASSWORD') ||
        this.configService.get<string>('Rabbitmq_Password') ||
        'guest';
      const port = Number(
        this.configService.get<string>('RABBITMQ_AMQP_HOST_PORT') ||
          this.configService.get<string>('Rabbitmq_Port') ||
          5672,
      );

      this.connection = await amqp.connect({
        protocol: 'amqp',
        hostname: host,
        port,
        username,
        password,
      });
      this.channel = await this.connection.createChannel();
      this.logger.log('Dịch vụ căn tin đã kết nối RabbitMQ thành công');
    } catch (err: unknown) {
      const error = toError(err);
      this.logger.warn(`Không thể kết nối RabbitMQ: ${error.message}`);
    }
  }

  async publish(queueName: string, message: unknown): Promise<void> {
    if (!this.channel) {
      this.logger.warn(
        `Kênh RabbitMQ chưa sẵn sàng, bỏ qua việc phát tới '${queueName}'`,
      );
      return;
    }
    try {
      await this.channel.assertQueue(queueName, { durable: true });
      this.channel.sendToQueue(
        queueName,
        Buffer.from(JSON.stringify(message)),
        { persistent: true },
      );
      this.logger.log(`Đã phát thông điệp tới hàng đợi '${queueName}'`);
    } catch (err: unknown) {
      const error = toError(err);
      this.logger.error(
        `Không thể phát thông điệp tới hàng đợi '${queueName}': ${error.message}`,
        error.stack,
      );
    }
  }

  async subscribe<T>(
    queueName: string,
    callback: (msg: T) => Promise<void> | void,
  ): Promise<void> {
    if (!this.channel) {
      this.logger.warn(
        `Kênh RabbitMQ chưa sẵn sàng, không thể đăng ký hàng đợi '${queueName}'`,
      );
      return;
    }
    try {
      await this.channel.assertQueue(queueName, { durable: true });
      await this.channel.consume(queueName, (msg) => {
        if (msg) {
          void this.processMessage(queueName, msg, callback);
        }
      });
      this.logger.log(`Đã đăng ký hàng đợi RabbitMQ '${queueName}'`);
    } catch (err: unknown) {
      const error = toError(err);
      this.logger.error(
        `Không thể đăng ký hàng đợi '${queueName}': ${error.message}`,
        error.stack,
      );
    }
  }

  private async processMessage<T>(
    queueName: string,
    message: amqp.ConsumeMessage,
    callback: (content: T) => Promise<void> | void,
  ): Promise<void> {
    try {
      const content = JSON.parse(message.content.toString()) as T;
      await callback(content);
      this.channel?.ack(message);
    } catch (err: unknown) {
      const error = toError(err);
      this.logger.error(
        `Không thể xử lý thông điệp từ '${queueName}': ${error.message}`,
        error.stack,
      );
      this.channel?.nack(message, false, false);
    }
  }

  async onModuleDestroy() {
    try {
      await this.channel?.close();
      await this.connection?.close();
    } catch (err: unknown) {
      const error = toError(err);
      // Chỉ ghi log vì ứng dụng đang trong quá trình dừng.
      this.logger.warn(`Không thể đóng kết nối RabbitMQ: ${error.message}`);
    }
  }
}
