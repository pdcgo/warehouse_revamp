import type { PendingList, PendingPart } from "../../features/pending/registry";

// WHAT THE CATEGORIES PAGE CANNOT DO YET — see `features/pending` for the four kinds and why a badge's number is its
// position in this list.

/** One unwired part. The id is also its i18n key (`catalog.categories.pending.<id>`). */
export type CategoriesPendingId = "productCount";

const PARTS: PendingPart<CategoriesPendingId>[] = [
  // HOW MANY PRODUCTS A CATEGORY HOLDS (owner: *"tambah jumlah produk dan kasih warning"*) — invented
  // (sampleProductCounts.ts): nothing counts the products filed under a node yet.
  { id: "productCount", kind: "sample" },
];

export const CATEGORIES_PENDING: PendingList<CategoriesPendingId> = { ns: "catalog.categories", parts: PARTS };
