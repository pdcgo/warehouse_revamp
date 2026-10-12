import type { PendingList, PendingPart } from "../../features/pending/registry";

// WHAT THE WAREHOUSE'S ORDER LIST CANNOT SHOW YET (`the-warehouse-row-is-the-old-systems-columns`).
//
// The owner's columns, against what an `Order` in a list result carries to a WAREHOUSE reader. Six
// facts are invented so the row can be judged; each is marked on the cell it fills.

/** One unwired part of the screen. The id is also its i18n key (`warehouseOrders.pending.<id>`). */
export type PendingId =
  | "statusSet"
  | "shop"
  | "receiptCode"
  | "quantity"
  | "mpDate"
  | "deadline"
  | "teamFilter"
  | "marketplaceFilter"
  | "courierFilter"
  | "shipmentStatus"
  | "stepMove"
  | "resiLookup"
  | "bulkHandover"
  | "barcode"
  | "printMerge"
  | "exportFile";

const PARTS: PendingPart<PendingId>[] = [
  // The tabs are the steps of `processed` (`the-warehouse-tabs-are-the-processed-steps`), and the last
  // one — handed over — has no status in the contract yet, so its tab is disabled.
  { id: "statusSet", kind: "missing" },
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
  // …and the shipment's state lives on a shipment record that does not exist yet.
  { id: "shipmentStatus", kind: "dropped" },
  // THE WORKBENCH (`a-warehouse-step-moves-by-the-old-systems-table`, `scanning-is-the-crews-hands`).
  // A skip, a move back or a move into "Sudah diambil" has no RPC — pressing it does nothing but say so.
  { id: "stepMove", kind: "dropped" },
  // No RPC finds an order by its tracking number: the handover scan looks in the orders the screen loaded.
  { id: "resiLookup", kind: "derived" },
  // …and hands them over one call per parcel — there is no bulk handover RPC.
  { id: "bulkHandover", kind: "derived" },
  // Products have no barcode: the validation scan matches the SKU.
  { id: "barcode", kind: "derived" },
  // Several receipts printed as ONE document — nothing merges them.
  { id: "printMerge", kind: "missing" },
  // No export RPC.
  { id: "exportFile", kind: "missing" },
];

export const WAREHOUSE_ORDERS_PENDING: PendingList<PendingId> = { ns: "warehouseOrders", parts: PARTS };
