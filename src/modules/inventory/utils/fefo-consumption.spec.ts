import { calculateFefoConsumption } from './fefo-consumption';

describe('calculateFefoConsumption', () => {
  it('deducts batches in the order supplied without mutating them', () => {
    const batches = [
      {
        batchId: 'expires-first',
        expiryDate: new Date('2026-08-18'),
        quantity: 3,
      },
      {
        batchId: 'expires-later',
        expiryDate: new Date('2026-08-20'),
        quantity: 5,
      },
    ];

    const report = calculateFefoConsumption('ingredient-1', 6, batches, 2);

    expect(report).toMatchObject({
      totalConsumed: 6,
      isFullyFulfilled: true,
      remainingTotalStock: 2,
      isLowStockAlert: true,
      affectedBatches: [
        {
          batchId: 'expires-first',
          consumedQuantity: 3,
          remainingBatchQuantity: 0,
          status: 'DEPLETED',
        },
        {
          batchId: 'expires-later',
          consumedQuantity: 3,
          remainingBatchQuantity: 2,
          status: 'ACTIVE',
        },
      ],
    });
    expect(batches.map((batch) => batch.quantity)).toEqual([3, 5]);
  });

  it('reports insufficient stock without inventing a negative remainder', () => {
    const report = calculateFefoConsumption(
      'ingredient-1',
      5,
      [
        {
          batchId: 'only-batch',
          expiryDate: new Date('2026-08-18'),
          quantity: 2,
        },
      ],
      1,
    );

    expect(report.totalConsumed).toBe(2);
    expect(report.isFullyFulfilled).toBe(false);
    expect(report.remainingTotalStock).toBe(0);
  });
});
