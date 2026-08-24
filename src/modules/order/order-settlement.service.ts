import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Order, OrderDocument } from '../../schemas/orders.schema';
import { Table, TableDocument } from '../../schemas/tables.schema';

/**
 * Đối soát trạng thái bàn từ dữ liệu Order mới nhất trong MongoDB.
 *
 * Cả luồng hoàn tất, hủy đơn lẫn consumer thanh toán đều gọi hàm này. Bàn chỉ
 * được giải phóng khi không còn đơn chưa tất toán nào cùng bàn.
 */
@Injectable()
export class OrderSettlementService {
  constructor(
    @InjectModel(Order.name)
    private readonly orderModel: Model<OrderDocument>,
    @InjectModel(Table.name)
    private readonly tableModel: Model<TableDocument>,
  ) {}

  async reconcileTableForOrder(
    orderId: string | Types.ObjectId,
  ): Promise<void> {
    const order = await this.orderModel
      .findById(orderId)
      .select({ tableId: 1 })
      .exec();

    if (!order?.tableId) {
      return;
    }

    const unsettledOrder = await this.orderModel
      .exists({
        tableId: order.tableId,
        $nor: [
          { status: 'CANCELLED' },
          {
            status: { $in: ['COMPLETED', 'PAID'] },
            paymentStatus: 'PAID',
          },
        ],
      })
      .exec();
    if (unsettledOrder) return;

    await this.tableModel
      .updateOne(
        { _id: order.tableId, status: { $ne: 'empty' } },
        { $set: { status: 'empty' } },
      )
      .exec();
  }
}
