import type { PendingList, PendingPart } from "../../features/pending/registry";

// WHAT A PRODUCT'S PAGE CANNOT SHOW YET — in ONE list, as the order screens carry theirs. Each is a section the owner
// asked for (*"yang kurang adalah riwayat keluar masuk harian, suppliers list dan produk turunan (retur), kasih
// unimplemented"*) whose content nothing reads yet. The list shrinks by one entry each time something behind it lands.

/** One unwired part of the page. The id is also its i18n key (`products.detail.pending.<id>`). */
export type PendingId = "suppliers" | "derived" | "daily";

const PARTS: PendingPart<PendingId>[] = [
  // ⚠ THE SUPPLIERS ARE ON THE BATCHES, ONE PAGE AT A TIME. Every batch names the supplier it came from
  // (`StockBatch.supplier_id`), but the batch list is paged — a list of every supplier of this product needs the
  // server to group them, with how much and when each last delivered. The rows on screen are SAMPLES
  // (features/products/supplierSample.ts): real suppliers and stores, the link to this product and the figures invented.
  { id: "suppliers", kind: "sample" },
  // ⚠ THE LINK A RETURN TO ANOTHER TEAM MAKES (owner: *"barang yang retur ke team beda team"*) has no field yet, and which
  // way the business reads it is still open (*"bisa jadi yang sekarang itu juga turunan"*). The rows on screen are
  // SAMPLES (features/products/derivedSample.ts), shown both ways — what this came from, and what other teams made of it.
  { id: "derived", kind: "sample" },
  // ⚠ THE MOVEMENTS ARE THERE, THE DAYS ARE NOT. Riwayat Stok lists every movement; nothing sums them per day — in,
  // out and the closing balance — which is the read for "how fast does this go". The rows on screen are SAMPLES.
  { id: "daily", kind: "sample" },
];

/** What the badges and the summary on this page read. `ns` is where its copy lives. */
export const PRODUCT_DETAIL_PENDING: PendingList<PendingId> = { ns: "products.detail", parts: PARTS };
