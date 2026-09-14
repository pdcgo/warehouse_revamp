import type { SettlementMetric } from "../../gen/warehouse/settlement/v1/settlement_pb";

// THE FOUR NUMBERS a settlement report shows, derived from the eight tracked movements
// (docs/business/settlement/context_decision.md#the-measure-is-sales-received-and-gap).
//
// ⚠ DERIVED HERE, NEVER ON THE WIRE. The server returns the additive basis — one column per type plus
// the position — and every headline is a sum of those. Putting `gap` on the wire as well would be a
// second definition of one number, free to drift from the first.
export interface SettlementMeasure {
  /** What buyers paid, LIVE — cancels already netted. `−(initial_total + initial_total_cancel)`. */
  sales: bigint;
  /** What the platform actually moved — every other type, named fees included. */
  received: bigint;
  /** `sales − received` — the part of the sale that never reached us. */
  gap: bigint;
  /** `gap ÷ sales`, in percent to two places. `null` with no sales to divide by. */
  takeRate: number | null;
  /**
   * The cumulative SHORTFALL at the window's end, as a positive number — the balance's negation.
   *
   * ⚠ HIDDEN COST, never "outstanding" or "owed" (#hidden-cost-is-left-in-the-balance): nobody is going
   * to collect it, and it is not a wallet (#the-position-is-the-shortfall-not-the-wallet).
   */
  hiddenCostToDate: bigint;
}

export const ZERO_MEASURE: SettlementMeasure = {
  sales: 0n,
  received: 0n,
  gap: 0n,
  takeRate: null,
  hiddenCostToDate: 0n,
};

export function measureOf(metric: SettlementMetric | undefined): SettlementMeasure {
  if (!metric) return ZERO_MEASURE;

  // POSITIVE IS MONEY TOWARD US on the wire, so the sale arrives negative and is flipped once, here.
  const sales = -(metric.initialTotal + metric.initialTotalCancel);

  const received =
    metric.fund +
    metric.externalAdsFee +
    metric.affiliateFee +
    metric.marketplaceAdjustment +
    metric.other +
    metric.systemAdjustment;

  const gap = sales - received;

  return {
    sales,
    received,
    gap,
    // Basis points first, so a rate under 1% does not collapse to "0%".
    takeRate: sales > 0n ? Number((gap * 10_000n) / sales) / 100 : null,
    hiddenCostToDate: -metric.closeBalance,
  };
}
