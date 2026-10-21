import type { PendingList, PendingPart } from "../../features/pending/registry";

// WHAT THE WAREHOUSE'S ORDER LIST CANNOT SHOW YET (`the-warehouse-row-is-the-old-systems-columns`).
//
// The owner's columns, against what an `Order` in a list result carries to a WAREHOUSE reader. Six
// facts are invented so the row can be judged; each is marked on the cell it fills.

/** One unwired part of the screen. The id is also its i18n key (`warehouseOrders.pending.<id>`). */
export type PendingId =
  | "shop"
  | "receiptCode"
  | "quantity"
  | "mpDate"
  | "deadline"
  | "teamFilter"
  | "marketplaceFilter"
  | "courierFilter"
  | "resiLookup"
  | "barcode"
  | "printMerge"
  | "exportFile";

const PARTS: PendingPart<PendingId>[] = [
  // The order carries `shop_id` only, and `ShopList` is scoped to the SELLING team, so a warehouse
  // cannot name the seller's shop or its marketplace.
  { id: "shop", kind: "sample" },
  // `shipping_code` is the carrier; nothing holds the printed tracking number.
  { id: "receiptCode", kind: "sample" },
  // A list result carries no items, so the row cannot count units.
  { id: "quantity", kind: "sample" },
  // The order has one timestamp — when WE wrote it down — and none for when the buyer ordered.
  { id: "mpDate", kind: "sample" },
  // No order carries a ship-by deadline.
  { id: "deadline", kind: "sample" },
  // ⚠ FOUR FILTERS THAT REACH NOTHING — typed and thrown away. `OrderListFilter` has no seller team, no
  // marketplace, no courier and no shipment state (`the-warehouse-filters-by-team-marketplace-and-courier`).
  { id: "teamFilter", kind: "dropped" },
  { id: "marketplaceFilter", kind: "dropped" },
  { id: "courierFilter", kind: "dropped" },
  // No RPC finds an order by its tracking number: the handover scan looks in the orders the screen loaded.
  { id: "resiLookup", kind: "derived" },
  // Products have no barcode: the validation scan matches the SKU.
  { id: "barcode", kind: "derived" },
  // Several receipts printed as ONE document — nothing merges them.
  { id: "printMerge", kind: "missing" },
  // No export RPC.
  { id: "exportFile", kind: "missing" },
];

export const WAREHOUSE_ORDERS_PENDING: PendingList<PendingId> = { ns: "warehouseOrders", parts: PARTS };
