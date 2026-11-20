// A CUSTOM SHIPMENT — a parcel the warehouse sends that is NOT a marketplace order (backlog #88).
//
// The owner's decisions (docs/business/custom_shipments/context_decision.md):
//   · a-custom-shipment-is-a-parcel-that-is-not-an-order — two kinds: a SAMPLE to someone (the parcel form of the
//     in-person sample, which stays as it is — Rack detail's Record Sample) and a RESTOCK RESHIP (a problem restock's
//     goods back to its supplier);
//   · the-selling-team-asks-the-warehouse-ships — the owning selling team creates it in the app; the warehouse picks,
//     packs and hands it to the courier, as with an order;
//   · the-courier-is-paid-by-the-team-or-by-the-warehouse — TEAM (*Kami bayar*): its account + its cost, editable until
//     the handover, an expense as a transfer's shipping; WAREHOUSE (*Gudang bayar*): the warehouse types the real cost at
//     the handover, 0 allowed, owed back through Team Balance. The team picks the way when it creates it (🔄 A);
//   · the-custom-shipments-prototype-is-accepted — the five screens as drawn; custom-shipments-sit-in-inventories-after-
//     transfer — the menu line; a-custom-shipment-is-cancelled-only-while-requested — the cancel.
// And the rules they lean on: a sample is a stock-out at batch value, keeping its recipient
// (a-sample-is-a-stock-out-at-batch-value, a-sample-keeps-its-recipient); a restock's broken units are just broken —
// never on a rack (a-restocks-broken-units-are-just-broken-for-now), so a reship sends them and takes NOTHING from rack
// stock; a restock's problem is a system tag, *Barang rusak* for broken units (a-restock-problem-is-a-system-tag); the
// courier is a shipment channel (a-transfer-names-its-courier-and-cost); tracking is deferred (tracking-is-deferred).
//
// THE API is inventory_service's `CustomShipmentService` (proto/warehouse/inventory/v1/custom_shipment.proto;
// docs/services/inventory_service/rpc.md *Custom shipments*), read through `queries.ts` and turned into the types below
// by `adapt.ts`. What the screens lean on from it:
//   · Create / Detail / the moves answer `{ custom_shipment }`; List answers `custom_shipments` + `page_info`, paged
//     (CommonPagination), newest first, rows without their trail.
//   · A WAREHOUSE reader receives no seller money: `total`, each line's `total`, `finance_account_id` and a TEAM payer's
//     `shipping_cost` arrive UNSET (a-warehouse-sees-no-seller-money) — so they are optional here, and a screen draws only
//     what came. A cost edit's trail row reaches it with its description empty: it reads THAT the cost was edited.
//   · A sample's racks are not on the parcel: the warehouse's pick page asks StockPickLocations(warehouse_id,
//     transaction_id) for the take the create made (the order pick page's read).
//   · A reship's choices (ReshipOptions) carry the line's supplier and store as ids; the form resolves the names and the
//     recipient's prefill through supplier_service's SupplierByIds / SupplierChannelByIds.
//   · Create takes no supplier, code, name or broken note — the server takes them from the product and the restock line.
//   · *Barang Tidak Ketemu* (backlog #88 P6, missing-goods-leave-a-note-on-the-custom-shipment): the warehouse's
//     CustomShipmentMissingReport writes one trail row of kind GOODS_MISSING (its lines in `missing`, its note the
//     description) and nothing else — the parcel stays REQUESTED. The OPEN note (the latest while REQUESTED) is the
//     parcel's `goods_missing`, on list rows too — the badge on both lists (the-goods-missing-badge-is-on-both-lists).
//     A reship's units a note named are not offered again once that reship is cancelled — ReshipLine's `not_found`
//     (missing-reship-units-are-not-offered-again).

export type CustomShipmentKind = "SAMPLE" | "RESTOCK_RESHIP";
export type CustomShipmentStatus = "REQUESTED" | "PICKED" | "HANDED_OVER" | "CANCELLED";
export type CustomShipmentPayer = "TEAM" | "WAREHOUSE";

export interface CustomShipmentRecipient {
  name: string;
  phone: string;
  address: string;
}

export interface CustomShipmentItem {
  id: bigint;
  productId: bigint;
  productCode: string;
  name: string;
  quantity: bigint;
  /** A sample line's value at the batches it took; 0 on a reship; UNSET for a warehouse reader. */
  total?: number;
  /** A reship's restock line; 0 on a sample. */
  restockItemId: bigint;
  /** A reship line's broken note, as the warehouse wrote it at Terima. */
  brokenNote: string;
}

/** Where a sample's units were taken from — one row per rack per product, as StockPickLocations answers. */
export interface CustomShipmentPick {
  productId: bigint;
  rackId: bigint;
  rackCode: string;
  quantity: bigint;
}

/** `NONE` is the create's from. A row whose from equals its to is an edit (the cost) or a goods-missing note — its `kind` says which. */
export type CustomShipmentLogStatus = CustomShipmentStatus | "NONE";

/** What a trail row is: the create or a status step, a cost edit, or the warehouse's goods-missing note. */
export type CustomShipmentLogKind = "STATUS" | "COST_EDIT" | "GOODS_MISSING";

/** One missing line — a sample's line on one rack its take drew from, or a reship's line (no rack). */
export interface GoodsMissingLine {
  itemId: bigint;
  productId: bigint;
  productCode: string;
  name: string;
  /** The rack the take drew it from; 0 — a reship's broken units (never on a rack), or a take that recorded none. */
  rackId: bigint;
  rackCode: string;
  quantity: bigint;
}

/** A *goods missing* note — its trail row's id, who wrote it and when, its lines and its optional note. */
export interface GoodsMissingNote {
  id: bigint;
  lines: GoodsMissingLine[];
  note: string;
  actorUserId: bigint;
  atUnix: bigint;
  isOverride: boolean;
}

export interface CustomShipmentLog {
  id: bigint;
  kind: CustomShipmentLogKind;
  fromStatus: CustomShipmentLogStatus;
  toStatus: CustomShipmentStatus;
  actorUserId: bigint;
  atUnix: bigint;
  isOverride: boolean;
  description: string;
  /** A GOODS_MISSING row's lines; empty on any other row. */
  missing: GoodsMissingLine[];
}

/** A goods-missing trail row read as the note it is. */
export const noteOfLog = (log: CustomShipmentLog): GoodsMissingNote => ({
  id: log.id,
  lines: log.missing,
  note: log.description,
  actorUserId: log.actorUserId,
  atUnix: log.atUnix,
  isOverride: log.isOverride,
});

export interface CustomShipment {
  id: bigint;
  teamId: bigint;
  warehouseId: bigint;
  kind: CustomShipmentKind;
  status: CustomShipmentStatus;
  restockId: bigint;
  supplierId: bigint;
  recipient: CustomShipmentRecipient;
  shipmentChannelId: bigint;
  payer: CustomShipmentPayer;
  /** TEAM payer only; 0 for a warehouse reader. */
  financeAccountId: bigint;
  /** TEAM payer: the team's cost — UNSET for a warehouse reader. WAREHOUSE payer: typed at the handover, 0 until then. */
  shippingCost?: number;
  resi: string;
  note: string;
  items: CustomShipmentItem[];
  /** A sample's stock take — its racks are StockPickLocations(warehouse, this); 0 on a reship. */
  transactionId: bigint;
  /** The sample's value; 0 on a reship; UNSET for a warehouse reader. */
  total?: number;
  /** The trail, oldest first — empty on a list row (the list carries none). */
  logs: CustomShipmentLog[];
  /** The OPEN goods-missing note — the latest while REQUESTED; absent once picked, handed over or cancelled. On list rows too. */
  goodsMissing?: GoodsMissingNote;
  createdByUserId: bigint;
  createdAtUnix: bigint;
}

/** A supplier as the reship's recipient can be prefilled from — supplier_service's three free-text facts. */
export interface ReshipSupplier {
  id: bigint;
  name: string;
  /** `Supplier.contact` — free text, ≤ 50: usually a phone, not always. */
  contact: string;
  /** `Supplier.address` — free text, ≤ 500, no region codes. */
  address: string;
}

/** One broken line of a problem restock — what a reship can send. */
export interface ReshipLine {
  restockItemId: bigint;
  productId: bigint;
  productCode: string;
  name: string;
  /** The line's broken units at Terima (its BROKEN problem row's count). */
  broken: bigint;
  /** Units of it a reship that is not cancelled already carries. */
  alreadySent: bigint;
  /** Units of it a goods-missing note named on a reship that was then cancelled — gone, never offered again. */
  notFound: bigint;
  brokenNote: string;
  /** The line's supplier — 0 when the line named none (a-line-may-name-a-supplier-without-a-channel). */
  supplierId: bigint;
  /** The line's store — 0 when it named none. Only a name and a link exist for a store, no address. */
  supplierChannelId: bigint;
  /** The line's supplier as supplier_service keeps it — resolved by the read; absent when the line named none. */
  supplier?: ReshipSupplier;
  /** The line's store's name, resolved by the read — "" when it named none. */
  storeName: string;
}

/** A Diterima restock carrying *Barang rusak* — the problem list the reship picks from. */
export interface ReshipOption {
  restockId: bigint;
  /** The restock's selling team — only its own problem restocks are offered. */
  teamId: bigint;
  warehouseId: bigint;
  acceptedAtUnix: bigint;
  lines: ReshipLine[];
}

/**
 * What a reship line may still send: the broken count less what a live reship of it carries and what a goods-missing
 * note named on a cancelled one (missing-reship-units-are-not-offered-again).
 */
export const reshipLeft = (line: Pick<ReshipLine, "broken" | "alreadySent" | "notFound">): bigint => {
  const held = line.alreadySent + line.notFound;
  return line.broken > held ? line.broken - held : 0n;
};

// THE STATUS TABS — the same on both lists, as the transfer lists' (a-page-picks-its-view-over-its-filters: the tabs over
// the strip). `all` first, then the steps in the order they happen, the ending last.
export const STATUS_TABS: { value: "all" | Lowercase<CustomShipmentStatus>; status?: CustomShipmentStatus; labelKey: string }[] = [
  { value: "all", labelKey: "customShipment.tab.all" },
  { value: "requested", status: "REQUESTED", labelKey: "customShipment.status.requested" },
  { value: "picked", status: "PICKED", labelKey: "customShipment.status.picked" },
  { value: "handed_over", status: "HANDED_OVER", labelKey: "customShipment.status.handedOver" },
  { value: "cancelled", status: "CANCELLED", labelKey: "customShipment.status.cancelled" },
];

export const statusTab = (value: string) => STATUS_TABS.find((tab) => tab.value === value) ?? STATUS_TABS[0]!;

export const KIND_KEYS: Record<CustomShipmentKind, string> = {
  SAMPLE: "customShipment.kind.sample",
  RESTOCK_RESHIP: "customShipment.kind.reship",
};

export const STATUS_KEYS: Record<CustomShipmentStatus, string> = {
  REQUESTED: "customShipment.status.requested",
  PICKED: "customShipment.status.picked",
  HANDED_OVER: "customShipment.status.handedOver",
  CANCELLED: "customShipment.status.cancelled",
};

// WHAT THE SELLING TEAM MAY DO, BY STATUS — the one matrix the list's ⋯ and the detail's header read (the transfer's
// SellingTransferActions shape):
//
//   requested → Ubah Ongkir (Kami bayar only) · Batalkan     nobody has touched the goods yet
//   picked    → Ubah Ongkir (Kami bayar only)                the goods are in the basket — no cancel from here on, as an
//                                                            order (no-cancel-after-the-warehouse-confirms) and a transfer
//                                                            (cancel-before-processed-lost-only-in-transit)
//   handed over · cancelled → nothing                        the cost is final at the handover
export type SellingAction = "editCost" | "cancel";

export function sellingActions(shipment: Pick<CustomShipment, "status" | "payer">): SellingAction[] {
  const actions: SellingAction[] = [];
  const open = shipment.status === "REQUESTED" || shipment.status === "PICKED";

  if (open && shipment.payer === "TEAM") actions.push("editCost");
  if (shipment.status === "REQUESTED") actions.push("cancel");

  return actions;
}

export const unitsOf = (shipment: Pick<CustomShipment, "items">): bigint =>
  shipment.items.reduce((sum, item) => sum + item.quantity, 0n);

// WHERE THE SCREENS LIVE — both sides share the paths, as the transfer's do (`/inventories/transfer`): the page drawn is
// chosen by the team type (router.tsx CustomShipmentRoute). The menu line sits in Inventories right after Transfer, on
// both sides (custom-shipments-sit-in-inventories-after-transfer, layouts/nav.ts).
export const CUSTOM_SHIPMENTS_PATH = "/inventories/custom-shipments";
export const customShipmentPath = (id: bigint) => `${CUSTOM_SHIPMENTS_PATH}/${id}`;
