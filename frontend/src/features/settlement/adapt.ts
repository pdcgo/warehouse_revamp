import {
  type SettlementEntry,
  SettlementEntryListDataType,
  type SettlementEntryListResponseItem,
  type SettlementPayment,
  SettlementPaymentListDataType,
  type SettlementPaymentListResponseItem,
  type SettlementPosition,
  SettlementPositionListDataType,
  type SettlementPositionListResponseItem,
} from "../../gen/warehouse/settlement/v1/settlement_pb";

// The settlement lists moved to the guideline shape; the POSITION / ENTRY / PAYMENT slices reuse the
// SettlementPosition / SettlementEntry / SettlementPayment messages directly (a position is keyed by
// counterparty_id, the others by their id). These pull the row slices out at the query boundary.

export const positionRowData = (): SettlementPositionListDataType[] => [
  SettlementPositionListDataType.POSITION,
];
export const entryRowData = (): SettlementEntryListDataType[] => [SettlementEntryListDataType.ENTRY];
export const paymentRowData = (): SettlementPaymentListDataType[] => [
  SettlementPaymentListDataType.PAYMENT,
];

export function positionsFromList(
  items: SettlementPositionListResponseItem[],
  ids: bigint[],
): SettlementPosition[] {
  let m: { [key: string]: SettlementPosition } = {};
  for (const it of items) {
    if (it.d.case === "position") m = it.d.value.mapData;
  }
  return ids.map((id) => m[id.toString()]).filter((p): p is SettlementPosition => !!p);
}

export function entriesFromList(
  items: SettlementEntryListResponseItem[],
  ids: bigint[],
): SettlementEntry[] {
  let m: { [key: string]: SettlementEntry } = {};
  for (const it of items) {
    if (it.d.case === "entry") m = it.d.value.mapData;
  }
  return ids.map((id) => m[id.toString()]).filter((e): e is SettlementEntry => !!e);
}

export function paymentsFromList(
  items: SettlementPaymentListResponseItem[],
  ids: bigint[],
): SettlementPayment[] {
  let m: { [key: string]: SettlementPayment } = {};
  for (const it of items) {
    if (it.d.case === "payment") m = it.d.value.mapData;
  }
  return ids.map((id) => m[id.toString()]).filter((p): p is SettlementPayment => !!p);
}
