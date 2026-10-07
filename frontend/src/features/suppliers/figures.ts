import type { SupplierMetric } from "../../gen/warehouse/supplier/v1/supplier_analytic_pb";

// A SUPPLIER'S SIX FIGURES, as the screens read them (each-figure-is-read-at-the-accept) — what was restocked from it,
// and how much of that was lost or broken on the way, each as units and as value at the line's price.

export interface SupplierFigures {
  /** Units accepted as good stock. */
  restockCount: number;
  restockValue: bigint;
  /** Units short in an accepted parcel. */
  lostCount: number;
  lostValue: bigint;
  /** Units that arrived broken. */
  brokenCount: number;
  brokenValue: bigint;
}

export const NO_FIGURES: SupplierFigures = {
  restockCount: 0,
  restockValue: 0n,
  lostCount: 0,
  lostValue: 0n,
  brokenCount: 0,
  brokenValue: 0n,
};

/** One wire metric as the screens read it. A missing metric is all zero. */
export function figuresOf(metric: SupplierMetric | undefined): SupplierFigures {
  if (!metric) return NO_FIGURES;

  return {
    restockCount: Number(metric.restockCount),
    restockValue: metric.restockValuation,
    lostCount: Number(metric.shippingLostCount),
    lostValue: metric.shippingLostValuation,
    brokenCount: Number(metric.shippingBrokenCount),
    brokenValue: metric.shippingBrokenValuation,
  };
}

/** All six are movements, so every rollup is a plain sum. */
export function addFigures(a: SupplierFigures, b: SupplierFigures): SupplierFigures {
  return {
    restockCount: a.restockCount + b.restockCount,
    restockValue: a.restockValue + b.restockValue,
    lostCount: a.lostCount + b.lostCount,
    lostValue: a.lostValue + b.lostValue,
    brokenCount: a.brokenCount + b.brokenCount,
    brokenValue: a.brokenValue + b.brokenValue,
  };
}

/** Every unit that came off the supplier — good, short and broken. Lost and broken sit BESIDE restock, not in it. */
export function unitsReceived(f: SupplierFigures): number {
  return f.restockCount + f.lostCount + f.brokenCount;
}

/**
 * Broken ÷ (restock + lost + broken), as a percentage with one decimal. `null` when nothing arrived: a supplier with
 * no restock in the window has no rate, which is not a rate of 0.
 */
export function brokenRate(f: SupplierFigures): number | null {
  const all = unitsReceived(f);
  if (all === 0) return null;

  return Math.round((f.brokenCount / all) * 1000) / 10;
}

/** Lost ÷ (restock + lost + broken), the same way. */
export function lostRate(f: SupplierFigures): number | null {
  const all = unitsReceived(f);
  if (all === 0) return null;

  return Math.round((f.lostCount / all) * 1000) / 10;
}
