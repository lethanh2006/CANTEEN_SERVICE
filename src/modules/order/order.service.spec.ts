import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { OrderService } from './order.service';

const menuItemId = new Types.ObjectId();
const userId = new Types.ObjectId();

interface TestOrderDocument {
  items: Array<{
    selectedOptions: Array<{ name: string; price: number }>;
  }>;
  totalAmount: number;
  finalAmount: number;
  save: jest.Mock<Promise<TestOrderDocument>, []>;
}

function createHarness() {
  const menuItem = {
    _id: menuItemId,
    name: 'Cơm gà',
    price: 50_000,
    isAvailable: true,
    options: [
      { name: 'Trứng ốp la', price: 12_000 },
      { name: 'Thêm cơm', price: 8_000 },
    ],
  };
  const createdOrders: TestOrderDocument[] = [];
  const orderModel = jest.fn().mockImplementation((input: object) => {
    const document = input as TestOrderDocument;
    document.save = jest.fn(() => Promise.resolve(document));
    createdOrders.push(document);
    return document;
  });
  Object.assign(orderModel, {
    countDocuments: jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(0),
    }),
  });
  const menuItemModel = {
    findById: jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(menuItem),
    }),
  };
  const orderSettlementService = {
    reconcileTableForOrder: jest.fn().mockResolvedValue(undefined),
  };
  const rabbitMQService = {};

  return {
    service: new OrderService(
      orderModel as never,
      menuItemModel as never,
      orderSettlementService as never,
      rabbitMQService as never,
    ),
    orderModel,
    createdOrders,
    orderSettlementService,
  };
}

interface TestCompletionOrder {
  _id: Types.ObjectId;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  tableId: Types.ObjectId;
  save: jest.Mock<Promise<TestCompletionOrder>, []>;
}

function createCompletionHarness(overrides: Partial<TestCompletionOrder> = {}) {
  const order = {
    _id: new Types.ObjectId(),
    status: 'READY',
    paymentStatus: 'PENDING',
    paymentMethod: 'VIETQR',
    tableId: new Types.ObjectId(),
    ...overrides,
  } as TestCompletionOrder;
  order.save = jest.fn(() => Promise.resolve(order));

  const orderModel = {
    findById: jest.fn().mockReturnValue({
      exec: jest.fn().mockResolvedValue(order),
    }),
  };
  const orderSettlementService = {
    reconcileTableForOrder: jest.fn().mockResolvedValue(undefined),
  };

  return {
    service: new OrderService(
      orderModel as never,
      {} as never,
      orderSettlementService as never,
      {} as never,
    ),
    order,
    orderSettlementService,
  };
}

describe('OrderService - giá authoritative', () => {
  it('bỏ qua price từ client và tính tổng bằng giá option trong MenuItem', async () => {
    const harness = createHarness();

    const result = (await harness.service.createOrder(
      {
        items: [
          {
            menuItemId: menuItemId.toHexString(),
            quantity: 2,
            selectedOptions: [
              { name: '  trứng ốp la ', price: 1 },
              { name: 'Thêm cơm', price: 999_999 },
            ],
          },
        ],
        paymentMethod: 'VIETQR',
      },
      { _id: userId.toHexString(), role: 'user' },
    )) as unknown as TestOrderDocument;

    expect(result.items[0]?.selectedOptions).toEqual([
      { name: 'Trứng ốp la', price: 12_000 },
      { name: 'Thêm cơm', price: 8_000 },
    ]);
    expect(result.totalAmount).toBe(140_000);
    expect(result.finalAmount).toBe(140_000);
    expect(harness.orderModel).toHaveBeenCalledTimes(1);
  });

  it('từ chối option không tồn tại trong MenuItem', async () => {
    const harness = createHarness();

    await expect(
      harness.service.createOrder(
        {
          items: [
            {
              menuItemId: menuItemId.toHexString(),
              quantity: 1,
              selectedOptions: [{ name: 'Phô mai giả', price: 0 }],
            },
          ],
        },
        { _id: userId.toHexString(), role: 'user' },
      ),
    ).rejects.toThrow(BadRequestException);

    expect(harness.orderModel).not.toHaveBeenCalled();
  });
});

describe('OrderService - hoàn tất đơn', () => {
  it('đọc lại trạng thái settlement sau khi lưu COMPLETED', async () => {
    const harness = createCompletionHarness();

    await harness.service.completeOrder(harness.order._id.toHexString());

    expect(harness.order.status).toBe('COMPLETED');
    expect(harness.order.save).toHaveBeenCalledTimes(1);
    expect(
      harness.orderSettlementService.reconcileTableForOrder,
    ).toHaveBeenCalledWith(harness.order._id);
    expect(harness.order.save.mock.invocationCallOrder[0]).toBeLessThan(
      harness.orderSettlementService.reconcileTableForOrder.mock
        .invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    );
  });

  it('complete lặp lại vẫn reconcile để sửa bàn bị kẹt', async () => {
    const harness = createCompletionHarness({
      status: 'COMPLETED',
      paymentStatus: 'PAID',
    });

    const result = await harness.service.completeOrder(
      harness.order._id.toHexString(),
    );

    expect(result).toBe(harness.order);
    expect(harness.order.save).not.toHaveBeenCalled();
    expect(
      harness.orderSettlementService.reconcileTableForOrder,
    ).toHaveBeenCalledWith(harness.order._id);
  });
});
