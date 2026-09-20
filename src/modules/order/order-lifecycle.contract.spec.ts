import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { Types } from 'mongoose';
import { CancelOrderDto } from './dto/cancel-order.dto';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto';
import { OrderService } from './order.service';

type TestOrder = {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  status: string;
  paymentMethod: string;
  paymentStatus: string;
  paidAt?: Date;
  paidBy?: Types.ObjectId;
  cancelledBy?: Types.ObjectId;
  cancellationReason?: string;
};

describe('Vòng đời đơn hàng tiền mặt', () => {
  const ownerId = new Types.ObjectId();
  const adminId = new Types.ObjectId();
  const owner = { _id: ownerId.toString(), role: 'user' };
  const admin = { _id: adminId.toString(), role: 'admin' };

  function createService(overrides: Partial<TestOrder> = {}) {
    const order: TestOrder = {
      _id: new Types.ObjectId(),
      userId: ownerId,
      status: 'CREATED',
      paymentMethod: 'CASH',
      paymentStatus: 'PENDING',
      ...overrides,
    };
    const orderModel = {
      findById: jest.fn(() => ({
        exec: jest.fn<Promise<TestOrder | null>, []>().mockResolvedValue(order),
      })),
      findOneAndUpdate: jest.fn(
        (_filter: object, update: { $set: object }) => ({
          exec: jest.fn<Promise<TestOrder | null>, []>(() =>
            Promise.resolve(Object.assign(order, update.$set)),
          ),
        }),
      ),
    };
    const settlement = {
      reconcileTableForOrder: jest.fn().mockResolvedValue(undefined),
    };
    const service = new OrderService(
      orderModel as never,
      {} as never,
      {} as never,
      settlement as never,
      {} as never,
      {} as never,
    );
    return { service, order, orderModel, settlement };
  }

  it.each([owner, admin])(
    'chủ đơn và admin được hủy đơn chưa thanh toán',
    async (user) => {
      const { service, order, settlement } = createService();
      await service.cancelOrder(
        order._id.toString(),
        user,
        '  Khách đổi món  ',
      );
      expect(order).toMatchObject({
        status: 'CANCELLED',
        cancellationReason: 'Khách đổi món',
      });
      expect(order.cancelledBy?.toString()).toBe(user._id);
      expect(settlement.reconcileTableForOrder).toHaveBeenCalledWith(order._id);
    },
  );

  it('không hủy đơn đã thanh toán', async () => {
    const { service, order, orderModel } = createService({
      status: 'COMPLETED',
      paymentStatus: 'PAID',
    });
    await expect(
      service.cancelOrder(order._id.toString(), owner),
    ).rejects.toThrow('Đơn hàng đã thanh toán không thể hủy');
    expect(orderModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('không hủy nếu thanh toán hoàn tất trong lúc cập nhật', async () => {
    const { service, order, orderModel } = createService();
    orderModel.findOneAndUpdate.mockReturnValueOnce({
      exec: jest.fn<Promise<TestOrder | null>, []>().mockResolvedValue(null),
    });
    await expect(
      service.cancelOrder(order._id.toString(), owner),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(orderModel.findOneAndUpdate.mock.calls[0][0]).toMatchObject({
      status: 'CREATED',
      paymentStatus: 'PENDING',
    });
  });

  it('từ chối hủy và đọc đơn của người khác', async () => {
    const { service, order } = createService();
    const stranger = { _id: new Types.ObjectId().toString(), role: 'user' };
    await expect(
      service.cancelOrder(order._id.toString(), stranger),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.getOrderById(order._id.toString(), stranger),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('admin thu tiền chuyển đơn sang hoàn tất và đối soát bàn', async () => {
    const { service, order, orderModel, settlement } = createService();
    await service.confirmCashPayment(order._id.toString(), admin);
    expect(order).toMatchObject({
      status: 'COMPLETED',
      paymentStatus: 'PAID',
      paidBy: adminId,
    });
    expect(order.paidAt).toBeInstanceOf(Date);
    expect(orderModel.findOneAndUpdate.mock.calls[0][0]).toEqual({
      _id: order._id,
      status: { $ne: 'CANCELLED' },
      paymentMethod: 'CASH',
      paymentStatus: 'PENDING',
    });
    expect(settlement.reconcileTableForOrder).toHaveBeenCalledWith(order._id);
  });

  it('người dùng không được tự xác nhận thu tiền', async () => {
    const { service, order, orderModel } = createService();
    await expect(
      service.confirmCashPayment(order._id.toString(), owner),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(orderModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('không thu tiền đơn đã hủy', async () => {
    const { service, order, orderModel } = createService({
      status: 'CANCELLED',
    });
    await expect(
      service.confirmCashPayment(order._id.toString(), admin),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(orderModel.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('không ghi đè đơn vừa bị hủy trong lúc thu tiền', async () => {
    const { service, order, orderModel, settlement } = createService();
    orderModel.findOneAndUpdate.mockReturnValueOnce({
      exec: jest.fn<Promise<TestOrder | null>, []>().mockResolvedValue(null),
    });
    await expect(
      service.confirmCashPayment(order._id.toString(), admin),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(settlement.reconcileTableForOrder).not.toHaveBeenCalled();
  });

  it('thu tiền lặp lại giữ nguyên người thu và đối soát lại bàn', async () => {
    const paidAt = new Date();
    const { service, order, orderModel, settlement } = createService({
      status: 'COMPLETED',
      paymentStatus: 'PAID',
      paidAt,
      paidBy: adminId,
    });
    await service.confirmCashPayment(order._id.toString(), admin);
    expect(orderModel.findOneAndUpdate).not.toHaveBeenCalled();
    expect(order).toMatchObject({ paidAt, paidBy: adminId });
    expect(settlement.reconcileTableForOrder).toHaveBeenCalledWith(order._id);
  });

  it('không chuyển đơn phương thức khác thành thanh toán tiền mặt', async () => {
    const { service, order } = createService({ paymentMethod: 'VIETQR' });
    await expect(
      service.confirmCashPayment(order._id.toString(), admin),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('báo không tìm thấy đơn khi thu tiền', async () => {
    const { service, orderModel } = createService();
    orderModel.findById.mockReturnValueOnce({
      exec: jest.fn<Promise<TestOrder | null>, []>().mockResolvedValue(null),
    });
    await expect(
      service.confirmCashPayment(new Types.ObjectId().toString(), admin),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('kiểm tra phân trang, trạng thái đơn và độ dài lý do hủy', async () => {
    const query = plainToInstance(ListOrdersQueryDto, {
      status: 'CREATED',
      paymentStatus: 'PENDING',
      page: '2',
      limit: '50',
    });
    expect(await validate(query)).toHaveLength(0);
    expect(query).toMatchObject({ page: 2, limit: 50 });
    expect(
      await validate(
        plainToInstance(ListOrdersQueryDto, { status: 'COOKING' }),
      ),
    ).not.toHaveLength(0);
    expect(
      await validate(
        plainToInstance(CancelOrderDto, { reason: 'x'.repeat(501) }),
      ),
    ).toHaveLength(1);
  });
});
