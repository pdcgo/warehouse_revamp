// RESTOCK RESOLUTIONS AND THE SUPPLIER'S RESHIPPING (backlog #101) — the screens' types and the wire → screen mapping.
// Live since the-restock-resolutions-prototype-is-accepted (docs/technical/frontend/restock_decision.md), on the phase-1
// API (docs/services/inventory_service/rpc.md, *Restock resolutions and the inbound parcel*).
//
// The owner's decisions (docs/business/inventory/restock_decision.md, docs/business/custom_shipments/context_decision.md):
//   · a-restock-problem-is-settled-by-resolution-rows (+ every 🔄) — rows typed `refund` / `return` / `reshipping`, each
//     with a note and its time, as many as a restock needs; a `refund` carries its amount AND the account it goes into
//     (the picker opens on the restock's paying account — the build's default), raising that account's balance and
//     history from inventory's event; a `return` is the goods sent back to the supplier (the outbound reship parcel); a
//     `reshipping` the supplier sending them again; a row names NO units; the restock stays a problem until the selling
//     team MARKS IT SETTLED, and then *Barang kurang* / *Barang rusak* come off; a HILANG restock takes `refund` and
//     `reshipping`, never `return`; who — the selling team (the checklist's `selling:all`). A SETTLED restock still takes
//     rows and stays settled (🔄 A); an inbound parcel's Terima with short or broken units REOPENS it (🔄 A).
//   · a-suppliers-reshipping-comes-in-as-a-custom-shipment (+ every 🔄) — custom shipments go both ways; a `reshipping`
//     creates, in the same step, an INBOUND custom shipment (kind SUPPLIER_RESHIPPING): lines (product, count, price)
//     typed by the seller — they may differ from the restock's, the price values the stock and moves no money, editable
//     until Terima; the courier and the resi (editable until Tiba); the warehouse it comes to (opening on the restock's).
//     It arrives Tiba → Terima (good units on racks, broken / short written down) or ends Hilang; a courier's charge at the
//     door works as a restock's (the warehouse pays, noted at Tiba, final at Terima, owed back through Team Balance).
//
// THE API (phase 1): RestockRequestService.RestockResolutionCreate (REFUND · RETURN · RESHIPPING with its `reshipping`
// parcel) and RestockRequestSettle; RestockRequest.resolutions (detail) / resolution_count / settled_at_unix /
// settled_by_user_id (list and detail); RestockRequestListFilter.settled (the seller's Hilang tab = LOST + UNSETTLED).
// CustomShipmentService: the inbound parcel is a CustomShipment with `direction` INBOUND — CustomShipmentResiSet /
// PricesSet / MarkLost (the seller's) and Arrive / Receive (the warehouse's); a RETURN rides CustomShipmentCreate's
// `resolution`. A WAREHOUSE reader is answered no refund amount or account and no seller price — those arrive UNSET and
// stay `undefined` here (a-warehouse-sees-no-seller-money).

import type { CustomShipment as WireShipment } from "../../gen/warehouse/inventory/v1/custom_shipment_pb";
import {
  CustomShipmentDirection as WireDirection,
  CustomShipmentKind as WireKind,
  CustomShipmentStatus as WireStatus,
} from "../../gen/warehouse/inventory/v1/custom_shipment_pb";
import type { RestockResolution as WireResolution } from "../../gen/warehouse/inventory/v1/restock_resolution_pb";
import { RestockResolutionType as WireType } from "../../gen/warehouse/inventory/v1/restock_resolution_pb";
import type { RestockRequest } from "../../gen/warehouse/inventory/v1/restock_request_pb";
import { RestockRequestStatus } from "../../gen/warehouse/inventory/v1/restock_request_pb";

export type ResolutionType = "REFUND" | "RETURN" | "RESHIPPING";

export interface RestockResolution {
  id: bigint;
  restockId: bigint;
  type: ResolutionType;
  note: string;
  /** REFUND — the money back, exact (the-backend-never-rounds-money). UNSET for a warehouse reader. */
  refundAmount?: number;
  /** REFUND — the account it goes into. 0 on another type and for a warehouse reader. */
  financeAccountId: bigint;
  /** RETURN / RESHIPPING — the custom shipment it rides (restock_custom_shipments). 0 on a refund. */
  customShipmentId: bigint;
  /** RESHIPPING — the stock-in its parcel's Terima made; 0 until then. */
  inventoryTransactionId: bigint;
  createdByUserId: bigint;
  createdByIsOverride: boolean;
  createdAtUnix: bigint;
}

/** The settled mark (*Tandai Selesai*) — absent while the restock is not settled. */
export interface RestockSettlement {
  settledByUserId: bigint;
  settledByIsOverride: boolean;
  settledAtUnix: bigint;
}

/** The inbound parcel's steps — a restock box's (Tiba → Terima, or Hilang). */
export type InboundStatus = "ON_THE_WAY" | "ARRIVED" | "RECEIVED" | "LOST";

export interface InboundLine {
  id: bigint;
  productId: bigint;
  productCode: string;
  name: string;
  /** What the supplier says it sends. */
  count: bigint;
  /** The seller's price per unit — values the stock, moves no money. UNSET for a warehouse reader. */
  priceUnit?: number;
  /** Terima's count — what was in the box, broken included; absent until counted. */
  received?: bigint;
  broken?: bigint;
  /** The rack the good units went on — 0 = none (no good unit) or not yet. */
  rackId: bigint;
}

export interface InboundParcel {
  id: bigint;
  /** The owning selling team. */
  teamId: bigint;
  /** The warehouse it comes to. */
  warehouseId: bigint;
  restockId: bigint;
  resolutionId: bigint;
  status: InboundStatus;
  /** The supplier sending it — a supplier_service id; 0 = none named. */
  supplierId: bigint;
  /** Its name, resolved by SupplierByIds in the read that fetched the parcel; "" until known or when none. */
  supplierName: string;
  shipmentChannelId: bigint;
  resi: string;
  lines: InboundLine[];
  /** The courier's charge at the door — the warehouse pays it; noted at Tiba, final at Terima (`shipping_cost`). */
  doorCharge: number;
  doorChargeNote: string;
  createdByUserId: bigint;
  createdAtUnix: bigint;
  arrivedByUserId: bigint;
  arrivedAtUnix: bigint;
  receivedByUserId: bigint;
  receivedAtUnix: bigint;
  lostByUserId: bigint;
  lostAtUnix: bigint;
  lostReason: string;
}

// ── The wire → the screens ────────────────────────────────────────────────────────────────────────────────────────────

const TYPE_OF: Record<number, ResolutionType> = {
  [WireType.REFUND]: "REFUND",
  [WireType.RETURN]: "RETURN",
  [WireType.RESHIPPING]: "RESHIPPING",
};

const WIRE_TYPE: Record<ResolutionType, WireType> = {
  REFUND: WireType.REFUND,
  RETURN: WireType.RETURN,
  RESHIPPING: WireType.RESHIPPING,
};

export const wireResolutionType = (type: ResolutionType): WireType => WIRE_TYPE[type];

export function resolutionFromWire(m: WireResolution): RestockResolution {
  return {
    id: m.id,
    restockId: m.restockId,
    type: TYPE_OF[m.type] ?? "REFUND",
    note: m.note,
    refundAmount: m.refundAmount,
    financeAccountId: m.financeAccountId,
    customShipmentId: m.customShipmentId,
    inventoryTransactionId: m.inventoryTransactionId,
    createdByUserId: m.createdByUserId,
    createdByIsOverride: m.createdByIsOverride,
    createdAtUnix: m.createdAtUnix,
  };
}

/** A restock's resolution rows, oldest first — the detail carries them (the list sends only the count). */
export const resolutionsOf = (request: RestockRequest): RestockResolution[] => request.resolutions.map(resolutionFromWire);

/** The settled mark, or undefined while not settled (0 = not settled; lifted again by a reopening Terima). */
export function settlementOf(request: RestockRequest): RestockSettlement | undefined {
  if (request.settledAtUnix <= 0n) return undefined;

  return {
    settledByUserId: request.settledByUserId,
    settledByIsOverride: request.settledByIsOverride,
    settledAtUnix: request.settledAtUnix,
  };
}

const INBOUND_STATUS: Record<number, InboundStatus> = {
  [WireStatus.ON_THE_WAY]: "ON_THE_WAY",
  [WireStatus.ARRIVED]: "ARRIVED",
  [WireStatus.RECEIVED]: "RECEIVED",
  [WireStatus.LOST]: "LOST",
};

const WIRE_INBOUND_STATUS: Record<InboundStatus, WireStatus> = {
  ON_THE_WAY: WireStatus.ON_THE_WAY,
  ARRIVED: WireStatus.ARRIVED,
  RECEIVED: WireStatus.RECEIVED,
  LOST: WireStatus.LOST,
};

export const wireInboundStatus = (status: InboundStatus | undefined): WireStatus =>
  status === undefined ? WireStatus.UNSPECIFIED : WIRE_INBOUND_STATUS[status];

/** A parcel coming IN — the supplier's reshipping (its direction, or its kind). */
export const isInbound = (m: Pick<WireShipment, "direction" | "kind">): boolean =>
  m.direction === WireDirection.INBOUND || m.kind === WireKind.SUPPLIER_RESHIPPING;

/** An inbound parcel as the screens read it; `supplierName` is filled by the read (withSupplierNames in queries.ts). */
export function inboundFromWire(m: WireShipment): InboundParcel {
  return {
    id: m.id,
    teamId: m.teamId,
    warehouseId: m.warehouseId,
    restockId: m.restockId,
    resolutionId: m.resolutionId,
    status: INBOUND_STATUS[m.status] ?? "ON_THE_WAY",
    supplierId: m.supplierId,
    supplierName: "",
    shipmentChannelId: m.shipmentChannelId,
    resi: m.resi,
    lines: m.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      productCode: item.productCode,
      name: item.name,
      count: item.quantity,
      priceUnit: item.priceUnit,
      received: item.received,
      broken: item.broken,
      rackId: item.rackId,
    })),
    doorCharge: m.shippingCost ?? 0,
    doorChargeNote: m.chargeNote,
    createdByUserId: m.createdByUserId,
    createdAtUnix: m.createdAtUnix,
    arrivedByUserId: m.arrivedByUserId,
    arrivedAtUnix: m.arrivedAtUnix,
    receivedByUserId: m.receivedByUserId,
    receivedAtUnix: m.receivedAtUnix,
    lostByUserId: m.lostByUserId,
    lostAtUnix: m.lostAtUnix,
    lostReason: m.lostReason,
  };
}

// ── What the screens work out ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * A restock that takes resolutions — Hilang; Diterima with a problem (its door counts); or one already settled, which
 * keeps taking them (a-restock-problem-is-settled-by-resolution-rows, 🔄 A: Catat Resolusi stays open after Selesai).
 */
export function takesResolutions(request: RestockRequest): boolean {
  if (request.status === RestockRequestStatus.LOST) return true;
  if (request.status !== RestockRequestStatus.ACCEPTED) return false;
  if (request.settledAtUnix > 0n) return true;

  return request.items.some((item) => item.problems.some((p) => p.count > 0n));
}

/** Which resolution types a restock takes — a received one all three; a lost one no `return` (nothing came to send back). */
export function typesFor(lost: boolean): ResolutionType[] {
  return lost ? ["REFUND", "RESHIPPING"] : ["REFUND", "RETURN", "RESHIPPING"];
}

export const TYPE_KEYS: Record<ResolutionType, string> = {
  REFUND: "restockResolution.type.refund",
  RETURN: "restockResolution.type.return",
  RESHIPPING: "restockResolution.type.reshipping",
};

export const INBOUND_STATUS_KEYS: Record<InboundStatus, string> = {
  ON_THE_WAY: "restock.status.ongoing",
  ARRIVED: "restock.status.arrived",
  RECEIVED: "restock.status.accepted",
  LOST: "restock.status.lost",
};

/** Units short in the box — what the supplier said it sent less what arrived. 0 until counted. */
export const shortOf = (line: InboundLine): bigint =>
  line.received === undefined || line.received >= line.count ? 0n : line.count - line.received;

/** Good units — received less broken. */
export const goodOf = (line: InboundLine): bigint => (line.received ?? 0n) - (line.broken ?? 0n);

export const unitsOf = (parcel: Pick<InboundParcel, "lines">): bigint => parcel.lines.reduce((sum, l) => sum + l.count, 0n);

/** The parcel's value at the seller's prices — the seller's only. */
export const valueOf = (parcel: Pick<InboundParcel, "lines">): number =>
  parcel.lines.reduce((sum, l) => sum + (l.priceUnit ?? 0) * Number(l.count), 0);

// WHERE THE SCREENS LIVE — the reshipping form under the restock, the inbound parcel beside the outbound ones in Kirim
// Paket (the accepted prototype's places; router.tsx).
export const reshippingFormPath = (restockId: bigint) => `/inventories/restock/${restockId}/reshipping`;
export const inboundParcelPath = (id: bigint) => `/inventories/custom-shipments/in/${id}`;
/** The outbound reship form a `return` opens — the live Paket Baru, its restock picked. */
export const RETURN_FORM_PATH = "/inventories/custom-shipments/new";

/** What the restock page hands the Paket Baru form when a `return` opens it (location state — the id as text, as state
 * must survive being serialised). */
export interface ReturnFormState {
  resolutionReturn: { restockId: string };
}

export function isReturnFormState(state: unknown): state is ReturnFormState {
  return typeof state === "object" && state !== null && "resolutionReturn" in state;
}
