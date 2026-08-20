import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqplib';
import { toError } from '../../common/utils/error.util';

type MessageHandler = (content: unknown) => Promise<void> | void;

@Injectable()
export class RabbitMQService implements OnModuleInit, OnModuleDestroy {
  private connection: amqp.ChannelModel | null = null;
  private channel: amqp.ConfirmChannel | null = null;
  private readonly logger = new Logger(RabbitMQService.name);
  private readonly subscriptions = new Map<string, MessageHandler>();
  private reconnectTimer: NodeJS.Timeout | null = null;
  private shuttingDown = false;

  constructor(private readonly configService: ConfigService) {}

  isReady(): boolean {
    return this.connection !== null && this.channel !== null;
  }

  async onModuleInit(): Promise<void> {
    await this.connect().catch((error: unknown) => {
      this.logger.warn(`Không thể kết nối RabbitMQ: ${toError(error).message}`);
      this.scheduleReconnect();
    });
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
        { persistent: true, contentType: 'application/json' },
      );
      await this.channel.waitForConfirms();
      this.logger.log(`Đã phát thông điệp tới hàng đợi '${queueName}'`);
    } catch (error: unknown) {
      const typedError = toError(error);
      this.logger.error(
        `Không thể phát thông điệp tới '${queueName}': ${typedError.message}`,
        typedError.stack,
      );
    }
  }

  async subscribe<T>(
    queueName: string,
    callback: (message: T) => Promise<void> | void,
  ): Promise<void> {
    this.subscriptions.set(queueName, callback);
    if (this.channel) {
      await this.registerSubscription(queueName, callback);
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.shuttingDown = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    try {
      await this.channel?.close();
      await this.connection?.close();
    } catch (error: unknown) {
      this.logger.warn(
        `Không thể đóng kết nối RabbitMQ: ${toError(error).message}`,
      );
    } finally {
      this.channel = null;
      this.connection = null;
    }
  }

  private async connect(): Promise<void> {
    if (this.isReady() || this.shuttingDown) {
      return;
    }
    const host = this.configService.get<string>('Rabbitmq_Host') || 'localhost';
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

    const connection = await amqp.connect({
      protocol: 'amqp',
      hostname: host,
      port,
      username,
      password,
    });
    const channel = await connection.createConfirmChannel();
    await channel.prefetch(10);
    connection.on('error', (error) => {
      this.logger.warn(`RabbitMQ lỗi: ${toError(error).message}`);
    });
    connection.on('close', () => {
      this.connection = null;
      this.channel = null;
      if (!this.shuttingDown) {
        this.scheduleReconnect();
      }
    });
    this.connection = connection;
    this.channel = channel;
    this.logger.log('Dịch vụ căn tin đã kết nối RabbitMQ thành công');

    for (const [queueName, callback] of this.subscriptions) {
      await this.registerSubscription(queueName, callback);
    }
  }

  private async registerSubscription(
    queueName: string,
    callback: MessageHandler,
  ): Promise<void> {
    const channel = this.channel;
    if (!channel) {
      return;
    }
    await channel.assertQueue(`${queueName}.dlq`, { durable: true });
    await channel.assertQueue(queueName, { durable: true });
    await channel.consume(queueName, (message) => {
      if (message) {
        void this.processMessage(queueName, message, callback);
      }
    });
    this.logger.log(`Đã đăng ký hàng đợi RabbitMQ '${queueName}'`);
  }

  private async processMessage(
    queueName: string,
    message: amqp.ConsumeMessage,
    callback: MessageHandler,
  ): Promise<void> {
    const channel = this.channel;
    if (!channel) {
      return;
    }
    try {
      const content = JSON.parse(message.content.toString()) as unknown;
      await callback(content);
      channel.ack(message);
    } catch (error: unknown) {
      const typedError = toError(error);
      const rawProperties: unknown = message.properties;
      const properties = isRecord(rawProperties) ? rawProperties : {};
      const rawHeaders = properties.headers;
      const headers = isRecord(rawHeaders) ? rawHeaders : {};
      const retryHeader = headers['x-retry-count'];
      const retryCount =
        typeof retryHeader === 'number' && Number.isSafeInteger(retryHeader)
          ? retryHeader
          : 0;
      const nextRetry = retryCount + 1;
      const contentType =
        typeof properties.contentType === 'string'
          ? properties.contentType
          : 'application/json';
      const messageId = optionalText(properties.messageId);
      const correlationId = optionalText(properties.correlationId);

      if (nextRetry <= 5) {
        try {
          channel.sendToQueue(queueName, message.content, {
            persistent: true,
            contentType,
            messageId,
            correlationId,
            headers: {
              ...headers,
              'x-retry-count': nextRetry,
            },
          });
          await channel.waitForConfirms();
          channel.ack(message);
          this.logger.warn(
            `Xử lý '${queueName}' lỗi, đưa lại hàng đợi lần ${nextRetry}: ${typedError.message}`,
          );
        } catch (republishError: unknown) {
          this.requeueOriginal(
            channel,
            message,
            queueName,
            toError(republishError),
          );
        }
        return;
      }

      try {
        channel.sendToQueue(`${queueName}.dlq`, message.content, {
          persistent: true,
          contentType,
          messageId,
          correlationId,
          headers: {
            ...headers,
            'x-retry-count': nextRetry,
            'x-last-error': typedError.message.slice(0, 200),
          },
        });
        await channel.waitForConfirms();
        channel.ack(message);
        this.logger.error(
          `Đã chuyển thông điệp '${queueName}' vào DLQ: ${typedError.message}`,
          typedError.stack,
        );
      } catch (republishError: unknown) {
        this.requeueOriginal(
          channel,
          message,
          `${queueName}.dlq`,
          toError(republishError),
        );
      }
    }
  }

  private requeueOriginal(
    channel: amqp.ConfirmChannel,
    message: amqp.ConsumeMessage,
    destination: string,
    publishError: Error,
  ): void {
    this.logger.error(
      `RabbitMQ chưa xác nhận thông điệp tới '${destination}', giữ bản gốc để xử lý lại: ${publishError.message}`,
      publishError.stack,
    );
    try {
      channel.nack(message, false, true);
    } catch (nackError: unknown) {
      // Nếu channel đã đóng, message chưa được ack sẽ tự quay lại queue khi
      // connection đóng; vẫn ghi log để vận hành nhận biết lần retry này.
      this.logger.warn(
        `Không thể nack thông điệp gốc: ${toError(nackError).message}`,
      );
    }
  }

  private scheduleReconnect(): void {
    if (this.shuttingDown || this.reconnectTimer) {
      return;
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect().catch((error: unknown) => {
        this.logger.warn(
          `Kết nối lại RabbitMQ thất bại: ${toError(error).message}`,
        );
        this.scheduleReconnect();
      });
    }, 5_000);
    this.reconnectTimer.unref();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
