export interface DiscountRule {
  voucherCode?: string;
  discountPercent?: number; // Phần trăm giảm giá, ví dụ 10%.
  flatDiscount?: number; // Số tiền giảm cố định, ví dụ 20.000 đồng.
  maxDiscountAmount?: number; // Mức giảm tối đa.
  minOrderAmount?: number; // Giá trị đơn tối thiểu để được áp dụng.
  dailySubsidyAmount?: number; // Trợ cấp bữa ăn hằng ngày của công ty.
}

export interface OrderItemPriceInfo {
  unitPrice: number;
  quantity: number;
  optionsPrice: number;
}

export interface CalculationResult {
  rawTotal: number;
  categoryDiscount: number;
  voucherDiscount: number;
  subsidyAmount: number;
  totalDiscount: number;
  finalAmount: number;
}

/**
 * Tính tổng tiền, giảm giá và trợ cấp cho đơn hàng.
 */
export class OrderDiscountCalculator {
  /**
   * Tính tiền gốc, giảm giá, trợ cấp và số tiền cuối cùng cần thanh toán.
   */
  static calculateFinalPrice(
    items: OrderItemPriceInfo[],
    rule?: DiscountRule,
  ): CalculationResult {
    const rawTotal = items.reduce((sum, item) => {
      return sum + (item.unitPrice + item.optionsPrice) * item.quantity;
    }, 0);

    let voucherDiscount = 0;
    let subsidyAmount = 0;

    if (rule) {
      const minAmount = rule.minOrderAmount || 0;
      if (rawTotal >= minAmount) {
        if (rule.flatDiscount && rule.flatDiscount > 0) {
          voucherDiscount += rule.flatDiscount;
        }
        if (rule.discountPercent && rule.discountPercent > 0) {
          const calculated = (rawTotal * rule.discountPercent) / 100;
          const capped = rule.maxDiscountAmount
            ? Math.min(calculated, rule.maxDiscountAmount)
            : calculated;
          voucherDiscount += capped;
        }
      }

      if (rule.dailySubsidyAmount && rule.dailySubsidyAmount > 0) {
        subsidyAmount = rule.dailySubsidyAmount;
      }
    }

    const totalDiscount = voucherDiscount + subsidyAmount;
    const finalAmount = Math.max(0, rawTotal - totalDiscount);

    return {
      rawTotal,
      categoryDiscount: 0,
      voucherDiscount,
      subsidyAmount,
      totalDiscount,
      finalAmount,
    };
  }
}
