export interface DiscountRule {
  voucherCode?: string;
  discountPercent?: number;    // e.g. 10%
  flatDiscount?: number;       // e.g. 20000 VND
  maxDiscountAmount?: number;  // Capped max discount
  minOrderAmount?: number;     // Min order threshold to qualify
  dailySubsidyAmount?: number; // Company meal allowance subsidy
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
 * OrderDiscountCalculator
 * Optimized order total & discount calculation service
 */
export class OrderDiscountCalculator {
  /**
   * Calculate exact raw total, voucher discount, company daily subsidy, and final payable amount
   */
  static calculateFinalPrice(
    items: OrderItemPriceInfo[],
    rule?: DiscountRule
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
