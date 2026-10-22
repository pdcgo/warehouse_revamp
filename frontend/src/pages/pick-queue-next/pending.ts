import type { PendingList, PendingPart } from "../../features/pending/registry";

// WHAT THE WAREHOUSE'S ORDER LIST CANNOT SHOW YET (`the-warehouse-row-is-the-old-systems-columns`).
//
// The owner's columns, against what an `Order` in a list result carries to a WAREHOUSE reader. Three
// facts are invented so the row can be judged; each is marked on the cell it fills. The shop (ShopByIds), the unit
// count (item_quantity) and the three filters are real (the-warehouse-row-fills-from-shop-and-user-by-ids,
// the-filter-gains-seller-marketplace-and-courier).

/** One unwired part of the screen. The id is also its i18n key (`warehouseOrders.pending.<id>`). */
export type PendingId =
  | "receiptCode"
  | "mpDate"
  | "deadline"
  | "resiLookup"
  | "barcode"
  | "printMerge";

const PARTS: PendingPart<PendingId>[] = [
  // `shipping_code` is the carrier; nothing holds the printed tracking number.
  { id: "receiptCode", kind: "sample" },
  // The order has one timestamp — when WE wrote it down — and none for when the buyer ordered.
  { id: "mpDate", kind: "sample" },
  // No order carries a ship-by deadline.
  { id: "deadline", kind: "sample" },
  // No RPC finds an order by its tracking number: the handover scan looks in the orders the screen loaded.
  { id: "resiLookup", kind: "derived" },
  // Products have no barcode: the validation scan matches the SKU.
  { id: "barcode", kind: "derived" },
  // Several receipts printed as ONE document — nothing merges them.
  { id: "printMerge", kind: "missing" },
];

export const WAREHOUSE_ORDERS_PENDING: PendingList<PendingId> = { ns: "warehouseOrders", parts: PARTS };
