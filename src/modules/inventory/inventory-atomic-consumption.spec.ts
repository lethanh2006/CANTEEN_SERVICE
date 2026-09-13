import { BadRequestException, ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import { InventoryService } from './inventory.service';

describe('InventoryService atomic consumption', () => {
  const ingredientId = new Types.ObjectId();
  const batchId = new Types.ObjectId();

  it('từ chối tạo lô đã hết hạn', async () => {
    const ingredientModel = {
      findById: jest.fn(() => ({
        exec: jest.fn().mockResolvedValue({ _id: ingredientId }),
      })),
    };
    const service = new InventoryService(
      ingredientModel as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.createBatch({
        ingredientId: ingredientId.toString(),
        quantity: 5,
        expiryDate: '2020-01-01T00:00:00.000Z',
        costPrice: 10_000,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  function setup(matchedCount = 1) {
    const ingredient = {
      _id: ingredientId,
      name: 'Gạo',
      unit: 'kg',
      minimumThreshold: 3,
    };
    const activeBatch = {
      _id: batchId,
      expiryDate: new Date('2030-01-01T00:00:00.000Z'),
      quantity: 10,
    };
    const endSession = jest.fn().mockResolvedValue(undefined);
    const withTransaction = jest.fn(
      async (callback: () => Promise<unknown>): Promise<unknown> => callback(),
    );
    const session = { withTransaction, endSession };
    const ingredientModel = {
      findById: jest.fn(() => ({
        session: jest.fn(() => ({
          exec: jest.fn().mockResolvedValue(ingredient),
        })),
      })),
    };
    const updateMany = jest.fn((...args: unknown[]) => {
      void args;
      return { exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }) };
    });
    const find = jest.fn((...args: unknown[]) => {
      void args;
      return {
        sort: jest.fn(() => ({
          session: jest.fn(() => ({
            exec: jest.fn().mockResolvedValue([activeBatch]),
          })),
        })),
      };
    });
    const updateOne = jest.fn((...args: unknown[]) => {
      void args;
      return { exec: jest.fn().mockResolvedValue({ matchedCount }) };
    });
    const batchModel = {
      db: {
        startSession: jest.fn().mockResolvedValue(session),
      },
      updateMany,
      find,
      updateOne,
    };
    const rabbitMQService = {
      publish: jest.fn().mockResolvedValue(true),
    };
    const service = new InventoryService(
      ingredientModel as never,
      batchModel as never,
      rabbitMQService as never,
    );

    return {
      batchModel,
      endSession,
      rabbitMQService,
      service,
      withTransaction,
    };
  }

  it('loại batch hết hạn và cập nhật batch bằng điều kiện số lượng cũ', async () => {
    const { batchModel, endSession, service, withTransaction } = setup();

    await service.consumeIngredient({
      ingredientId: ingredientId.toString(),
      quantity: 4,
    });

    expect(withTransaction).toHaveBeenCalledTimes(1);
    expect(batchModel.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        ingredientId,
        status: 'ACTIVE',
        expiryDate: { $lte: expect.any(Date) as Date },
      }),
      { $set: { status: 'EXPIRED' } },
      expect.objectContaining({ runValidators: true }),
    );
    expect(batchModel.find).toHaveBeenCalledWith(
      expect.objectContaining({
        ingredientId,
        status: 'ACTIVE',
        quantity: { $gt: 0 },
        expiryDate: { $gt: expect.any(Date) as Date },
      }),
      { expiryDate: 1, quantity: 1 },
    );
    expect(batchModel.updateOne).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: batchId,
        ingredientId,
        status: 'ACTIVE',
        quantity: 10,
        expiryDate: { $gt: expect.any(Date) as Date },
      }),
      { $set: { quantity: 6, status: 'ACTIVE' } },
      expect.objectContaining({ runValidators: true }),
    );
    expect(endSession).toHaveBeenCalledTimes(1);
  });

  it('hủy giao dịch khi batch bị thay đổi đồng thời', async () => {
    const { endSession, service } = setup(0);

    await expect(
      service.consumeIngredient({
        ingredientId: ingredientId.toString(),
        quantity: 4,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(endSession).toHaveBeenCalledTimes(1);
  });
});
