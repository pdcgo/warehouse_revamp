import type { SupplierFigureValues } from "./figureValues";

// ⚠ SAMPLE — INVENTED FIGURES, for Terjual and Siap of a PRODUCT on the supplier's Produk tab
// (`the-detail-tabs-show-sold-and-ready`), whose rows are invented too — a product is linked to a store when a restock
// bought there is accepted (restock-accepted-links-the-product-to-its-channel), and that link is not built. Each page
// marks them `sample`. A supplier's and a store's figures are real (goods.ts). Deleted the day the link exists.

const DAY = 86_400n;
// A fixed day, so every render — and every story — draws the same dates.
const LATEST = BigInt(Date.UTC(2026, 9, 8) / 1000);

/** One product bought at one store, by one team — its row on the Produk tab. No restock date: the row has it. */
export function sampleProductFigures(storeId: bigint, productId: bigint): SupplierFigureValues {
  const n = Number((storeId * 13n + productId * 101n) % 997n);
  return {
    sold: 3 + ((n * 389) % 600),
    lastOrderAt: LATEST - BigInt(n % 6) * DAY,
    ready: (n * 53) % 120,
  };
}
