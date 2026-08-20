import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Order, OrderSchema } from '../../schemas/orders.schema';
import { MenuItem, MenuItemSchema } from '../../schemas/menu_items.schema';
import { OrderController } from './order.controller';
import { OrderService } from './order.service';
import { Table, TableSchema } from '../../schemas/tables.schema';
import { PaymentConsumer } from './consumers/payment.consumer';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Order.name, schema: OrderSchema },
      { name: MenuItem.name, schema: MenuItemSchema },
      { name: Table.name, schema: TableSchema },
    ]),
  ],
  controllers: [OrderController],
  providers: [OrderService, PaymentConsumer],
  exports: [OrderService],
})
export class OrderModule {}
