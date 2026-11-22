import type { PendingList, PendingPart } from "../../features/pending/registry";

// WHAT A PRODUCT'S PAGE CANNOT SHOW YET — in ONE list, as the order screens carry theirs. Each is a section the owner
// asked for (*"yang kurang adalah riwayat keluar masuk harian, suppliers list dan produk turunan (retur), kasih
// unimplemented"*) whose content nothing reads yet. The list shrinks by one entry each time something behind it lands.

/** One unwired part of the page. The id is also its i18n key (`products.detail.pending.<id>`). */
export type PendingId = "derived";

const PARTS: PendingPart<PendingId>[] = [
  // (The suppliers' mark is gone — Pemasok is real since 2026-11-21: InventoryService.ProductSupplierGoods. So is the
  // daily one — Keluar Masuk Harian is real since 2026-11-21: InventoryService.ProductDailyMoves.)
  // ⚠ THE LINK A RETURN TO ANOTHER TEAM MAKES (owner: *"barang yang retur ke team beda team"*) has no field yet, and which
  // way the business reads it is still open (*"bisa jadi yang sekarang itu juga turunan"*). The rows on screen are
  // SAMPLES (features/products/derivedSample.ts), shown both ways — what this came from, and what other teams made of it.
  { id: "derived", kind: "sample" },
];

/** What the badges and the summary on this page read. `ns` is where its copy lives. */
export const PRODUCT_DETAIL_PENDING: PendingList<PendingId> = { ns: "products.detail", parts: PARTS };
