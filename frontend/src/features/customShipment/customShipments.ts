// A CUSTOM SHIPMENT — a parcel the warehouse sends that is NOT a marketplace order (backlog #88, PROTOTYPE).
//
// The owner's decisions (docs/business/custom_shipments/context_decision.md):
//   · a-custom-shipment-is-a-parcel-that-is-not-an-order — two kinds: a SAMPLE to someone (the parcel form of the
//     in-person sample, which stays as it is — Rack detail's Record Sample) and a RESTOCK RESHIP (a problem restock's
//     goods back to its supplier);
//   · the-selling-team-asks-the-warehouse-ships — the owning selling team creates it in the app; the warehouse picks,
//     packs and hands it to the courier, as with an order;
//   · the-courier-is-paid-by-the-team-or-by-the-warehouse — TEAM (*Kami bayar*): its account + its cost, editable until
//     the handover, an expense as a transfer's shipping; WAREHOUSE (*Gudang bayar*): the warehouse types the real cost at
//     the handover, 0 allowed, owed back through Team Balance. The team picks the way when it creates it (🔄 A).
// And the rules they lean on: a sample is a stock-out at batch value, keeping its recipient
// (a-sample-is-a-stock-out-at-batch-value, a-sample-keeps-its-recipient); a restock's broken units are just broken —
// never on a rack (a-restocks-broken-units-are-just-broken-for-now), so a reship sends them and takes NOTHING from rack
// stock; a restock's problem is a system tag, *Barang rusak* for broken units (a-restock-problem-is-a-system-tag); the
// courier is a shipment channel (a-transfer-names-its-courier-and-cost); tracking is deferred (tracking-is-deferred).
//
// ⚠ THE ASSUMED API — none of this is in the proto; customShipmentPrototype.tsx plays it in memory. Its home is the
// backend step's call — inventory_service, beside the warehouse transfer, takes a sample's stock and reads a restock's
// broken units, so it is assumed there (`proto/warehouse/inventory/v1/custom_shipment.proto`):
//
//   enum CustomShipmentKind   { …_UNSPECIFIED = 0; …_SAMPLE = 1; …_RESTOCK_RESHIP = 2; }
//   enum CustomShipmentStatus { …_UNSPECIFIED = 0; …_REQUESTED = 1; …_PICKED = 2; …_HANDED_OVER = 3; …_CANCELLED = 4; }
//   enum CustomShipmentPayer  { …_UNSPECIFIED = 0; …_TEAM = 1; …_WAREHOUSE = 2; }
//
//   message CustomShipment {
//     uint64 id; uint64 team_id;            // the owning selling team
//     uint64 warehouse_id;                  // where it ships from — a reship's is its restock's warehouse
//     CustomShipmentKind kind; CustomShipmentStatus status;
//     uint64 restock_id;                    // a reship's restock; 0 on a sample
//     uint64 supplier_id;                   // a reship's supplier (its lines'); 0 on a sample
//     CustomShipmentRecipient recipient;    // { string name; string phone; string address; } — free text, all three
//     uint64 shipment_channel_id;           // the courier, from the shipment catalogue
//     CustomShipmentPayer payer;
//     uint64 finance_account_id;            // TEAM only — the team's account; never sent to a warehouse reader
//     double shipping_cost;                 // TEAM: the team's (never sent to a warehouse reader); WAREHOUSE: typed at
//                                           // the handover, 0 until then
//     string resi;                          // the courier's receipt number, typed at the handover — optional
//     string note;                          // the team's, for the warehouse
//     repeated CustomShipmentItem items;    // { id; product_id; product_code; name; uint64 quantity;
//                                           //   double total;            // a sample's batch value — unset for a warehouse
//                                           //   uint64 restock_item_id;  // a reship's restock line
//                                           //   string broken_note; }    // the warehouse's Terima note on that line
//     uint64 transaction_id;                // a sample's stock take (its racks: StockPickLocations); 0 on a reship
//     double total;                         // the sample's value — unset for a warehouse reader
//     repeated CustomShipmentLog logs;      // { id; from_status; to_status; actor_user_id; at_unix; is_override;
//                                           //   string description; } — a cost edit is a row with from = to
//     uint64 created_by_user_id; int64 created_at_unix;
//   }
//
//   rpc CustomShipmentCreate   ({ team_id; kind; warehouse_id; restock_id; lines { product_id | restock_item_id;
//                                 quantity }; recipient; shipment_channel_id; payer; finance_account_id; shipping_cost;
//                                 note; idempotency_key })                     → CustomShipment
//       // a SAMPLE takes the stock AT CREATE, oldest batch first, the system picking the racks (as an order and a
//       // transfer out: a-sample-names-the-rack-it-was-taken-from's principle row); a RESHIP takes nothing — its units
//       // are a restock line's broken units, at most the broken count less what another live reship of it carries
//   rpc CustomShipmentList     ({ team_id; filter { status; kind; q; warehouse_id }; page })  → rows + total
//       // team_id a selling team: its own; a warehouse: the parcels it ships, money unset
//   rpc CustomShipmentDetail   ({ team_id; id })                               → CustomShipment
//   rpc CustomShipmentCostSet  ({ team_id; id; finance_account_id; shipping_cost })   // TEAM payer, until handed over
//   rpc CustomShipmentCancel   ({ team_id; id })     // the selling team, only while REQUESTED — the take is released
//   rpc CustomShipmentPicked   ({ team_id; id })     // the warehouse, REQUESTED → PICKED, after the item scans
//   rpc CustomShipmentHandover ({ team_id; id; optional double shipping_cost; string resi })
//       // the warehouse, PICKED → HANDED_OVER; shipping_cost REQUIRED when the payer is WAREHOUSE (0 allowed), refused
//       // when it is TEAM; it posts the team's debt through Team Balance
//   rpc CustomShipmentReshipOptions ({ team_id })    → the team's Diterima restocks carrying *Barang rusak*, each
//       // broken line with its count, the units a live reship of it already carries, the line's supplier (name,
//       // contact, address — supplier_service's) and store name

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
  /** A sample line's value at the batches it took; 0 on a reship, unset (0) for a warehouse reader. */
  total: number;
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

/** `NONE` is the create's from. A row whose from equals its to is an edit (the cost), never a step. */
export type CustomShipmentLogStatus = CustomShipmentStatus | "NONE";

export interface CustomShipmentLog {
  id: bigint;
  fromStatus: CustomShipmentLogStatus;
  toStatus: CustomShipmentStatus;
  actorUserId: bigint;
  atUnix: bigint;
  isOverride: boolean;
  description: string;
}

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
  financeAccountId: bigint;
  shippingCost: number;
  resi: string;
  note: string;
  items: CustomShipmentItem[];
  /** A sample's racks — what the take drew. Empty on a reship (its units were never on a rack). */
  picks: CustomShipmentPick[];
  total: number;
  logs: CustomShipmentLog[];
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
  brokenNote: string;
  /** The line's supplier — absent when the line named none (a-line-may-name-a-supplier-without-a-channel). */
  supplier?: ReshipSupplier;
  /** The line's store's name — only a name and a link exist for a store, no address. */
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

/** What a reship line may still send: the broken count less what a live reship of it carries. */
export const reshipLeft = (line: ReshipLine): bigint =>
  line.broken > line.alreadySent ? line.broken - line.alreadySent : 0n;

/** The draft the create form sends. */
export interface CustomShipmentDraft {
  teamId: bigint;
  kind: CustomShipmentKind;
  warehouseId: bigint;
  restockId: bigint;
  supplierId: bigint;
  lines: { productId: bigint; productCode: string; name: string; quantity: bigint; restockItemId: bigint; brokenNote: string }[];
  recipient: CustomShipmentRecipient;
  shipmentChannelId: bigint;
  payer: CustomShipmentPayer;
  financeAccountId: bigint;
  shippingCost: number;
  note: string;
}

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

// WHERE THE SCREENS WOULD LIVE — not routed (the prototype gate): the stories mount the pages at these paths. Both sides
// share the paths, as the transfer's do (`/inventories/transfer`) — the page drawn is chosen by the team type. Which menu
// group it joins is the owner's call (the accept's question), so no menu line exists either.
export const CUSTOM_SHIPMENTS_PATH = "/inventories/custom-shipments";
export const customShipmentPath = (id: bigint) => `${CUSTOM_SHIPMENTS_PATH}/${id}`;
