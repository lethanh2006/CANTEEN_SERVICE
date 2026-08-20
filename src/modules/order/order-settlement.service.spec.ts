import { Types } from 'mongoose';
import { OrderSettlementService } from './order-settlement.service';

const orderId = new Types.ObjectId();
const tableId = new Types.ObjectId();

interface PersistedOrderState {
  status: string;
  paymentStatus: string;
  tableId: Types.ObjectId | null;
}

function createHarness(initial: PersistedOrderState) {
  const state = { ...initial };
  const findExec = jest.fn(() =>
    Promise.resolve(
      state.status === 'COMPLETED' &&
        state.paymentStatus === 'PAID' &&
        state.tableId
        ? { _id: orderId, tableId: state.tableId }
        : null,
    ),
  );
  const orderModel = {
    findOne: jest.fn().mockReturnValue({ exec: findExec }),
  };
  const tableUpdateExec = jest.fn().mockResolvedValue({ modifiedCount: 1 });
  const tableModel = {
    updateOne: jest.fn().mockReturnValue({ exec: tableUpdateExec }),
  };

  return {
    service: new OrderSettlementService(
      orderModel as never,
      tableModel as never,
    ),
    state,
    orderModel,
    tableModel,
    tableUpdateExec,
  };
}

describe('OrderSettlementService', () => {
  it.each([
    ['thanh toán đến sau', 'status', 'paymentStatus'],
    ['hoàn tất đến sau', 'paymentStatus', 'status'],
  ] as const)(
    'hội tụ và giải phóng bàn khi %s',
    async (_name, firstField, secondField) => {
      const harness = createHarness({
        status: 'READY',
        paymentStatus: 'PENDING',
        tableId,
      });

      harness.state[firstField] =
        firstField === 'status' ? 'COMPLETED' : 'PAID';
      await harness.service.reconcileTableForOrder(orderId);
      expect(harness.tableModel.updateOne).not.toHaveBeenCalled();

      harness.state[secondField] =
        secondField === 'status' ? 'COMPLETED' : 'PAID';
      await harness.service.reconcileTableForOrder(orderId);

      expect(harness.tableModel.updateOne).toHaveBeenCalledWith(
        { _id: tableId, status: { $ne: 'empty' } },
        { $set: { status: 'empty' } },
      );
    },
  );

  it('cho phép retry reconcile sau khi cập nhật bàn lỗi', async () => {
    const harness = createHarness({
      status: 'COMPLETED',
      paymentStatus: 'PAID',
      tableId,
    });
    harness.tableUpdateExec
      .mockRejectedValueOnce(new Error('MongoDB tạm thời lỗi'))
      .mockResolvedValueOnce({ modifiedCount: 1 });

    await expect(
      harness.service.reconcileTableForOrder(orderId),
    ).rejects.toThrow('MongoDB tạm thời lỗi');
    await expect(
      harness.service.reconcileTableForOrder(orderId),
    ).resolves.toBeUndefined();

    expect(harness.tableUpdateExec).toHaveBeenCalledTimes(2);
  });
});
