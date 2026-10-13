// ⚠ SAMPLE — INVENTED FIGURES, for a supplier's Terjual and Siap on the supplier list and on Discover, each marked
// `sample` (listPending.ts). A supplier's real figures would be summed over its products — every unit sold and its
// last order, every unit ready and its last restock — once something says which products are its; nothing computes
// them yet. Deleted the day it does.

export interface SampleSupplierFigures {
  /** Every unit sold, over the supplier's products — all time. */
  sold: number;
  /** The last order of any of its products, unix seconds. */
  lastOrderAt: bigint;
  /** Units ready on a shelf, over the supplier's products. */
  ready: number;
  /** The last accepted restock from the supplier, unix seconds. */
  lastRestockAt: bigint;
}

/** What the figures are invented from — a managed supplier and a discovered one both carry it. */
export interface FiguredSupplier {
  id: bigint;
  channels: readonly unknown[];
}

const DAY = 86_400n;
// A fixed day, so every render — and every story — draws the same dates.
const LATEST = BigInt(Date.UTC(2026, 9, 8) / 1000);

/**
 * The same figures every render for the same supplier. `null` for a supplier with no store — it has no product to
 * have sold or to hold.
 */
export function sampleFiguresFor(supplier: FiguredSupplier): SampleSupplierFigures | null {
  if (supplier.channels.length === 0) return null;

  const n = Number(supplier.id % 997n);
  return {
    sold: 120 + ((n * 389) % 4800),
    lastOrderAt: LATEST - BigInt(n % 6) * DAY,
    ready: 20 + ((n * 53) % 860),
    lastRestockAt: LATEST - BigInt(3 + ((n * 7) % 40)) * DAY,
  };
}

/** A count of units, written the way the app writes numbers — 1.240, not 1,240. */
export const units = (n: number) => n.toLocaleString("id-ID");
