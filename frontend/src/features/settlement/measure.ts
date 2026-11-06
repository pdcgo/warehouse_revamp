import type { SettlementMetric } from "../../gen/warehouse/settlement/v1/settlement_analytic_pb";

// Every money figure is a double since settlement 00010 — sums of the exact posted rows (the-backend-never-rounds-money),
// equal to the log within the tolerance.
//
// THE NUMBERS a settlement report shows (docs/business/settlement/context_decision.md#the-measure-is-sales-received-and-gap),
// withdrawals included since #the-report-headline-is-position-to-date.
//
// ⚠ SERVED, NEVER DERIVED HERE (settlement-serves-its-headline-and-its-breakdown). settlement_service works out every
// one of them from its folded tables, and the Analytic screen reads the same fields — so the Settlement Report and the
// Analytic screen have one definition. This file only turns the wire into the screen's shape.
export interface SettlementMeasure {
  /** What buyers paid, LIVE — cancels already netted. */
  sales: number;
  /** What the platform moved TOWARD US — every type but the sale and withdrawals, named fees included. */
  received: number;
  /**
   * What left the marketplace wallet for our bank in the window, as a positive number.
   *
   * ⚠ NOT part of `received`: it is our own money moving on. But it IS in the position
   * (#withdrawal-counts-in-the-position), which is why the position is no longer the hidden cost.
   */
  withdrawn: number;
  /** `sales − received` — the part of the sale that never reached us. */
  gap: number;
  /** `gap ÷ sales`, in percent to two places. `null` with no sales to divide by — the service leaves it unset. */
  takeRate: number | null;
  /**
   * THE POSITION at the window's end, as a positive number: what buyers paid, less everything the platform moved,
   * withdrawals included (#the-report-headline-is-position-to-date).
   *
   * ⚠ No longer "hidden cost": withdrawals count in it (#withdrawal-counts-in-the-position), so it is the
   * gap PLUS what was withdrawn. And never "outstanding" or "owed" — nobody is going to collect it.
   */
  positionToDate: number;
}

export const ZERO_MEASURE: SettlementMeasure = {
  sales: 0,
  received: 0,
  withdrawn: 0,
  gap: 0,
  takeRate: null,
  positionToDate: 0,
};

export function measureOf(metric: SettlementMetric | undefined): SettlementMeasure {
  if (!metric) return ZERO_MEASURE;

  return {
    sales: metric.sales,
    received: metric.received,
    withdrawn: metric.withdrawn,
    gap: metric.gap,
    // A ratio on the wire; basis points rounded, so a rate under 1% does not collapse to "0%".
    takeRate: metric.takeRate === undefined ? null : Math.round(metric.takeRate * 10_000) / 100,
    positionToDate: metric.positionToDate,
  };
}
