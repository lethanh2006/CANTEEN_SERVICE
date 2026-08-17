import { InventoryMinHeap } from './min-heap';

export interface BatchConsumptionResult {
  batchId: string;
  expiryDate: Date;
  consumedQuantity: number;
  remainingBatchQuantity: number;
  status: 'ACTIVE' | 'DEPLETED';
}

export interface InventoryDeductionReport {
  ingredientId: string;
  requestedQuantity: number;
  totalConsumed: number;
  isFullyFulfilled: boolean;
  affectedBatches: BatchConsumptionResult[];
  remainingTotalStock: number;
  isLowStockAlert: boolean;
}

/**
 * Tính lượng nguyên liệu cần khấu trừ theo nguyên tắc hết hạn trước, xuất trước
 * (FEFO) bằng cấu trúc Min Heap.
 */
export class FEFOConsumptionService {
  /**
   * Khấu trừ nguyên liệu từ các lô đang hoạt động theo hạn sử dụng tăng dần.
   */
  static consumeIngredientBatches(
    ingredientId: string,
    requiredAmount: number,
    minHeap: InventoryMinHeap,
    minimumThreshold: number,
  ): InventoryDeductionReport {
    let remainingNeeded = requiredAmount;
    const affectedBatches: BatchConsumptionResult[] = [];

    const sortedBatches = minHeap.getSortedBatches();
    const totalStockBefore = sortedBatches.reduce(
      (acc, b) => acc + b.quantity,
      0,
    );

    for (const batch of sortedBatches) {
      if (remainingNeeded <= 0) break;

      const deductAmount = Math.min(batch.quantity, remainingNeeded);
      batch.quantity -= deductAmount;
      remainingNeeded -= deductAmount;

      const newStatus = batch.quantity === 0 ? 'DEPLETED' : 'ACTIVE';

      affectedBatches.push({
        batchId: batch.batchId,
        expiryDate: batch.expiryDate,
        consumedQuantity: deductAmount,
        remainingBatchQuantity: batch.quantity,
        status: newStatus,
      });
    }

    const totalConsumed = requiredAmount - remainingNeeded;
    const remainingTotalStock = Math.max(0, totalStockBefore - totalConsumed);

    return {
      ingredientId,
      requestedQuantity: requiredAmount,
      totalConsumed,
      isFullyFulfilled: remainingNeeded === 0,
      affectedBatches,
      remainingTotalStock,
      isLowStockAlert: remainingTotalStock <= minimumThreshold,
    };
  }
}
