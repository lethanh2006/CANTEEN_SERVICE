import { ConflictException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { KitchenService } from './kitchen.service';

describe('Vòng đời đơn hàng trong bếp', () => {
  function createHarness(options?: {
    transitioned?: Record<string, unknown> | null;
    current?: Record<string, unknown> | null;
  }) {
    const session = {
      withTransaction: jest.fn(async (callback: () => Promise<unknown>) =>
        callback(),
      ),
      endSession: jest.fn().mockResolvedValue(undefined),
    };
    const findOneAndUpdate = jest.fn(() => ({
      exec: jest.fn().mockResolvedValue(options?.transitioned ?? null),
    }));
    const findById = jest.fn(() => ({
      exec: jest.fn().mockResolvedValue(options?.current ?? null),
    }));
    const outboxService = {
      enqueue: jest.fn().mockResolvedValue(undefined),
    };
    const service = new KitchenService(
      {
        db: { startSession: jest.fn().mockResolvedValue(session) },
        findOneAndUpdate,
        findById,
      } as never,
      outboxService as never,
    );

    return { service, findOneAndUpdate, findById, outboxService, session };
  }

  it('nhận nấu bằng phép chuyển CONFIRMED sang COOKING nguyên tử', async () => {
    const id = new Types.ObjectId().toString();
    const transitioned = { _id: id, status: 'COOKING' };
    const { service, findOneAndUpdate, findById } = createHarness({
      transitioned,
    });

    await expect(service.setOrderCooking(id)).resolves.toBe(transitioned);
    expect(findOneAndUpdate).toHaveBeenCalledWith(
      { _id: id, status: 'CONFIRMED' },
      { $set: { status: 'COOKING' } },
      { new: true },
    );
    expect(findById).not.toHaveBeenCalled();
  });

  it('không cho đơn CONFIRMED nhảy thẳng sang READY', async () => {
    const id = new Types.ObjectId().toString();
    const { service, outboxService } = createHarness({
      current: { _id: id, status: 'CONFIRMED' },
    });

    await expect(service.setOrderReady(id)).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(outboxService.enqueue).not.toHaveBeenCalled();
  });

  it('chỉ phát sự kiện khi chuyển COOKING sang READY thành công', async () => {
    const id = new Types.ObjectId().toString();
    const transitioned = {
      _id: { toString: () => id },
      orderNumber: '#1001',
      status: 'READY',
      updatedAt: new Date('2026-08-24T00:00:00.000Z'),
    };
    const { service, outboxService, findById, session } = createHarness({
      transitioned,
    });

    await expect(service.setOrderReady(id)).resolves.toBe(transitioned);
    expect(outboxService.enqueue).toHaveBeenCalledWith(
      {
        eventType: 'order.ready',
        queueName: 'order.ready',
        aggregateId: id,
        payload: {
          orderId: id,
          orderNumber: '#1001',
          status: 'READY',
          updatedAt: transitioned.updatedAt,
        },
      },
      session,
    );
    expect(findById).not.toHaveBeenCalled();
  });

  it('giữ tính idempotent cho đơn đã READY mà không phát lại sự kiện', async () => {
    const id = new Types.ObjectId().toString();
    const current = { _id: id, status: 'READY' };
    const { service, outboxService } = createHarness({ current });

    await expect(service.setOrderReady(id)).resolves.toBe(current);
    expect(outboxService.enqueue).not.toHaveBeenCalled();
  });

  it('trả lỗi không tìm thấy sau khi chuyển trạng thái thất bại', async () => {
    const { service } = createHarness();

    await expect(
      service.setOrderCooking(new Types.ObjectId().toString()),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
