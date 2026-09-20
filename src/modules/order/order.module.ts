import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { Order, OrderSchema } from '../../schemas/orders.schema';
import { MenuItem, MenuItemSchema } from '../../schemas/menu_items.schema';
import { OrderController } from './order.controller';
import { OrderService } from './order.service';
import { Table, TableSchema } from '../../schemas/tables.schema';
import { OrderSettlementService } from './order-settlement.service';
import {
  OrderCounter,
  OrderCounterSchema,
} from '../../schemas/order-counter.schema';
import { Category, CategorySchema } from '../../schemas/categories.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Order.name, schema: OrderSchema },
      { name: MenuItem.name, schema: MenuItemSchema },
      { name: Category.name, schema: CategorySchema },
      { name: Table.name, schema: TableSchema },
      { name: OrderCounter.name, schema: OrderCounterSchema },
    ]),
  ],
  controllers: [OrderController],
  providers: [OrderService, OrderSettlementService],
  exports: [OrderService],
})
export class OrderModule {}
