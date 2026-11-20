import {
  CustomShipmentKind as WireKind,
  CustomShipmentLogKind as WireLogKind,
  CustomShipmentPayer as WirePayer,
  CustomShipmentStatus as WireStatus,
} from "../../gen/warehouse/inventory/v1/custom_shipment_pb";
import type {
  CustomShipment as WireShipment,
  CustomShipmentGoodsMissing as WireGoodsMissing,
  CustomShipmentMissingItem as WireMissingItem,
  CustomShipmentReshipOption as WireReshipOption,
} from "../../gen/warehouse/inventory/v1/custom_shipment_pb";
import type {
  CustomShipment,
  CustomShipmentKind,
  CustomShipmentLogKind,
  CustomShipmentLogStatus,
  CustomShipmentPayer,
  CustomShipmentStatus,
  GoodsMissingLine,
  GoodsMissingNote,
  ReshipOption,
} from "./customShipments";

// THE WIRE → THE SCREENS' TYPES (customShipments.ts). One mapping, so the five screens read one parcel the same way.
//
// ⚠ The money fields stay as the server sent them: `total`, a line's `total` and `shipping_cost` are proto3 `optional`
// and arrive UNSET for a warehouse reader (a-warehouse-sees-no-seller-money) — they are carried as `undefined`, never
// filled with 0 here, so the warehouse's view is exactly the data it was answered.

const STATUS: Record<number, CustomShipmentStatus> = {
  [WireStatus.REQUESTED]: "REQUESTED",
  [WireStatus.PICKED]: "PICKED",
  [WireStatus.HANDED_OVER]: "HANDED_OVER",
  [WireStatus.CANCELLED]: "CANCELLED",
};

export const statusOf = (status: WireStatus): CustomShipmentStatus => STATUS[status] ?? "REQUESTED";

/** The create's row says UNSPECIFIED for its from — the screens read it as NONE. */
const logStatusOf = (status: WireStatus): CustomShipmentLogStatus => STATUS[status] ?? "NONE";

export const kindOf = (kind: WireKind): CustomShipmentKind => (kind === WireKind.RESTOCK_RESHIP ? "RESTOCK_RESHIP" : "SAMPLE");

export const payerOf = (payer: WirePayer): CustomShipmentPayer => (payer === WirePayer.TEAM ? "TEAM" : "WAREHOUSE");

export const wireStatus = (status: CustomShipmentStatus | undefined): WireStatus =>
  status === undefined
    ? WireStatus.UNSPECIFIED
    : ({ REQUESTED: WireStatus.REQUESTED, PICKED: WireStatus.PICKED, HANDED_OVER: WireStatus.HANDED_OVER, CANCELLED: WireStatus.CANCELLED } as const)[status];

export const wireKind = (kind: CustomShipmentKind | undefined): WireKind =>
  kind === undefined ? WireKind.UNSPECIFIED : kind === "SAMPLE" ? WireKind.SAMPLE : WireKind.RESTOCK_RESHIP;

export const wirePayer = (payer: CustomShipmentPayer): WirePayer => (payer === "TEAM" ? WirePayer.TEAM : WirePayer.WAREHOUSE);

/** A trail row's kind; a row from before the kind existed reads by its shape (from = to: a cost edit). */
function logKindOf(kind: WireLogKind, sameStatus: boolean): CustomShipmentLogKind {
  if (kind === WireLogKind.GOODS_MISSING) return "GOODS_MISSING";
  if (kind === WireLogKind.COST_EDIT) return "COST_EDIT";
  if (kind === WireLogKind.STATUS) return "STATUS";
  return sameStatus ? "COST_EDIT" : "STATUS";
}

const missingLineOf = (line: WireMissingItem): GoodsMissingLine => ({
  itemId: line.itemId,
  productId: line.productId,
  productCode: line.productCode,
  name: line.name,
  rackId: line.rackId,
  rackCode: line.rackCode,
  quantity: line.quantity,
});

const goodsMissingOf = (note: WireGoodsMissing): GoodsMissingNote => ({
  id: note.logId,
  lines: note.lines.map(missingLineOf),
  note: note.note,
  actorUserId: note.actorUserId,
  atUnix: note.atUnix,
  isOverride: note.isOverride,
});

export function customShipmentFromWire(m: WireShipment): CustomShipment {
  return {
    id: m.id,
    teamId: m.teamId,
    warehouseId: m.warehouseId,
    kind: kindOf(m.kind),
    status: statusOf(m.status),
    restockId: m.restockId,
    supplierId: m.supplierId,
    recipient: { name: m.recipient?.name ?? "", phone: m.recipient?.phone ?? "", address: m.recipient?.address ?? "" },
    shipmentChannelId: m.shipmentChannelId,
    payer: payerOf(m.payer),
    financeAccountId: m.financeAccountId,
    shippingCost: m.shippingCost,
    resi: m.resi,
    note: m.note,
    items: m.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      productCode: item.productCode,
      name: item.name,
      quantity: item.quantity,
      total: item.total,
      restockItemId: item.restockItemId,
      brokenNote: item.brokenNote,
    })),
    transactionId: m.transactionId,
    total: m.total,
    logs: m.logs.map((log) => ({
      id: log.id,
      kind: logKindOf(log.kind, log.fromStatus === log.toStatus),
      fromStatus: logStatusOf(log.fromStatus),
      toStatus: statusOf(log.toStatus),
      actorUserId: log.actorUserId,
      atUnix: log.atUnix,
      isOverride: log.isOverride,
      description: log.description,
      missing: log.missing.map(missingLineOf),
    })),
    goodsMissing: m.goodsMissing ? goodsMissingOf(m.goodsMissing) : undefined,
    createdByUserId: m.createdByUserId,
    createdAtUnix: m.createdAtUnix,
  };
}

export function reshipOptionFromWire(m: WireReshipOption): ReshipOption {
  return {
    restockId: m.restockId,
    teamId: m.teamId,
    warehouseId: m.warehouseId,
    acceptedAtUnix: m.acceptedAtUnix,
    lines: m.lines.map((line) => ({
      restockItemId: line.restockItemId,
      productId: line.productId,
      productCode: line.productCode,
      name: line.name,
      broken: line.broken,
      alreadySent: line.alreadySent,
      notFound: line.notFound,
      brokenNote: line.brokenNote,
      supplierId: line.supplierId,
      supplierChannelId: line.supplierChannelId,
      storeName: "",
    })),
  };
}
