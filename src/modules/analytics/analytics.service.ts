import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Order, OrderDocument } from '../../schemas/orders.schema';

export interface DishSalesSummary {
  menuItemId: string;
  name: string;
  salesCount: number;
  totalRevenue: number;
}

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectModel(Order.name) private readonly orderModel: Model<OrderDocument>,
  ) {}

  /**
   * GET /api/canteen/analytics/top-dishes
   * Trả về các món ăn bán chạy nhất, được tổng hợp ngay trong MongoDB.
   */
  async getTopDishes(limit: number = 10): Promise<DishSalesSummary[]> {
    const requestedLimit = Number(limit);
    const resultLimit =
      Number.isFinite(requestedLimit) && requestedLimit > 0
        ? Math.min(Math.floor(requestedLimit), 100)
        : 10;

    return await this.orderModel
      .aggregate<DishSalesSummary>([
        { $match: { status: { $ne: 'CANCELLED' } } },
        { $unwind: '$items' },
        {
          $group: {
            _id: '$items.menuItemId',
            name: { $last: '$items.name' },
            salesCount: {
              $sum: { $ifNull: ['$items.quantity', 1] },
            },
            totalRevenue: {
              $sum: {
                $multiply: [
                  { $ifNull: ['$items.unitPrice', 0] },
                  { $ifNull: ['$items.quantity', 1] },
                ],
              },
            },
          },
        },
        { $sort: { salesCount: -1, name: 1 } },
        { $limit: resultLimit },
        {
          $project: {
            _id: 0,
            menuItemId: { $toString: '$_id' },
            name: 1,
            salesCount: 1,
            totalRevenue: 1,
          },
        },
      ])
      .exec();
  }
}
