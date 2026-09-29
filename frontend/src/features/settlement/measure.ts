import type { SettlementMetric } from "../../gen/warehouse/settlement/v1/settlement_pb";

// THE NUMBERS a settlement report shows, derived from the tracked movements
// (docs/business/settlement/context_decision.md#the-measure-is-sales-received-and-gap), withdrawals
// included since #the-report-headline-is-position-to-date.
//
// ⚠ DERIVED HERE, NEVER ON THE WIRE. The server returns the additive basis — one column per type plus
// the position — and every headline is a sum of those. Putting `gap` on the wire as well would be a
// second definition of one number, free to drift from the first.
export interface SettlementMeasure {
  /** What buyers paid, LIVE — cancels already netted. `−(initial_total + initial_total_cancel)`. */
  sales: bigint;
  /** What the platform moved TOWARD US — every type but the sale and withdrawals, named fees included. */
  received: bigint;
  /**
   * What left the marketplace wallet for our bank in the window, as a positive number.
   *
   * ⚠ NOT part of `received`: it is our own money moving on. But it IS in the position
   * (#withdrawal-counts-in-the-position), which is why the position is no longer the hidden cost.
   */
  withdrawn: bigint;
  /** `sales − received` — the part of the sale that never reached us. */
  gap: bigint;
  /** `gap ÷ sales`, in percent to two places. `null` with no sales to divide by. */
  takeRate: number | null;
  /**
   * THE POSITION at the window's end, as a positive number — the balance's negation: what buyers paid,
   * less everything the platform moved, withdrawals included (#the-report-headline-is-position-to-date).
   *
   * ⚠ No longer "hidden cost": withdrawals count in it (#withdrawal-counts-in-the-position), so it is the
   * gap PLUS what was withdrawn. And never "outstanding" or "owed" — nobody is going to collect it.
   */
  positionToDate: bigint;
}

export const ZERO_MEASURE: SettlementMeasure = {
  sales: 0n,
  received: 0n,
  withdrawn: 0n,
  gap: 0n,
  takeRate: null,
  positionToDate: 0n,
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
    metric.systemAdjustment +
    metric.shipmentAdjustment +
    metric.logisticReimbursement +
    metric.platformReimbursement +
    metric.marketplaceProgram;

  const gap = sales - received;

  return {
    sales,
    received,
    // A withdrawal is NEGATIVE on the wire — money leaving the wallet — and shown as what went out.
    withdrawn: -metric.withdrawal,
    gap,
    // Basis points first, so a rate under 1% does not collapse to "0%".
    takeRate: sales > 0n ? Number((gap * 10_000n) / sales) / 100 : null,
    positionToDate: -metric.closeBalance,
  };
}
