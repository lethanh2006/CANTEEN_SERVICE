import { PATH_METADATA } from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { OrderController } from './order.controller';
import { CreateOrderDto } from './dto/create-order.dto';

describe('Hợp đồng API đặt món tiền mặt', () => {
  it('giữ API đơn cơ bản và chỉ một thao tác thu tiền', () => {
    const prototype = OrderController.prototype;
    const paths = Object.getOwnPropertyNames(prototype)
      .filter((name) => name !== 'constructor')
      .map(
        (name) =>
          Reflect.getMetadata(
            PATH_METADATA,
            Object.getOwnPropertyDescriptor(prototype, name)?.value as object,
          ) as string,
      );
    expect(paths).toEqual(
      expect.arrayContaining([
        '/',
        'my-orders',
        ':id',
        ':id/cancel',
        ':id/payment/cash',
      ]),
    );
    expect(paths).not.toContain(':id/confirm');
    expect(paths).not.toContain(':id/complete');
  });

  it('bắt buộc bàn, giỏ không rỗng và CASH giống Gateway', async () => {
    const payload = {
      tableId: '507f1f77bcf86cd799439011',
      items: [{ menuItemId: '507f1f77bcf86cd799439012', quantity: 1 }],
      paymentMethod: 'CASH',
    };
    expect(
      await validate(plainToInstance(CreateOrderDto, payload)),
    ).toHaveLength(0);
    for (const changes of [
      { tableId: undefined },
      { items: [] },
      { paymentMethod: 'VIETQR' },
    ]) {
      expect(
        await validate(
          plainToInstance(CreateOrderDto, { ...payload, ...changes }),
        ),
      ).not.toHaveLength(0);
    }
  });
});
