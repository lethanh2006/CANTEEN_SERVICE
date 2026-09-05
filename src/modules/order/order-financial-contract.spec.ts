import { BadRequestException, ConflictException } from '@nestjs/common';
import { validateSync } from 'class-validator';
import { Types } from 'mongoose';
import { CreateMenuItemDto } from '../menu/dto/create-menu-item.dto';
import { CreateOrderDto, CreateOrderItemDto } from './dto/create-order.dto';
import { OrderService } from './order.service';

describe('Hợp đồng tiền và số lượng của đơn hàng', () => {
  const createActiveCategoryModel = () => ({
    exists: jest.fn(() => ({
      exec: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }),
    })),
  });

  it('từ chối giá VND và số lượng món dạng thập phân', () => {
    const menuItem = Object.assign(new CreateMenuItemDto(), {
      categoryId: new Types.ObjectId().toString(),
      name: 'Món thử',
      price: 12_500.5,
    });
    const orderItem = Object.assign(new CreateOrderItemDto(), {
      menuItemId: new Types.ObjectId().toString(),
      quantity: 1.5,
    });

    expect(validateSync(menuItem)).not.toHaveLength(0);
    expect(validateSync(orderItem)).not.toHaveLength(0);
  });

  it('từ chối VIETQR cho đơn hàng 0 đồng', async () => {
    const menuItem = {
      _id: new Types.ObjectId(),
      categoryId: new Types.ObjectId(),
      name: 'Món miễn phí',
      price: 0,
      isAvailable: true,
      options: [],
    };
    const menuItemModel = {
      findById: jest.fn(() => ({
        exec: jest.fn().mockResolvedValue(menuItem),
      })),
    };
    const service = new OrderService(
      {} as never,
      menuItemModel as never,
      createActiveCategoryModel() as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const dto = Object.assign(new CreateOrderDto(), {
      items: [
        Object.assign(new CreateOrderItemDto(), {
          menuItemId: menuItem._id.toString(),
          quantity: 1,
        }),
      ],
      paymentMethod: 'VIETQR',
    });

    await expect(
      service.createOrder(dto, { _id: new Types.ObjectId().toString() }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('từ chối tổng tiền vượt miền số nguyên an toàn', async () => {
    const menuItem = {
      _id: new Types.ObjectId(),
      categoryId: new Types.ObjectId(),
      name: 'Món giá lớn',
      price: Number.MAX_SAFE_INTEGER,
      isAvailable: true,
      options: [],
    };
    const menuItemModel = {
      findById: jest.fn(() => ({
        exec: jest.fn().mockResolvedValue(menuItem),
      })),
    };
    const service = new OrderService(
      {} as never,
      menuItemModel as never,
      createActiveCategoryModel() as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const dto = Object.assign(new CreateOrderDto(), {
      items: [
        Object.assign(new CreateOrderItemDto(), {
          menuItemId: menuItem._id.toString(),
          quantity: 2,
        }),
      ],
      paymentMethod: 'CASH',
    });

    await expect(
      service.createOrder(dto, { _id: new Types.ObjectId().toString() }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
