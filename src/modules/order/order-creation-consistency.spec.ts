import { ConflictException, NotFoundException } from '@nestjs/common';
import { Mongoose, Types } from 'mongoose';
import {
  ORDER_NUMBER_COUNTER_KEY,
  OrderCounterSchema,
} from '../../schemas/order-counter.schema';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderService } from './order.service';

describe('Tạo đơn hàng nhất quán', () => {
  const userId = new Types.ObjectId().toString();
  const menuItemId = new Types.ObjectId();
  const categoryId = new Types.ObjectId();
  const tableId = new Types.ObjectId();

  function createHarness(options?: {
    counterResults?: Array<{ sequence: number } | null>;
    legacySequence?: number;
    previousTable?: Record<string, unknown> | null;
    existingTable?: Record<string, unknown> | null;
    saveError?: Error;
    unsettledOrder?: object | null;
    activeCategory?: boolean;
    menuItems?: Array<{
      _id: Types.ObjectId;
      categoryId: Types.ObjectId;
      name: string;
      price: number;
      isAvailable: boolean;
      options: Array<{ name: string; price: number }>;
    }>;
  }) {
    const menuItem = {
      _id: menuItemId,
      categoryId,
      name: 'Cơm trưa',
      price: 35_000,
      isAvailable: true,
      options: [],
    };
    const menuItemModel = {
      find: jest.fn(() => ({
        exec: jest.fn().mockResolvedValue(options?.menuItems ?? [menuItem]),
      })),
    };
    const categoryModel = {
      distinct: jest.fn(() => ({
        exec: jest
          .fn()
          .mockResolvedValue(
            options?.activeCategory === false ? [] : [categoryId],
          ),
      })),
    };

    const savedTableIds: unknown[] = [];
    const orderModel = jest
      .fn()
      .mockImplementation((payload: Record<string, unknown>) => {
        const document = {
          ...payload,
          _id: new Types.ObjectId(),
          save: jest.fn(),
        };
        if (options?.saveError) {
          document.save.mockRejectedValue(options.saveError);
        } else {
          document.save.mockImplementation(() => {
            savedTableIds.push(payload.tableId);
            return Promise.resolve(document);
          });
        }
        return document;
      });
    const countDocuments = jest.fn();
    const aggregate = jest.fn(() => ({
      exec: jest
        .fn()
        .mockResolvedValue([{ sequence: options?.legacySequence ?? 1000 }]),
    }));
    const exists = jest.fn(() => ({
      exec: jest.fn().mockResolvedValue(options?.unsettledOrder ?? null),
    }));
    Object.assign(orderModel, { aggregate, countDocuments, exists });

    const counterResults = options?.counterResults ?? [{ sequence: 1001 }];
    let counterCall = 0;
    const orderCounterModel = {
      findOneAndUpdate: jest.fn(() => {
        const result =
          counterCall < counterResults.length
            ? counterResults[counterCall]
            : counterResults.at(-1);
        counterCall += 1;
        return { exec: jest.fn().mockResolvedValue(result) };
      }),
    };

    const previousTable =
      options && 'previousTable' in options
        ? options.previousTable
        : { _id: tableId, name: 'Bàn 1', status: 'empty' };
    const existingTable =
      options && 'existingTable' in options
        ? options.existingTable
        : { _id: tableId, name: 'Bàn 1', status: 'reserved' };
    const tableModel = {
      findOneAndUpdate: jest.fn(() => ({
        exec: jest.fn().mockResolvedValue(previousTable),
      })),
      findById: jest.fn(() => ({
        exec: jest.fn().mockResolvedValue(existingTable),
      })),
      updateOne: jest.fn(() => ({
        exec: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
      })),
    };

    const service = new OrderService(
      orderModel as never,
      menuItemModel as never,
      categoryModel as never,
      {} as never,
      tableModel as never,
      orderCounterModel as never,
    );
    const dto = Object.assign(new CreateOrderDto(), {
      tableId: tableId.toString(),
      items: [{ menuItemId: menuItemId.toString(), quantity: 1 }],
      paymentMethod: 'CASH',
    });

    return {
      service,
      dto,
      orderModel,
      countDocuments,
      aggregate,
      exists,
      orderCounterModel,
      tableModel,
      categoryModel,
      menuItemModel,
      savedTableIds,
    };
  }

  it('từ chối món thuộc danh mục đang ẩn', async () => {
    const { service, dto, orderModel } = createHarness({
      activeCategory: false,
    });

    await expect(
      service.createOrder(dto, { _id: userId, role: 'user' }),
    ).rejects.toThrow("Danh mục của món 'Cơm trưa' đang tạm ẩn");
    expect(orderModel).not.toHaveBeenCalled();
  });

  it('đọc giỏ hàng theo lô, giữ từng dòng món và giá option từ database', async () => {
    const secondItemId = new Types.ObjectId();
    const menuItems = [
      {
        _id: menuItemId,
        categoryId,
        name: 'Cơm trưa',
        price: 35_000,
        isAvailable: true,
        options: [{ name: 'Thêm trứng', price: 5_000 }],
      },
      {
        _id: secondItemId,
        categoryId,
        name: 'Nước',
        price: 10_000,
        isAvailable: true,
        options: [],
      },
    ];
    const { service, dto, menuItemModel, categoryModel } = createHarness({
      menuItems,
    });
    dto.items = [
      { menuItemId: secondItemId.toString(), quantity: 1 },
      {
        menuItemId: menuItemId.toString().toUpperCase(),
        quantity: 2,
        selectedOptions: [{ name: 'Thêm trứng' }],
      },
      { menuItemId: menuItemId.toString(), quantity: 1, note: 'Không hành' },
    ];

    const order = await service.createOrder(dto, { _id: userId });

    expect(menuItemModel.find).toHaveBeenCalledTimes(1);
    expect(menuItemModel.find).toHaveBeenCalledWith({
      _id: { $in: [secondItemId, menuItemId] },
    });
    expect(categoryModel.distinct).toHaveBeenCalledTimes(1);
    expect(categoryModel.distinct).toHaveBeenCalledWith('_id', {
      _id: { $in: [categoryId] },
      isActive: true,
    });
    expect(order.items.map((item) => item.menuItemId)).toEqual([
      secondItemId,
      menuItemId,
      menuItemId,
    ]);
    expect(order.items[1].selectedOptions).toEqual([
      { name: 'Thêm trứng', price: 5_000 },
    ]);
    expect(order.items[2].note).toBe('Không hành');
    expect(order.totalAmount).toBe(125_000);
  });

  it('từ chối món đã xóa và không truy vấn danh mục khi không tìm được món', async () => {
    const { service, dto, orderModel, categoryModel } = createHarness({
      menuItems: [],
    });

    await expect(service.createOrder(dto, { _id: userId })).rejects.toThrow(
      'không tồn tại',
    );
    expect(categoryModel.distinct).not.toHaveBeenCalled();
    expect(orderModel).not.toHaveBeenCalled();
  });

  it('từ chối món tạm ngưng bán sau khi đọc theo lô', async () => {
    const { service, dto, orderModel } = createHarness({
      menuItems: [
        {
          _id: menuItemId,
          categoryId,
          name: 'Cơm trưa',
          price: 35_000,
          isAvailable: false,
          options: [],
        },
      ],
    });

    await expect(service.createOrder(dto, { _id: userId })).rejects.toThrow(
      'tạm thời ngưng phục vụ',
    );
    expect(orderModel).not.toHaveBeenCalled();
  });

  it('cấp orderNumber bằng phép tăng counter nguyên tử', async () => {
    const { service, dto, orderModel, countDocuments, orderCounterModel } =
      createHarness();

    await service.createOrder(dto, { _id: userId, role: 'user' });

    expect(orderCounterModel.findOneAndUpdate).toHaveBeenCalledWith(
      { key: ORDER_NUMBER_COUNTER_KEY },
      { $inc: { sequence: 1 } },
      { new: true, runValidators: true },
    );
    expect(orderModel).toHaveBeenCalledWith(
      expect.objectContaining({ orderNumber: '#1001' }),
    );
    expect(countDocuments).not.toHaveBeenCalled();
  });

  it('seed counter lần đầu từ mã đơn lớn nhất của dữ liệu cũ', async () => {
    const { service, dto, orderModel, aggregate, orderCounterModel } =
      createHarness({
        counterResults: [null, { sequence: 1043 }],
        legacySequence: 1042,
      });

    await service.createOrder(dto, { _id: userId, role: 'user' });

    expect(aggregate).toHaveBeenCalledTimes(1);
    expect(orderCounterModel.findOneAndUpdate).toHaveBeenNthCalledWith(
      2,
      { key: ORDER_NUMBER_COUNTER_KEY },
      [
        {
          $set: {
            key: ORDER_NUMBER_COUNTER_KEY,
            sequence: {
              $add: [{ $ifNull: ['$sequence', 1042] }, 1],
            },
          },
        },
      ],
      { new: true, upsert: true, updatePipeline: true },
    );
    expect(orderModel).toHaveBeenCalledWith(
      expect.objectContaining({ orderNumber: '#1043' }),
    );
  });

  it.each([1000, 1042])(
    'khởi tạo counter qua Mongoose thật với seed %i',
    async (seed) => {
      const harness = createHarness({ legacySequence: seed });
      const mongoose = new Mongoose();
      const counterModel = mongoose.model('OrderCounter', OrderCounterSchema);
      // Chỉ giả lập MongoDB I/O để Mongoose vẫn kiểm tra query và options.
      const update = jest
        .spyOn(counterModel.collection, 'findOneAndUpdate')
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          _id: new Types.ObjectId(),
          key: ORDER_NUMBER_COUNTER_KEY,
          sequence: seed + 1,
        });
      const service = new OrderService(
        harness.orderModel as never,
        harness.menuItemModel as never,
        harness.categoryModel as never,
        {} as never,
        harness.tableModel as never,
        counterModel as never,
      );

      try {
        const order = await service.createOrder(harness.dto, { _id: userId });

        expect(order.orderNumber).toBe(`#${seed + 1}`);
        expect(update).toHaveBeenCalledTimes(2);
        expect(harness.aggregate).toHaveBeenCalledTimes(1);
      } finally {
        update.mockRestore();
        mongoose.deleteModel('OrderCounter');
      }
    },
  );

  it('từ chối tableId không tồn tại trước khi cấp số và lưu đơn', async () => {
    const { service, dto, orderModel, orderCounterModel, tableModel } =
      createHarness({ previousTable: null, existingTable: null });

    await expect(
      service.createOrder(Object.assign(dto, { tableId: tableId.toString() }), {
        _id: userId,
        role: 'user',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(tableModel.findById).toHaveBeenCalledWith(tableId);
    expect(orderCounterModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(orderModel).not.toHaveBeenCalled();
  });

  it('từ chối bàn reserved thay vì chiếm bàn của lượt đặt trước', async () => {
    const { service, dto, orderModel } = createHarness({
      previousTable: null,
      existingTable: { _id: tableId, name: 'Bàn 1', status: 'reserved' },
    });

    await expect(
      service.createOrder(Object.assign(dto, { tableId: tableId.toString() }), {
        _id: userId,
        role: 'user',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(orderModel).not.toHaveBeenCalled();
  });

  it('cho phép tạo nhiều đơn trên cùng bàn đã occupied', async () => {
    const { service, dto, tableModel, savedTableIds } = createHarness({
      counterResults: [{ sequence: 1001 }, { sequence: 1002 }],
      previousTable: {
        _id: tableId,
        name: 'Bàn 1',
        status: 'occupied',
      },
    });
    const tableOrder = Object.assign(dto, { tableId: tableId.toString() });

    await service.createOrder(tableOrder, { _id: userId, role: 'user' });
    await service.createOrder(tableOrder, { _id: userId, role: 'user' });

    expect(tableModel.findOneAndUpdate).toHaveBeenCalledTimes(2);
    expect(savedTableIds).toEqual([tableId, tableId]);
  });

  it('hoàn tác bàn empty nếu lưu đơn thất bại và không có đơn khác', async () => {
    const saveError = new Error('mongo write failed');
    const { service, dto, exists, tableModel } = createHarness({ saveError });

    await expect(
      service.createOrder(Object.assign(dto, { tableId: tableId.toString() }), {
        _id: userId,
        role: 'user',
      }),
    ).rejects.toBe(saveError);

    expect(exists).toHaveBeenCalledWith({
      tableId,
      status: { $ne: 'CANCELLED' },
      paymentStatus: { $ne: 'PAID' },
    });
    expect(tableModel.updateOne).toHaveBeenCalledWith(
      { _id: tableId, status: 'occupied' },
      { $set: { status: 'empty' } },
    );
  });

  it('không giải phóng bàn khi save lỗi nhưng đã có đơn khác chưa tất toán', async () => {
    const { service, dto, tableModel } = createHarness({
      saveError: new Error('mongo write failed'),
      unsettledOrder: { _id: new Types.ObjectId() },
    });

    await expect(
      service.createOrder(Object.assign(dto, { tableId: tableId.toString() }), {
        _id: userId,
        role: 'user',
      }),
    ).rejects.toThrow('mongo write failed');
    expect(tableModel.updateOne).not.toHaveBeenCalled();
  });
});
