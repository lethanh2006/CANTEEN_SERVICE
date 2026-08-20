import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Order, OrderDocument } from '../../schemas/orders.schema';
import { Table, TableDocument } from '../../schemas/tables.schema';

/**
 * Đối soát trạng thái bàn từ dữ liệu Order mới nhất trong MongoDB.
 *
 * Cả luồng hoàn tất đơn lẫn consumer thanh toán đều gọi hàm này sau khi ghi
 * trạng thái của mình. Vì vậy, khi hai cập nhật chạy đồng thời, lượt ghi hoàn
 * tất sau cùng luôn đọc được cặp trạng thái COMPLETED + PAID và giải phóng bàn.
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
    const settledOrder = await this.orderModel
      .findOne({
        _id: orderId,
        status: 'COMPLETED',
        paymentStatus: 'PAID',
        tableId: { $ne: null },
      })
      .exec();

    if (!settledOrder?.tableId) {
      return;
    }

    await this.tableModel
      .updateOne(
        { _id: settledOrder.tableId, status: { $ne: 'empty' } },
        { $set: { status: 'empty' } },
      )
      .exec();
  }
}
