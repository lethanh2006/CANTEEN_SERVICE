import { ConflictException, ForbiddenException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Types } from 'mongoose';
import { CancelOrderDto } from './dto/cancel-order.dto';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto';
import { OrderService } from './order.service';

describe('Vòng đời đơn hàng căn tin', () => {
  const ownerId = new Types.ObjectId();
  const operatorId = new Types.ObjectId();

  function createService(order: Record<string, any>) {
    const orderModel = {
      findById: jest.fn(() => ({
        exec: jest.fn().mockResolvedValue(order),
      })),
      findOneAndUpdate: jest.fn(
        (_filter: Record<string, unknown>, update: { $set?: object }) => ({
          exec: jest.fn().mockImplementation(() => {
            Object.assign(order, update.$set ?? {});
            return Promise.resolve(order);
          }),
        }),
      ),
    };
    const settlement = {
      reconcileTableForOrder: jest.fn().mockResolvedValue(undefined),
    };
    const rabbitMQ = {
      publish: jest.fn().mockResolvedValue(undefined),
    };
    return {
      service: new OrderService(
        orderModel as never,
        {} as never,
        {} as never,
        settlement as never,
        rabbitMQ as never,
        {} as never,
        {} as never,
      ),
      orderModel,
      rabbitMQ,
      settlement,
    };
  }

  it('chủ đơn chỉ được hủy đơn CREATED', async () => {
    const order: {
      _id: Types.ObjectId;
      userId: Types.ObjectId;
      status: string;
      save: jest.Mock;
      cancellationReason?: string;
      cancelledBy?: Types.ObjectId;
    } = {
      _id: new Types.ObjectId(),
      userId: ownerId,
      status: 'CONFIRMED',
    };
    const { service } = createService(order);

    await expect(
      service.cancelOrder(order._id.toString(), {
        _id: ownerId.toString(),
        role: 'user',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('nhân sự vận hành được hủy đơn CONFIRMED và lưu lý do', async () => {
    const order = {
      _id: new Types.ObjectId(),
      userId: ownerId,
      status: 'CONFIRMED',
      save: jest.fn(),
    };
    order.save.mockResolvedValue(order);
    const { service, settlement } = createService(order);

    await service.cancelOrder(
      order._id.toString(),
      { _id: operatorId.toString(), role: 'cashier' },
      '  Khách đổi món  ',
    );

    expect(order.status).toBe('CANCELLED');
    expect(order.cancellationReason).toBe('Khách đổi món');
    expect(order.cancelledBy).toEqual(operatorId);
    expect(settlement.reconcileTableForOrder).toHaveBeenCalledWith(order._id);
  });

  it('không hủy đơn đã thanh toán khi chưa hoàn tiền', async () => {
    const order = {
      _id: new Types.ObjectId(),
      userId: ownerId,
      status: 'CREATED',
      paymentStatus: 'PAID',
    };
    const { service, orderModel } = createService(order);

    await expect(
      service.cancelOrder(order._id.toString(), {
        _id: ownerId.toString(),
        role: 'user',
      }),
    ).rejects.toThrow('Đơn hàng đã thanh toán không thể hủy');
    expect(orderModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('không hủy nếu thanh toán hoàn tất trong lúc cập nhật', async () => {
    const order = {
      _id: new Types.ObjectId(),
      userId: ownerId,
      status: 'CREATED',
      paymentStatus: 'PENDING',
    };
    const { service, orderModel } = createService(order);
    orderModel.findOneAndUpdate.mockReturnValueOnce({
      exec: jest.fn().mockResolvedValue(null),
    });

    await expect(
      service.cancelOrder(order._id.toString(), {
        _id: ownerId.toString(),
        role: 'user',
      }),
    ).rejects.toThrow('Đơn hàng đã thay đổi trạng thái hoặc thanh toán');
  });

  it('từ chối người không phải chủ đơn hoặc nhân sự vận hành', async () => {
    const order = {
      _id: new Types.ObjectId(),
      userId: ownerId,
      status: 'CREATED',
    };
    const { service } = createService(order);

    await expect(
      service.cancelOrder(order._id.toString(), {
        _id: new Types.ObjectId().toString(),
        role: 'user',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('chỉ hoàn thành đơn READY', async () => {
    const order = {
      _id: new Types.ObjectId(),
      status: 'COOKING',
    };
    const { service } = createService(order);

    await expect(
      service.completeOrder(order._id.toString()),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('chỉ xác nhận đơn thanh toán điện tử sau khi đã trả tiền', async () => {
    const order = {
      _id: new Types.ObjectId(),
      userId: ownerId,
      userRole: 'user',
      status: 'CREATED',
      paymentMethod: 'VIETQR',
      paymentStatus: 'PENDING',
      createdAt: new Date(),
    };
    const { service, orderModel } = createService(order);

    await expect(service.confirmOrder(order._id.toString())).rejects.toThrow(
      'phải được thanh toán trước khi xác nhận',
    );
    expect(orderModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('xác nhận đơn bằng điều kiện thanh toán nguyên tử', async () => {
    const order = {
      _id: new Types.ObjectId(),
      userId: ownerId,
      userRole: 'user',
      status: 'CREATED',
      paymentMethod: 'VIETQR',
      paymentStatus: 'PAID',
      createdAt: new Date(),
      orderNumber: 'ORD-TEST',
      tableId: null,
    };
    const { service, orderModel, rabbitMQ } = createService(order);

    await expect(service.confirmOrder(order._id.toString())).resolves.toEqual(
      expect.objectContaining({ status: 'CONFIRMED' }),
    );
    expect(orderModel.findOneAndUpdate).toHaveBeenCalledWith(
      {
        _id: order._id,
        status: 'CREATED',
        $or: [{ paymentMethod: 'CASH' }, { paymentStatus: 'PAID' }],
      },
      { $set: { status: 'CONFIRMED', priorityScore: 50 } },
      { new: true, runValidators: true },
    );
    expect(rabbitMQ.publish).toHaveBeenCalledWith(
      'order.confirmed',
      expect.objectContaining({ orderId: order._id.toString() }),
    );
  });

  it('kiểm tra query phân trang và lý do hủy', async () => {
    const query = plainToInstance(ListOrdersQueryDto, {
      status: 'READY',
      paymentStatus: 'PENDING',
      page: '2',
      limit: '50',
    });
    const invalidCancel = plainToInstance(CancelOrderDto, {
      reason: 'x'.repeat(501),
    });

    await expect(validate(query)).resolves.toHaveLength(0);
    expect(query.page).toBe(2);
    expect(query.limit).toBe(50);
    await expect(validate(invalidCancel)).resolves.toHaveLength(1);
  });
});
