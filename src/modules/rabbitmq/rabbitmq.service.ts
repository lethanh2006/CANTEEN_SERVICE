import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  getLogContext,
  injectTraceHeaders,
  logAndRecordException,
  recordExceptionOnActiveSpan,
  runWithLogContext,
  sanitizeText,
  withMessageSpan,
} from '@nrapp/observability';
import * as amqp from 'amqplib';
import { appLogger } from '../../common/observability/app-logger';
import { toError } from '../../common/utils/error.util';

type MessageHandler = (content: unknown) => Promise<void> | void;

export interface RabbitMQPublishOptions {
  messageId?: string;
  correlationId?: string;
  requestId?: string | null;
  traceparent?: string | null;
  tracestate?: string | null;
}

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

  async publish(
    queueName: string,
    message: unknown,
    options: RabbitMQPublishOptions = {},
  ): Promise<void> {
    const parentHeaders = {
      ...(options.traceparent ? { traceparent: options.traceparent } : {}),
      ...(options.tracestate ? { tracestate: options.tracestate } : {}),
    };
    await withMessageSpan(
      `${queueName} publish`,
      parentHeaders,
      async () => {
        try {
          const channel = this.channel;
          if (!channel) {
            throw new Error('Kênh RabbitMQ chưa sẵn sàng');
          }
          const requestId = options.requestId ?? getLogContext().request_id;
          const headers = injectTraceHeaders(
            typeof requestId === 'string'
              ? { 'x-request-id': requestId }
              : undefined,
          );
          await channel.assertQueue(queueName, { durable: true });
          channel.sendToQueue(queueName, Buffer.from(JSON.stringify(message)), {
            persistent: true,
            contentType: 'application/json',
            ...(options.messageId ? { messageId: options.messageId } : {}),
            ...(options.correlationId
              ? { correlationId: options.correlationId }
              : {}),
            headers,
          });
          await channel.waitForConfirms();
        } catch (error: unknown) {
          logAndRecordException(
            appLogger,
            'messaging.publish.failed',
            error,
            {
              'messaging.system': 'rabbitmq',
              'messaging.destination.name': queueName,
            },
            {
              message: 'Không thể phát RabbitMQ message',
              classification: {
                statusCode: 500,
                code: 'RABBITMQ_PUBLISH_FAILED',
                expected: false,
                retryable: true,
              },
            },
          );
          throw error;
        }
      },
      {
        kind: 3,
        attributes: {
          'messaging.system': 'rabbitmq',
          'messaging.destination.name': queueName,
          'messaging.operation.type': 'publish',
        },
      },
    );
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
    const channel = this.channel;
    const connection = this.connection;
    this.channel = null;
    this.connection = null;
    try {
      await channel?.close();
      await connection?.close();
    } catch (error: unknown) {
      this.logger.warn(
        `Không thể đóng kết nối RabbitMQ: ${toError(error).message}`,
      );
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
      this.handleTransportUnavailable(
        connection,
        channel,
        `Kết nối RabbitMQ lỗi: ${toError(error).message}`,
        true,
      );
    });
    connection.on('close', () => {
      this.handleTransportUnavailable(
        connection,
        channel,
        'Kết nối RabbitMQ đã đóng, sẽ kết nối lại',
        false,
      );
    });
    channel.on('error', (error) => {
      this.handleTransportUnavailable(
        connection,
        channel,
        `Kênh RabbitMQ lỗi: ${toError(error).message}`,
        true,
      );
    });
    channel.on('close', () => {
      this.handleTransportUnavailable(
        connection,
        channel,
        'Kênh RabbitMQ đã đóng, sẽ kết nối lại',
        true,
      );
    });
    this.connection = connection;
    this.channel = channel;
    this.logger.log('Dịch vụ căn tin đã kết nối RabbitMQ thành công');

    for (const [queueName, callback] of this.subscriptions) {
      await this.registerSubscription(queueName, callback);
    }
  }

  private handleTransportUnavailable(
    connection: amqp.ChannelModel,
    channel: amqp.ConfirmChannel,
    message: string,
    closeConnection: boolean,
  ): void {
    const ownsConnection = this.connection === connection;
    const ownsChannel = this.channel === channel;
    if (!ownsConnection && !ownsChannel) {
      return;
    }
    if (ownsConnection) {
      this.connection = null;
    }
    if (ownsChannel) {
      this.channel = null;
    }
    if (this.shuttingDown) {
      return;
    }

    this.logger.warn(message);
    if (closeConnection) {
      void connection.close().catch((error: unknown) => {
        this.logger.warn(
          `Không thể đóng kết nối RabbitMQ lỗi: ${toError(error).message}`,
        );
      });
    }
    this.scheduleReconnect();
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

    const rawProperties: unknown = message.properties;
    const properties = isRecord(rawProperties) ? rawProperties : {};
    const rawHeaders = properties.headers;
    const headers = isRecord(rawHeaders) ? rawHeaders : {};
    const requestId = optionalText(headers['x-request-id']);
    const messageId = optionalText(properties.messageId);

    await runWithLogContext(
      {
        request_id: requestId,
        'messaging.message.id': messageId,
      },
      () =>
        withMessageSpan(
          `${queueName} process`,
          headers,
          () =>
            this.processMessageAttempt(
              channel,
              queueName,
              message,
              callback,
              properties,
              headers,
            ),
          {
            attributes: {
              'messaging.system': 'rabbitmq',
              'messaging.destination.name': queueName,
              'messaging.operation.type': 'process',
              ...(messageId ? { 'messaging.message.id': messageId } : {}),
            },
          },
        ),
    );
  }

  private async processMessageAttempt(
    channel: amqp.ConfirmChannel,
    queueName: string,
    message: amqp.ConsumeMessage,
    callback: MessageHandler,
    properties: Record<string, unknown>,
    headers: Record<string, unknown>,
  ): Promise<void> {
    try {
      const content = JSON.parse(message.content.toString()) as unknown;
      await callback(content);
      channel.ack(message);
    } catch (error: unknown) {
      const typedError = toError(error);
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
        recordExceptionOnActiveSpan(typedError, {
          code: 'MESSAGE_PROCESSING_RETRY',
        });
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
          appLogger.warn(
            {
              'event.name': 'messaging.consume.retry_scheduled',
              'messaging.system': 'rabbitmq',
              'messaging.destination.name': queueName,
              'messaging.retry.count': nextRetry,
              'messaging.retry.max': 5,
              'error.code': 'MESSAGE_PROCESSING_RETRY',
            },
            'Đã đưa RabbitMQ message vào hàng đợi để xử lý lại',
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
            'x-last-error': sanitizeText(typedError.message).slice(0, 200),
          },
        });
        await channel.waitForConfirms();
        channel.ack(message);
        logAndRecordException(
          appLogger,
          'messaging.consume.exhausted',
          typedError,
          {
            'messaging.system': 'rabbitmq',
            'messaging.destination.name': queueName,
            'messaging.dead_letter.destination.name': `${queueName}.dlq`,
            'messaging.retry.count': nextRetry,
            'messaging.retry.max': 5,
            ...(messageId ? { 'messaging.message.id': messageId } : {}),
          },
          {
            message: 'RabbitMQ message đã hết số lần xử lý lại và vào DLQ',
            classification: {
              statusCode: 500,
              code: 'MESSAGE_PROCESSING_EXHAUSTED',
              expected: false,
              retryable: false,
            },
          },
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
    recordExceptionOnActiveSpan(publishError, {
      code: 'RABBITMQ_REPUBLISH_UNCONFIRMED',
    });
    appLogger.warn(
      {
        'event.name': 'messaging.republish.unconfirmed',
        'messaging.system': 'rabbitmq',
        'messaging.destination.name': destination,
        'error.code': 'RABBITMQ_REPUBLISH_UNCONFIRMED',
      },
      'RabbitMQ chưa xác nhận bản sao; giữ message gốc để xử lý lại',
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
