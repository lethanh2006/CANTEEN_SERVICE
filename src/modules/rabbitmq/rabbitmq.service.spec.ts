import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqplib';
import type { ConsumeMessage } from 'amqplib';
import { RabbitMQService } from './rabbitmq.service';

jest.mock('amqplib', () => ({
  connect: jest.fn(),
}));

interface TestChannel {
  ack: jest.Mock;
  assertQueue: jest.Mock;
  close: jest.Mock;
  consume: jest.Mock;
  nack: jest.Mock;
  prefetch: jest.Mock;
  sendToQueue: jest.Mock;
  waitForConfirms: jest.Mock;
}

interface RabbitServiceTestAccess {
  channel: TestChannel | null;
  processMessage(
    queueName: string,
    message: ConsumeMessage,
    callback: (content: unknown) => Promise<void> | void,
  ): Promise<void>;
}

function createChannel(): TestChannel {
  return {
    ack: jest.fn(),
    assertQueue: jest.fn().mockResolvedValue(undefined),
    close: jest.fn().mockResolvedValue(undefined),
    consume: jest.fn().mockResolvedValue(undefined),
    nack: jest.fn(),
    prefetch: jest.fn().mockResolvedValue(undefined),
    sendToQueue: jest.fn().mockReturnValue(true),
    waitForConfirms: jest.fn().mockResolvedValue(undefined),
  };
}

function createMessage(retryCount = 0): ConsumeMessage {
  return {
    content: Buffer.from(JSON.stringify({ eventId: 'event-1' })),
    fields: {},
    properties: {
      contentType: 'application/json',
      messageId: 'message-1',
      correlationId: 'order-1',
      headers: { 'x-retry-count': retryCount },
    },
  } as unknown as ConsumeMessage;
}

function createService() {
  const configService = {
    get: jest.fn().mockReturnValue(undefined),
  } as unknown as ConfigService;
  const service = new RabbitMQService(configService);
  return {
    service,
    access: service as unknown as RabbitServiceTestAccess,
  };
}

describe('RabbitMQService', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('tạo ConfirmChannel khi kết nối RabbitMQ', async () => {
    const channel = createChannel();
    const connection = {
      createConfirmChannel: jest.fn().mockResolvedValue(channel),
      close: jest.fn().mockResolvedValue(undefined),
      on: jest.fn(),
    };
    jest.mocked(amqp.connect).mockResolvedValue(connection as never);
    const { service } = createService();

    await service.onModuleInit();

    expect(connection.createConfirmChannel).toHaveBeenCalledTimes(1);
    expect(channel.prefetch).toHaveBeenCalledWith(10);
    await service.onModuleDestroy();
  });

  it('chỉ ack bản gốc sau khi broker confirm bản retry', async () => {
    const channel = createChannel();
    const { access } = createService();
    access.channel = channel;
    const message = createMessage();

    await access.processMessage('payment.events', message, () =>
      Promise.reject(new Error('MongoDB tạm thời lỗi')),
    );

    expect(channel.sendToQueue).toHaveBeenCalledWith(
      'payment.events',
      message.content,
      {
        persistent: true,
        contentType: 'application/json',
        messageId: 'message-1',
        correlationId: 'order-1',
        headers: { 'x-retry-count': 1 },
      },
    );
    expect(channel.waitForConfirms).toHaveBeenCalledTimes(1);
    expect(channel.ack).toHaveBeenCalledWith(message);
    expect(channel.nack).not.toHaveBeenCalled();
    expect(channel.waitForConfirms.mock.invocationCallOrder[0]).toBeLessThan(
      channel.ack.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    );
  });

  it('nack và requeue bản gốc nếu broker không confirm bản retry', async () => {
    const channel = createChannel();
    channel.waitForConfirms.mockRejectedValueOnce(
      new Error('Mất kết nối trước confirm'),
    );
    const { access } = createService();
    access.channel = channel;
    const message = createMessage();

    await access.processMessage('payment.events', message, () =>
      Promise.reject(new Error('MongoDB tạm thời lỗi')),
    );

    expect(channel.ack).not.toHaveBeenCalled();
    expect(channel.nack).toHaveBeenCalledWith(message, false, true);
  });

  it('chỉ ack sau khi broker confirm thông điệp DLQ', async () => {
    const channel = createChannel();
    const { access } = createService();
    access.channel = channel;
    const message = createMessage(5);

    await access.processMessage('payment.events', message, () =>
      Promise.reject(new Error('Payload không hợp lệ')),
    );

    expect(channel.sendToQueue).toHaveBeenCalledWith(
      'payment.events.dlq',
      message.content,
      {
        persistent: true,
        contentType: 'application/json',
        messageId: 'message-1',
        correlationId: 'order-1',
        headers: {
          'x-retry-count': 6,
          'x-last-error': 'Payload không hợp lệ',
        },
      },
    );
    expect(channel.waitForConfirms).toHaveBeenCalledTimes(1);
    expect(channel.ack).toHaveBeenCalledWith(message);
    expect(channel.waitForConfirms.mock.invocationCallOrder[0]).toBeLessThan(
      channel.ack.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    );
  });
});
