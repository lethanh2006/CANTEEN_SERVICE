export interface ConsumableBatch {
  batchId: string;
  expiryDate: Date;
  quantity: number;
}

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
 * (FEFO). Danh sách đầu vào đã được MongoDB sắp theo hạn sử dụng.
 */
export function calculateFefoConsumption(
  ingredientId: string,
  requiredAmount: number,
  batchesByExpiry: ConsumableBatch[],
  minimumThreshold: number,
): InventoryDeductionReport {
  let remainingNeeded = requiredAmount;
  const affectedBatches: BatchConsumptionResult[] = [];

  const totalStockBefore = batchesByExpiry.reduce(
    (acc, batch) => acc + batch.quantity,
    0,
  );

  for (const batch of batchesByExpiry) {
    if (remainingNeeded <= 0) break;

    const deductAmount = Math.min(batch.quantity, remainingNeeded);
    const remainingBatchQuantity = batch.quantity - deductAmount;
    remainingNeeded -= deductAmount;

    const newStatus = remainingBatchQuantity === 0 ? 'DEPLETED' : 'ACTIVE';

    affectedBatches.push({
      batchId: batch.batchId,
      expiryDate: batch.expiryDate,
      consumedQuantity: deductAmount,
      remainingBatchQuantity,
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
