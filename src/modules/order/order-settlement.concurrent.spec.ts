import { Types } from 'mongoose';
import { OrderSettlementService } from './order-settlement.service';

describe('Đối soát bàn có nhiều đơn', () => {
  function createService(unsettledOrder: object | null) {
    const tableId = new Types.ObjectId();
    const updateExec = jest.fn().mockResolvedValue(undefined);
    const tableModel = {
      updateOne: jest.fn(() => ({ exec: updateExec })),
    };
    const orderModel = {
      findById: jest.fn(() => ({
        select: jest.fn(() => ({
          exec: jest.fn().mockResolvedValue({ tableId }),
        })),
      })),
      exists: jest.fn(() => ({
        exec: jest.fn().mockResolvedValue(unsettledOrder),
      })),
    };

    return {
      service: new OrderSettlementService(
        orderModel as never,
        tableModel as never,
      ),
      tableModel,
    };
  }

  it('không giải phóng bàn khi còn đơn chưa tất toán', async () => {
    const { service, tableModel } = createService({ _id: 'active-order' });

    await service.reconcileTableForOrder(new Types.ObjectId());

    expect(tableModel.updateOne).not.toHaveBeenCalled();
  });

  it('giải phóng bàn khi mọi đơn đã hủy hoặc tất toán', async () => {
    const { service, tableModel } = createService(null);

    await service.reconcileTableForOrder(new Types.ObjectId());

    expect(tableModel.updateOne).toHaveBeenCalledTimes(1);
  });
});
