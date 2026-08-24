import { ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import { PaymentConsumer, PaymentSucceededEvent } from './payment.consumer';

describe('PaymentConsumer contract v2', () => {
  const orderId = new Types.ObjectId();
  const userId = new Types.ObjectId();
  const event = (): PaymentSucceededEvent => ({
    eventId: '5ad62f76-3ca1-46cb-ab36-9696b40e50d1',
    eventType: 'payment.succeeded.v1',
    version: 1,
    occurredAt: '2026-08-24T10:00:00.000Z',
    data: {
      paymentId: '4ca949f2-005b-4a1a-9168-6519f0a19777',
      orderId: orderId.toString(),
      userId: userId.toString(),
      amount: 125_000,
      currency: 'VND',
      paymentMethod: 'VIETQR',
      providerTransactionId: 'casso-transaction-1',
      paidAt: '2026-08-24T09:59:00.000Z',
    },
  });

  function setup(updatedOrder: unknown, existingOrder: unknown = null) {
    const execUpdate = jest.fn().mockResolvedValue(updatedOrder);
    const execFind = jest.fn().mockResolvedValue(existingOrder);
    const orderModel = {
      findOneAndUpdate: jest.fn((...args: unknown[]) => {
        void args;
        return { exec: execUpdate };
      }),
      findById: jest.fn(() => ({ exec: execFind })),
    };
    const settlement = {
      reconcileTableForOrder: jest.fn().mockResolvedValue(undefined),
    };
    const consumer = new PaymentConsumer(
      orderModel as never,
      settlement as never,
      {} as never,
    );
    return { consumer, orderModel, settlement };
  }

  it('từ chối event thiếu UUID payment trước khi truy cập MongoDB', async () => {
    const { consumer, orderModel } = setup(null);
    const invalid = event();
    invalid.data.paymentId = '';

    await expect(consumer.handle(invalid)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(orderModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('chỉ chuyển atomically Order PENDING khớp contract sang PAID', async () => {
    const updatedOrder = { _id: orderId };
    const { consumer, orderModel, settlement } = setup(updatedOrder);

    await consumer.handle(event());

    expect(orderModel.findOneAndUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: orderId,
        userId,
        finalAmount: 125_000,
        paymentMethod: 'VIETQR',
        paymentStatus: 'PENDING',
      }),
      expect.any(Object),
      { new: true, runValidators: true },
    );
    const update = orderModel.findOneAndUpdate.mock.calls[0][1] as {
      $set: Record<string, unknown>;
    };
    expect(update.$set).toMatchObject({
      paymentStatus: 'PAID',
      paymentId: event().data.paymentId,
      paymentEventId: event().eventId,
    });
    expect(settlement.reconcileTableForOrder).toHaveBeenCalledWith(orderId);
  });

  it('chấp nhận delivery lặp chỉ khi toàn bộ payment metadata trùng khớp', async () => {
    const repeated = event();
    const existingOrder = {
      _id: orderId,
      status: 'COMPLETED',
      userId,
      finalAmount: repeated.data.amount,
      paymentMethod: 'VIETQR',
      paymentStatus: 'PAID',
      paymentId: repeated.data.paymentId,
      paymentEventId: repeated.eventId,
      providerTransactionId: repeated.data.providerTransactionId,
      paidAt: new Date(repeated.data.paidAt),
    };
    const { consumer, settlement } = setup(null, existingOrder);

    await consumer.handle(repeated);

    expect(settlement.reconcileTableForOrder).toHaveBeenCalledWith(orderId);
  });

  it('từ chối event khác ghi đè Order đã PAID', async () => {
    const conflicting = event();
    const existingOrder = {
      _id: orderId,
      status: 'COMPLETED',
      userId,
      finalAmount: conflicting.data.amount,
      paymentMethod: 'VIETQR',
      paymentStatus: 'PAID',
      paymentId: 'b94ea8fc-0c75-4ac3-91af-5e889691c9a4',
      paymentEventId: conflicting.eventId,
      providerTransactionId: conflicting.data.providerTransactionId,
      paidAt: new Date(conflicting.data.paidAt),
    };
    const { consumer } = setup(null, existingOrder);

    await expect(consumer.handle(conflicting)).rejects.toThrow(
      'Đơn hàng đã được trả bởi payment khác',
    );
  });
});
