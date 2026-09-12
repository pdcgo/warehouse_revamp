// Turning the wire types into the shapes the screens were designed against.
//
// The prototype's `model.ts` came FIRST (HARD RULE 6) and the proto was derived from it, so this
// adapter is deliberately thin — it exists to absorb the two places the wire and the screen genuinely
// differ, not to reshape the design.
//
//   1. the wire carries ENUMS, the screen carries string unions — the screen's are readable in a
//      switch and in a test failure, where `2` is not
//   2. the list RPC returns the guideline's map-slices keyed by id, and a table needs an ORDERED array

import {
  SettlementType as WireSettlementType,
  SourceType as WireSourceType,
  type OrderSettlement as WireOrderSettlement,
  type OrderSettlementListResponseItem,
  type SettlementEntry as WireSettlementEntry,
} from "../../gen/warehouse/settlement/v1/settlement_pb";
import type {
  OrderSettlement,
  SettlementEntry,
  SettlementType,
  SourceType,
} from "../../pages/order-settlement/model";
import { OrderSettlementListDataType } from "../../gen/warehouse/settlement/v1/settlement_pb";

const settlementTypeOf: Record<number, SettlementType> = {
  [WireSettlementType.INITIAL_TOTAL]: "initial_total",
  [WireSettlementType.INITIAL_TOTAL_CANCEL]: "initial_total_cancel",
  [WireSettlementType.FUND]: "fund",
  [WireSettlementType.EXTERNAL_ADS_FEE]: "external_ads_fee",
  [WireSettlementType.AFFILIATE_FEE]: "affiliate_fee",
  [WireSettlementType.MARKETPLACE_ADJUSTMENT]: "marketplace_adjustment",
  [WireSettlementType.OTHER]: "other",
};

export const wireSettlementType: Record<SettlementType, WireSettlementType> = {
  initial_total: WireSettlementType.INITIAL_TOTAL,
  initial_total_cancel: WireSettlementType.INITIAL_TOTAL_CANCEL,
  fund: WireSettlementType.FUND,
  external_ads_fee: WireSettlementType.EXTERNAL_ADS_FEE,
  affiliate_fee: WireSettlementType.AFFILIATE_FEE,
  marketplace_adjustment: WireSettlementType.MARKETPLACE_ADJUSTMENT,
  other: WireSettlementType.OTHER,
};

const sourceTypeOf: Record<number, SourceType> = {
  [WireSourceType.EXPORTER]: "exporter",
  [WireSourceType.MANUAL]: "manual",
  [WireSourceType.ORDER]: "order",
};

/** The slices a settlement list needs. */
export function settlementRowData(): OrderSettlementListDataType[] {
  return [OrderSettlementListDataType.SETTLEMENT];
}

export function entryFromWire(wire: WireSettlementEntry): SettlementEntry {
  return {
    id: String(wire.id),
    uniqueId: wire.uniqueId,
    settlementType: settlementTypeOf[wire.settlementType] ?? "other",
    change: wire.change,
    balance: wire.balance,
    sourceType: sourceTypeOf[wire.sourceType] ?? "exporter",
    // ⚠ The id, not a name. Resolving it needs user_service, and a ledger does not read another
    // service's tables (HARD RULE 3) — the screen looks it up where it already lists people.
    actorName: wire.actorName || String(wire.actorId),
    occurredOn: wire.occurredOn,
    postedOn: wire.postedOn,
    reversesId: wire.reversesId === 0n ? undefined : String(wire.reversesId),
    note: wire.note || undefined,
  };
}

/**
 * ⚠ `orderRef`, `shopName`, `teamName` and `cogs` are NOT on the wire and cannot be — settlement
 * never learns the marketplace's reference, and the names and cost live in selling_service.
 *
 * So they are filled from what the CALLER already has. The panel is mounted on the order detail page,
 * which holds all four; the list screen has only the order id, and shows that.
 */
export function settlementFromWire(
  wire: WireOrderSettlement,
  known: Partial<Pick<OrderSettlement, "orderRef" | "shopName" | "teamName" | "cogs">> = {},
  entries: SettlementEntry[] = [],
): OrderSettlement {
  return {
    orderId: wire.orderId,
    orderRef: known.orderRef ?? String(wire.orderId),
    shopName: known.shopName ?? "",
    teamName: known.teamName ?? "",
    initialTotal: wire.initialTotal,
    lastBalance: wire.lastBalance,
    cogs: known.cogs ?? 0n,
    entries,
  };
}

/** The list's map-slice, back into the order `ids` established. */
export function settlementsFromList(
  items: OrderSettlementListResponseItem[],
  ids: bigint[],
): OrderSettlement[] {
  const byId = new Map<bigint, WireOrderSettlement>();

  for (const item of items) {
    if (item.d.case === "settlement") {
      for (const [id, row] of Object.entries(item.d.value.mapData)) {
        byId.set(BigInt(id), row);
      }
    }
  }

  // `ids` carries the SORT. Rebuilding from the map's own key order would silently discard the
  // ranking the list screen exists for.
  return ids.flatMap((id) => {
    const row = byId.get(id);

    return row ? [settlementFromWire(row)] : [];
  });
}
