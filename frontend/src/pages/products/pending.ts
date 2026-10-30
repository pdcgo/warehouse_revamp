import type { PendingList, PendingPart } from "../../features/pending/registry";

// WHAT THE PRODUCTS LIST CANNOT DO YET — see `features/pending` for the four kinds and why a badge's number is its
// position in this list.

/** One unwired part. The id is also its i18n key (`products.pending.<id>`). */
export type ProductsPendingId = "lockFilter" | "stockAgeFilter";

const PARTS: PendingPart<ProductsPendingId>[] = [
  // THE LOCK (owner: *"kasih filter lock dan umur stok unimplemented"*) — held in the URL and thrown away:
  // ProductListFilter has only `q` and `status`, and a paged list cannot be narrowed on screen without missing the
  // products on the other pages.
  { id: "lockFilter", kind: "dropped" },
  // THE STOCK'S AGE — the same, and further off: the age lives in inventory_service, so the catalogue's list would have
  // to ask inventory which products to return before it could page them.
  { id: "stockAgeFilter", kind: "dropped" },
];

export const PRODUCTS_LIST_PENDING: PendingList<ProductsPendingId> = { ns: "products", parts: PARTS };
