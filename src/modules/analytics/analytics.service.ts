import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Order, OrderDocument } from '../../schemas/orders.schema';
import { MenuItem, MenuItemDocument } from '../../schemas/menu_items.schema';
import { TopKActiveHeap, DishSalesNode } from './utils/top_k_heap';

@Injectable()
export class AnalyticsService {
  constructor(
    @InjectModel(Order.name) private readonly orderModel: Model<OrderDocument>,
    @InjectModel(MenuItem.name) private readonly menuItemModel: Model<MenuItemDocument>,
  ) {}

  /**
   * GET /api/canteen/analytics/top-dishes
   * Trả về Top K món ăn bán chạy nhất (sử dụng Top-K Min Heap)
   */
  async getTopDishes(limit: number = 10): Promise<DishSalesNode[]> {
    const k = limit && Number(limit) > 0 ? Number(limit) : 10;

    // Retrieve non-cancelled orders
    const orders = await this.orderModel
      .find({ status: { $ne: 'CANCELLED' } })
      .exec();

    // Aggregate sales count and revenue per menuItemId
    const salesMap = new Map<string, { menuItemId: string; name: string; salesCount: number; totalRevenue: number }>();

    for (const order of orders) {
      if (!order.items || order.items.length === 0) continue;

      for (const item of order.items) {
        const itemId = item.menuItemId ? item.menuItemId.toString() : item.name;
        const current = salesMap.get(itemId) || {
          menuItemId: itemId,
          name: item.name,
          salesCount: 0,
          totalRevenue: 0,
        };

        const itemQty = item.quantity || 1;
        const itemPrice = item.unitPrice || 0;
        current.salesCount += itemQty;
        current.totalRevenue += itemPrice * itemQty;

        salesMap.set(itemId, current);
      }
    }

    // Build Top-K Min Heap
    const topKHeap = new TopKActiveHeap(k);

    for (const dishStats of salesMap.values()) {
      topKHeap.add({
        menuItemId: dishStats.menuItemId,
        name: dishStats.name,
        salesCount: dishStats.salesCount,
        totalRevenue: dishStats.totalRevenue,
      });
    }

    return topKHeap.getTopK();
  }
}
