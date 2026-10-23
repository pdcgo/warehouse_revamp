import type { PendingList, PendingPart } from "../../features/pending/registry";

// WHAT THE WAREHOUSE'S ORDER LIST CANNOT SHOW YET (`the-warehouse-row-is-the-old-systems-columns`).
//
// The owner's columns, against what an `Order` in a list result carries to a WAREHOUSE reader. Every column is real
// now — the shop (ShopByIds), the unit count (item_quantity), the tracking number (receipt_code), the platform's order
// date and ship-by deadline, and the three filters. What is left is how the crew's scans and prints reach the server.

/** One unwired part of the screen. The id is also its i18n key (`warehouseOrders.pending.<id>`). */
export type PendingId = "resiLookup" | "barcode" | "printMerge";

const PARTS: PendingPart<PendingId>[] = [
  // The handover scan looks in the orders it loaded (the first 200), not on the server — OrderList's search
  // reaches the tracking number now, and the dialog does not ask it.
  { id: "resiLookup", kind: "derived" },
  // Products have no barcode: the validation scan matches the SKU.
  { id: "barcode", kind: "derived" },
  // Several receipts printed as ONE document — nothing merges them.
  { id: "printMerge", kind: "missing" },
];

export const WAREHOUSE_ORDERS_PENDING: PendingList<PendingId> = { ns: "warehouseOrders", parts: PARTS };
