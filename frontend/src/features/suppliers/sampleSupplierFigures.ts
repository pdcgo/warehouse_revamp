// ⚠ SAMPLE — INVENTED FIGURES, for Terjual and Siap wherever a supplier's goods are counted: a supplier on the supplier
// list and on Discover, and a store and a product on the supplier's page (`the-detail-tabs-show-sold-and-ready`). Each
// page marks them `sample`. The real figures would be summed over the products — every unit sold and its last order,
// every unit ready and its last restock — once something says which products came from which store; nothing computes
// them yet. Deleted the day it does.

export interface SampleSupplierFigures {
  /** Every unit sold — all time. */
  sold: number;
  /** The last order, unix seconds. */
  lastOrderAt: bigint;
  /** Units ready on a shelf. */
  ready: number;
  /**
   * The last accepted restock, unix seconds. Absent where the row already says it — a product's row carries its
   * *Terakhir dibeli*, which is that date.
   */
  lastRestockAt?: bigint;
}

/** What the figures are invented from — a managed supplier and a discovered one both carry it. */
export interface FiguredSupplier {
  id: bigint;
  channels: readonly unknown[];
}

const DAY = 86_400n;
// A fixed day, so every render — and every story — draws the same dates.
const LATEST = BigInt(Date.UTC(2026, 9, 8) / 1000);

// How big each grain's numbers run: a supplier sums its stores, a store sums its products.
const SCALE = {
  supplier: { sold: [120, 4800], ready: [20, 860] },
  store: { sold: [40, 2400], ready: [5, 420] },
  product: { sold: [3, 600], ready: [0, 120] },
} as const;

function invent(seed: bigint, grain: keyof typeof SCALE): SampleSupplierFigures {
  const n = Number(seed % 997n);
  const { sold, ready } = SCALE[grain];
  return {
    sold: sold[0] + ((n * 389) % sold[1]),
    lastOrderAt: LATEST - BigInt(n % 6) * DAY,
    ready: ready[0] + ((n * 53) % ready[1]),
    lastRestockAt: LATEST - BigInt(3 + ((n * 7) % 40)) * DAY,
  };
}

/**
 * The same figures every render for the same supplier. `null` for a supplier with no store — it has no product to
 * have sold or to hold.
 */
export function sampleFiguresFor(supplier: FiguredSupplier): SampleSupplierFigures | null {
  if (supplier.channels.length === 0) return null;
  return invent(supplier.id, "supplier");
}

/** One of the supplier's stores — what was bought there. */
export function sampleStoreFigures(storeId: bigint): SampleSupplierFigures {
  return invent(storeId * 31n + 7n, "store");
}

/** One product bought at one store, by one team — its row on the Produk tab. No restock date: the row has it. */
export function sampleProductFigures(storeId: bigint, productId: bigint): SampleSupplierFigures {
  const { lastRestockAt: _, ...figures } = invent(storeId * 13n + productId * 101n, "product");
  return figures;
}

/** A count of units, written the way the app writes numbers — 1.240, not 1,240. */
export const units = (n: number) => n.toLocaleString("id-ID");
