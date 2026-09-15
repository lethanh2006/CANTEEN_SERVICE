import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import {
  logAndRecordException,
  runWithLogContext,
  sanitizeText,
} from '@nrapp/observability';
import type { Model } from 'mongoose';
import { appLogger } from '../../common/observability/app-logger';
import {
  OutboxEvent,
  OutboxEventDocument,
} from '../../schemas/outbox-events.schema';
import { RabbitMQService } from '../rabbitmq/rabbitmq.service';

@Injectable()
export class OutboxPublisher implements OnModuleInit, OnModuleDestroy {
  private readonly intervalMs: number;
  private readonly leaseMs: number;
  private readonly batchSize: number;
  private readonly maxAttempts: number;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @InjectModel(OutboxEvent.name)
    private readonly outboxModel: Model<OutboxEventDocument>,
    private readonly rabbitMQService: RabbitMQService,
    configService: ConfigService,
  ) {
    this.intervalMs = positiveInteger(
      configService.get<string>('CANTEEN_OUTBOX_INTERVAL_MS'),
      1_000,
      250,
    );
    this.leaseMs = positiveInteger(
      configService.get<string>('CANTEEN_OUTBOX_LEASE_MS'),
      30_000,
      5_000,
    );
    this.batchSize = positiveInteger(
      configService.get<string>('CANTEEN_OUTBOX_BATCH_SIZE'),
      20,
      1,
    );

    const configuredMaxAttempts = Number(
      configService.get<string>('CANTEEN_OUTBOX_MAX_ATTEMPTS') ?? 0,
    );
    this.maxAttempts =
      Number.isSafeInteger(configuredMaxAttempts) && configuredMaxAttempts >= 0
        ? configuredMaxAttempts
        : 0;
  }

  async onModuleInit(): Promise<void> {
    // Khởi tạo collection/index trước khi enqueue trong Mongo transaction.
    await this.outboxModel.init();
    this.timer = setInterval(() => void this.flush(), this.intervalMs);
    this.timer.unref();
    void this.flush();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async flush(): Promise<void> {
    if (this.running || !this.rabbitMQService.isReady()) {
      return;
    }

    this.running = true;
    try {
      for (let index = 0; index < this.batchSize; index += 1) {
        const event = await this.claimOne();
        if (!event) break;
        await this.publishOne(event);
      }
    } catch (error: unknown) {
      logAndRecordException(
        appLogger,
        'canteen.outbox.flush.failed',
        error,
        { 'messaging.system': 'rabbitmq' },
        {
          message: 'Không thể xử lý batch Canteen outbox',
          classification: {
            statusCode: 500,
            code: 'CANTEEN_OUTBOX_FLUSH_FAILED',
            expected: false,
            retryable: true,
          },
        },
      );
    } finally {
      this.running = false;
    }
  }

  private claimOne(): Promise<OutboxEventDocument | null> {
    const now = new Date();
    return this.outboxModel
      .findOneAndUpdate(
        {
          publishedAt: null,
          failedAt: null,
          nextAttemptAt: { $lte: now },
        },
        {
          $inc: { attemptCount: 1 },
          $set: { nextAttemptAt: new Date(now.getTime() + this.leaseMs) },
        },
        { returnDocument: 'after', sort: { createdAt: 1 } },
      )
      .exec();
  }

  private async publishOne(event: OutboxEventDocument): Promise<void> {
    await runWithLogContext(
      {
        request_id: event.requestId ?? undefined,
        'messaging.message.id': event.eventId,
      },
      async () => {
        try {
          await this.rabbitMQService.publish(event.queueName, event.payload, {
            messageId: event.eventId,
            correlationId: event.aggregateId,
            requestId: event.requestId,
            traceparent: event.traceparent,
            tracestate: event.tracestate,
          });
          await this.outboxModel
            .updateOne(
              {
                eventId: event.eventId,
                publishedAt: null,
                failedAt: null,
              },
              { $set: { publishedAt: new Date(), lastError: null } },
            )
            .exec();
        } catch (error: unknown) {
          await this.recordFailure(event, error);
        }
      },
    );
  }

  private async recordFailure(
    event: OutboxEventDocument,
    error: unknown,
  ): Promise<void> {
    const exhausted =
      this.maxAttempts > 0 && event.attemptCount >= this.maxAttempts;
    const delaySeconds = Math.min(300, 2 ** Math.min(event.attemptCount, 8));
    await this.outboxModel
      .updateOne(
        {
          eventId: event.eventId,
          publishedAt: null,
          failedAt: null,
        },
        {
          $set: {
            lastError: sanitizeText(toMessage(error)).slice(0, 500),
            nextAttemptAt: new Date(Date.now() + delaySeconds * 1_000),
            ...(exhausted ? { failedAt: new Date() } : {}),
          },
        },
      )
      .exec();

    const context = {
      'messaging.system': 'rabbitmq',
      'messaging.destination.name': event.queueName,
      'messaging.message.id': event.eventId,
      'messaging.retry.count': event.attemptCount,
      ...(this.maxAttempts > 0
        ? { 'messaging.retry.max': this.maxAttempts }
        : {}),
    };

    if (exhausted) {
      logAndRecordException(
        appLogger,
        'canteen.outbox.publish.exhausted',
        error,
        context,
        {
          message: 'Canteen outbox đã hết số lần phát lại',
          classification: {
            statusCode: 500,
            code: 'CANTEEN_OUTBOX_PUBLISH_EXHAUSTED',
            expected: false,
            retryable: false,
          },
        },
      );
      return;
    }

    appLogger.warn(
      {
        ...context,
        'event.name': 'canteen.outbox.publish.retry_scheduled',
        'error.code': 'CANTEEN_OUTBOX_PUBLISH_RETRY',
      },
      'Đã lên lịch phát lại Canteen outbox',
    );
  }
}

function positiveInteger(
  raw: string | undefined,
  fallback: number,
  minimum: number,
): number {
  const value = Number(raw ?? fallback);
  return Number.isSafeInteger(value) && value >= minimum ? value : fallback;
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
