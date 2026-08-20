import { ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import { PaymentConsumer } from './payment.consumer';

interface TestPaymentSucceededEvent {
  eventId: string;
  eventType: 'payment.succeeded.v1';
  version: 1;
  occurredAt: string;
  data: {
    paymentId: string;
    orderId: string;
    userId: string;
    amount: number;
    currency: 'VND';
    paymentMethod: 'VIETQR';
    providerTransactionId: string;
    paidAt: string;
  };
}

interface TestOrder {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  tableId: Types.ObjectId | null;
  finalAmount: number;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  paymentId?: string;
  providerTransactionId?: string;
  paidAt?: Date;
  save: jest.Mock<Promise<void>, []>;
}

const orderId = new Types.ObjectId();
const userId = new Types.ObjectId();
const tableId = new Types.ObjectId();

function createEvent(
  overrides: Partial<TestPaymentSucceededEvent['data']> = {},
): TestPaymentSucceededEvent {
  return {
    eventId: 'event-1',
    eventType: 'payment.succeeded.v1',
    version: 1,
    occurredAt: '2026-08-20T08:00:00.000Z',
    data: {
      paymentId: 'payment-1',
      orderId: orderId.toHexString(),
      userId: userId.toHexString(),
      amount: 125_000,
      currency: 'VND',
      paymentMethod: 'VIETQR',
      providerTransactionId: 'casso-transaction-1',
      paidAt: '2026-08-20T08:00:00.000Z',
      ...overrides,
    },
  };
}

function createOrder(overrides: Partial<TestOrder> = {}): TestOrder {
  const save = jest.fn<Promise<void>, []>(() => Promise.resolve());
  return {
    _id: orderId,
    userId,
    tableId,
    finalAmount: 125_000,
    status: 'COOKING',
    paymentStatus: 'PENDING',
    paymentMethod: 'VIETQR',
    save,
    ...overrides,
  };
}

function createConsumer(order: TestOrder) {
  const findByIdExec = jest.fn().mockResolvedValue(order);
  const orderModel = {
    findById: jest.fn().mockReturnValue({ exec: findByIdExec }),
  };
  const tableUpdateExec = jest.fn().mockResolvedValue({ modifiedCount: 1 });
  const tableModel = {
    updateOne: jest.fn().mockReturnValue({ exec: tableUpdateExec }),
  };
  const rabbitMQService = { subscribe: jest.fn() };
  const consumer = new PaymentConsumer(
    orderModel as never,
    tableModel as never,
    rabbitMQService as never,
  );

  return {
    consumer: consumer as unknown as {
      handle(event: TestPaymentSucceededEvent): Promise<void>;
    },
    orderModel,
    tableModel,
    tableUpdateExec,
  };
}

describe('PaymentConsumer', () => {
  it('marks the payment as paid without completing the order or releasing its table', async () => {
    const order = createOrder();
    const { consumer, orderModel, tableModel } = createConsumer(order);

    await consumer.handle(createEvent());

    expect(orderModel.findById).toHaveBeenCalledWith(orderId.toHexString());
    expect(order.paymentStatus).toBe('PAID');
    expect(order.paymentId).toBe('payment-1');
    expect(order.providerTransactionId).toBe('casso-transaction-1');
    expect(order.paidAt).toEqual(new Date('2026-08-20T08:00:00.000Z'));
    expect(order.status).toBe('COOKING');
    expect(order.save).toHaveBeenCalledTimes(1);
    expect(tableModel.updateOne).not.toHaveBeenCalled();
  });

  it('rejects an amount mismatch without changing the order or table', async () => {
    const order = createOrder();
    const { consumer, tableModel } = createConsumer(order);

    await expect(
      consumer.handle(createEvent({ amount: order.finalAmount + 1 })),
    ).rejects.toThrow(ConflictException);

    expect(order.paymentStatus).toBe('PENDING');
    expect(order.save).not.toHaveBeenCalled();
    expect(tableModel.updateOne).not.toHaveBeenCalled();
  });

  it('ignores a duplicate payment event for an active order', async () => {
    const paidAt = new Date('2026-08-20T07:59:00.000Z');
    const order = createOrder({
      paymentStatus: 'PAID',
      paymentId: 'payment-1',
      providerTransactionId: 'casso-transaction-1',
      paidAt,
    });
    const { consumer, tableModel } = createConsumer(order);

    await consumer.handle(createEvent());

    expect(order.save).not.toHaveBeenCalled();
    expect(order.paidAt).toBe(paidAt);
    expect(tableModel.updateOne).not.toHaveBeenCalled();
  });

  it('releases the table only after a newly paid order is completed', async () => {
    const order = createOrder({ status: 'COMPLETED' });
    const { consumer, tableModel, tableUpdateExec } = createConsumer(order);

    await consumer.handle(createEvent());

    expect(order.paymentStatus).toBe('PAID');
    expect(order.status).toBe('COMPLETED');
    expect(order.save).toHaveBeenCalledTimes(1);
    expect(tableModel.updateOne).toHaveBeenCalledWith(
      { _id: tableId },
      { $set: { status: 'empty' } },
    );
    expect(tableUpdateExec).toHaveBeenCalledTimes(1);
  });

  it('reconciles the table for a duplicate event when the order is completed', async () => {
    const order = createOrder({
      status: 'COMPLETED',
      paymentStatus: 'PAID',
      paymentId: 'payment-1',
      providerTransactionId: 'casso-transaction-1',
      paidAt: new Date('2026-08-20T08:00:00.000Z'),
    });
    const { consumer, tableModel } = createConsumer(order);

    await consumer.handle(createEvent());

    expect(order.save).not.toHaveBeenCalled();
    expect(tableModel.updateOne).toHaveBeenCalledTimes(1);
  });
});
