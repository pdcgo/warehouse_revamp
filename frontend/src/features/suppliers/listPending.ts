import type { PendingList, PendingPart } from "../pending/registry";

// WHAT A SUPPLIER LIST CANNOT DO YET — on the supplier list and on Discover alike, which show the same figures and the
// same filters (`discover-shows-the-same-figures-and-filters`, `the-warehouse-filters-before-the-team`). See
// `features/pending` for the four kinds and why a badge's number is its position in this list.

/** One unwired part. The id is also its i18n key (`suppliers.pending.<id>`). */
export type SupplierListPendingId = "sold" | "ready" | "soldRange" | "readyRange" | "warehouse";

const PARTS: PendingPart<SupplierListPendingId>[] = [
  // SAMPLE FIGURES (owner: *"tampilkan saja dulu, tulis unimplemented karena memang belum ada"*) — every unit sold, ALL
  // time, and the last order (*"tidak pakai api itu, semuanya saja"*): summed over the supplier's products, which
  // nothing yet names — the store-product link is not built, and nothing sums per supplier.
  { id: "sold", kind: "sample" },
  // …and its ready stock and its last restock, the same way.
  { id: "ready", kind: "sample" },
  // THE RANGE PILLS (owner: *"di sini kita akan ada filter untuk keduanya, tentu masih unimplemented"*) — a pick is held on
  // screen and thrown away: the list cannot be narrowed by a sum that does not exist, and where the bands come from is
  // open (figureRanges.ts).
  { id: "soldRange", kind: "dropped" },
  { id: "readyRange", kind: "dropped" },
  // THE WAREHOUSE (owner: *"di sini ada filter gudang dan di suppliers juga sama"*) — the suppliers whose restocks are
  // received at that warehouse; held on screen and thrown away, since nothing yet says where a supplier's goods are
  // received. Last in the list, so the numbers already on screen keep their meaning.
  { id: "warehouse", kind: "dropped" },
];

export const SUPPLIER_LIST_PENDING: PendingList<SupplierListPendingId> = { ns: "suppliers", parts: PARTS };
