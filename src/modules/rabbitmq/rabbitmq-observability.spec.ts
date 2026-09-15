import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  injectTraceHeaders,
  runWithLogContext,
  withMessageSpan,
} from '@nrapp/observability';
import * as amqp from 'amqplib';
import { EventEmitter } from 'node:events';
import { appLogger } from '../../common/observability/app-logger';
import { RabbitMQService } from './rabbitmq.service';

jest.mock('amqplib', () => ({ connect: jest.fn() }));
jest.mock('@nrapp/observability', () => ({
  ...jest.requireActual<typeof import('@nrapp/observability')>(
    '@nrapp/observability',
  ),
  withMessageSpan: jest.fn(
    async (
      _name: string,
      _headers: Record<string, unknown>,
      callback: () => Promise<unknown>,
    ) => callback(),
  ),
  injectTraceHeaders: jest.fn((headers: Record<string, unknown> = {}) => ({
    ...headers,
    traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
    tracestate: 'vendor=value',
  })),
}));

describe('RabbitMQ canteen observability', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('extract trace context và giữ nguyên headers khi retry', async () => {
    const { service, channel } = await setup();
    const warnSpy = jest.spyOn(appLogger, 'warn').mockImplementation();
    const headers = traceHeaders(0);
    const message = consumeMessage(headers);

    await processMessage(service, message, () =>
      Promise.reject(new ConflictException('Order chưa sẵn sàng')),
    );

    expect(withMessageSpan).toHaveBeenCalledWith(
      'canteen.payment.succeeded.v1 process',
      headers,
      expect.any(Function),
      expect.any(Object),
    );
    expect(channel.sendToQueue).toHaveBeenCalledWith(
      'canteen.payment.succeeded.v1',
      message.content,
      expect.any(Object),
    );
    const retryOptions = channel.sendToQueue.mock.calls[0][2];
    expect(retryOptions.headers).toMatchObject({
      traceparent: headers.traceparent,
      tracestate: headers.tracestate,
      'x-request-id': 'req-rabbit',
      'x-retry-count': 1,
    });
    expect(channel.ack).toHaveBeenCalledWith(message);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    await service.onModuleDestroy();
  });

  it('inject W3C context và request id khi publish', async () => {
    const { service, channel } = await setup();

    await runWithLogContext({ request_id: 'req-publish' }, () =>
      service.publish('order.confirmed', { orderId: 'order-1' }),
    );

    expect(injectTraceHeaders).toHaveBeenCalledWith({
      'x-request-id': 'req-publish',
    });
    expect(channel.sendToQueue).toHaveBeenCalledWith(
      'order.confirmed',
      expect.any(Buffer),
      expect.any(Object),
    );
    const publishOptions = channel.sendToQueue.mock.calls[0][2];
    expect(publishOptions.headers).toEqual({
      'x-request-id': 'req-publish',
      traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
      tracestate: 'vendor=value',
    });
    await service.onModuleDestroy();
  });

  it('trả lỗi publish lên caller để outbox có thể retry', async () => {
    const { service, channel } = await setup();
    jest.spyOn(appLogger, 'error').mockImplementation();
    channel.waitForConfirms.mockRejectedValueOnce(
      new Error('publisher confirm failed'),
    );

    await expect(
      service.publish('order.ready', { orderId: 'order-1' }),
    ).rejects.toThrow('publisher confirm failed');

    await service.onModuleDestroy();
  });

  it('giữ trace headers và chỉ ghi detailed error khi hết retry vào DLQ', async () => {
    const { service, channel } = await setup();
    const errorSpy = jest.spyOn(appLogger, 'error').mockImplementation();
    const headers = traceHeaders(5);
    const message = consumeMessage(headers);

    await processMessage(service, message, () =>
      Promise.reject(new Error('Mongo settlement failed')),
    );

    expect(channel.sendToQueue).toHaveBeenCalledWith(
      'canteen.payment.succeeded.v1.dlq',
      message.content,
      expect.any(Object),
    );
    const deadLetterOptions = channel.sendToQueue.mock.calls[0][2];
    expect(deadLetterOptions.headers).toMatchObject({
      traceparent: headers.traceparent,
      tracestate: headers.tracestate,
      'x-request-id': 'req-rabbit',
      'x-retry-count': 6,
      'x-last-error': 'Mongo settlement failed',
    });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy.mock.calls[0][0]).toMatchObject({
      'event.name': 'messaging.consume.exhausted',
      'error.code': 'MESSAGE_PROCESSING_EXHAUSTED',
      'messaging.retry.count': 6,
    });
    await service.onModuleDestroy();
  });
});

async function setup() {
  const sendToQueue = jest.fn(
    (
      _queueName: string,
      _content: Buffer,
      _options: amqp.Options.Publish,
    ): boolean => {
      void _queueName;
      void _content;
      void _options;
      return true;
    },
  );
  const channel = Object.assign(new EventEmitter(), {
    prefetch: jest.fn().mockResolvedValue(undefined),
    assertQueue: jest.fn().mockResolvedValue(undefined),
    sendToQueue,
    waitForConfirms: jest.fn().mockResolvedValue(undefined),
    ack: jest.fn(),
    nack: jest.fn(),
    close: jest.fn().mockResolvedValue(undefined),
  });
  const connection = Object.assign(new EventEmitter(), {
    createConfirmChannel: jest.fn().mockResolvedValue(channel),
    close: jest.fn().mockResolvedValue(undefined),
  });
  jest.mocked(amqp.connect).mockResolvedValue(connection as never);
  const config = {
    get: jest.fn().mockReturnValue(undefined),
  } as unknown as ConfigService;
  const service = new RabbitMQService(config);
  await service.onModuleInit();
  return { service, channel };
}

function traceHeaders(retryCount: number): Record<string, unknown> {
  return {
    traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
    tracestate: 'vendor=value',
    'x-request-id': 'req-rabbit',
    'x-retry-count': retryCount,
  };
}

function consumeMessage(headers: Record<string, unknown>) {
  return {
    content: Buffer.from(JSON.stringify({ eventType: 'payment.succeeded.v1' })),
    properties: {
      contentType: 'application/json',
      messageId: 'event-1',
      correlationId: 'payment-1',
      headers,
    },
  } as unknown as amqp.ConsumeMessage;
}

async function processMessage(
  service: RabbitMQService,
  message: amqp.ConsumeMessage,
  callback: (content: unknown) => Promise<void>,
): Promise<void> {
  const observable = service as unknown as {
    processMessage(
      queueName: string,
      consumeMessage: amqp.ConsumeMessage,
      handler: (content: unknown) => Promise<void>,
    ): Promise<void>;
  };
  await observable.processMessage(
    'canteen.payment.succeeded.v1',
    message,
    callback,
  );
}
