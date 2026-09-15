import type { ConfigService } from '@nestjs/config';
import type { Model } from 'mongoose';
import { appLogger } from '../../common/observability/app-logger';
import type { OutboxEventDocument } from '../../schemas/outbox-events.schema';
import type { RabbitMQService } from '../rabbitmq/rabbitmq.service';
import { OutboxPublisher } from './outbox.publisher';

describe('Canteen OutboxPublisher', () => {
  afterEach(() => jest.restoreAllMocks());

  function setup(options?: { publishError?: Error; maxAttempts?: string }) {
    const event = {
      eventId: '5ad62f76-3ca1-46cb-ab36-9696b40e50d1',
      eventType: 'order.confirmed',
      queueName: 'order.confirmed',
      aggregateId: '6aa8be184946f45782298c5f',
      payload: { orderId: '6aa8be184946f45782298c5f' },
      requestId: 'req-outbox',
      traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
      tracestate: 'vendor=value',
      attemptCount: 1,
    } as OutboxEventDocument;
    const claimExec = jest
      .fn()
      .mockResolvedValueOnce(event)
      .mockResolvedValueOnce(null);
    const findOneAndUpdate = jest.fn(() => ({ exec: claimExec }));
    const updateExec = jest.fn().mockResolvedValue({ modifiedCount: 1 });
    const updateOne = jest.fn(() => ({ exec: updateExec }));
    const model = {
      init: jest.fn().mockResolvedValue(undefined),
      findOneAndUpdate,
      updateOne,
    } as unknown as Model<OutboxEventDocument>;
    const publish = options?.publishError
      ? jest.fn().mockRejectedValue(options.publishError)
      : jest.fn().mockResolvedValue(undefined);
    const rabbitMQ = {
      isReady: jest.fn().mockReturnValue(true),
      publish,
    } as unknown as RabbitMQService;
    const config = {
      get: jest.fn((name: string) => {
        if (name === 'CANTEEN_OUTBOX_BATCH_SIZE') return '2';
        if (name === 'CANTEEN_OUTBOX_MAX_ATTEMPTS') {
          return options?.maxAttempts;
        }
        return undefined;
      }),
    } as unknown as ConfigService;

    return {
      event,
      findOneAndUpdate,
      model,
      publish,
      publisher: new OutboxPublisher(model, rabbitMQ, config),
      updateOne,
    };
  }

  it('claim nguyên tử rồi chỉ đánh dấu published sau khi broker xác nhận', async () => {
    const { event, findOneAndUpdate, publish, publisher, updateOne } = setup();

    await publisher.flush();

    expect(findOneAndUpdate).toHaveBeenCalledWith(
      {
        publishedAt: null,
        failedAt: null,
        nextAttemptAt: { $lte: expect.any(Date) as Date },
      },
      {
        $inc: { attemptCount: 1 },
        $set: { nextAttemptAt: expect.any(Date) as Date },
      },
      { returnDocument: 'after', sort: { createdAt: 1 } },
    );
    expect(publish).toHaveBeenCalledWith(
      event.queueName,
      event.payload,
      expect.objectContaining({
        messageId: event.eventId,
        correlationId: event.aggregateId,
        requestId: event.requestId,
        traceparent: event.traceparent,
      }),
    );
    expect(updateOne).toHaveBeenCalledWith(
      {
        eventId: event.eventId,
        publishedAt: null,
        failedAt: null,
      },
      { $set: { publishedAt: expect.any(Date) as Date, lastError: null } },
    );
  });

  it('lưu lỗi và lên lịch retry vô hạn theo mặc định', async () => {
    const warnSpy = jest.spyOn(appLogger, 'warn').mockImplementation();
    const { event, publisher, updateOne } = setup({
      publishError: new Error('broker unavailable'),
    });

    await publisher.flush();

    expect(updateOne).toHaveBeenCalledTimes(1);
    const [filter, update] = updateOne.mock.calls[0] as unknown as [
      Record<string, unknown>,
      {
        $set: Record<string, unknown>;
      },
    ];
    expect(filter).toMatchObject({ eventId: event.eventId });
    expect(update.$set).toMatchObject({
      lastError: 'broker unavailable',
      nextAttemptAt: expect.any(Date) as Date,
    });
    expect(update.$set).not.toHaveProperty('failedAt');
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('đánh dấu failed khi vận hành cấu hình giới hạn số lần thử', async () => {
    jest.spyOn(appLogger, 'error').mockImplementation();
    const { publisher, updateOne } = setup({
      publishError: new Error('payload rejected'),
      maxAttempts: '1',
    });

    await publisher.flush();

    expect(updateOne).toHaveBeenCalledTimes(1);
    const update = updateOne.mock.calls[0]?.[1] as unknown as {
      $set: Record<string, unknown>;
    };
    expect(update.$set).toMatchObject({
      lastError: 'payload rejected',
      failedAt: expect.any(Date) as Date,
    });
  });
});
