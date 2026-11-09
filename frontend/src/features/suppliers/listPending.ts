import type { PendingList, PendingPart } from "../pending/registry";

// WHAT A SUPPLIER LIST CANNOT DO YET — on the supplier list and on Discover alike, which show the same figures and the
// same filters (`discover-shows-the-same-figures-and-filters`, `the-warehouse-filters-before-the-team`). See
// `features/pending` for the four kinds and why a badge's number is its position in this list.

/** One unwired part. The id is also its i18n key (`suppliers.pending.<id>`). */
export type SupplierListPendingId = "warehouse";

// Terjual and Siap themselves are REAL since 2026-11-07 (InventoryService.SupplierGoods, features/suppliers/goods.ts) —
// their two `sample` entries went, and so did the range pills' two `dropped` ones once the list narrowed by them on the
// server (`the-range-pills-are-a-fixed-set`), so the warehouse is ⚠1.
const PARTS: PendingPart<SupplierListPendingId>[] = [
  // THE WAREHOUSE (owner: *"di sini ada filter gudang dan di suppliers juga sama"*) — the suppliers whose restocks are
  // received at that warehouse; held on screen and thrown away: inventory knows where a supplier's goods were received
  // (SupplierGoods by warehouse), but supplier_service's list cannot be narrowed by it yet.
  { id: "warehouse", kind: "dropped" },
];

export const SUPPLIER_LIST_PENDING: PendingList<SupplierListPendingId> = { ns: "suppliers", parts: PARTS };
