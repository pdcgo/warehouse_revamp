import {
  type LiabilityEntry,
  LiabilityEntryListDataType,
  type LiabilityEntryListResponseItem,
  type LiabilityPayment,
  LiabilityPaymentListDataType,
  type LiabilityPaymentListResponseItem,
  type LiabilityPosition,
  LiabilityPositionListDataType,
  type LiabilityPositionListResponseItem,
} from "../../gen/warehouse/liability/v1/liability_pb";

// The liability lists moved to the guideline shape; the POSITION / ENTRY / PAYMENT slices reuse the
// LiabilityPosition / LiabilityEntry / LiabilityPayment messages directly (a position is keyed by
// counterparty_id, the others by their id). These pull the row slices out at the query boundary.

export const positionRowData = (): LiabilityPositionListDataType[] => [
  LiabilityPositionListDataType.POSITION,
];
export const entryRowData = (): LiabilityEntryListDataType[] => [LiabilityEntryListDataType.ENTRY];
export const paymentRowData = (): LiabilityPaymentListDataType[] => [
  LiabilityPaymentListDataType.PAYMENT,
];

export function positionsFromList(
  items: LiabilityPositionListResponseItem[],
  ids: bigint[],
): LiabilityPosition[] {
  let m: { [key: string]: LiabilityPosition } = {};
  for (const it of items) {
    if (it.d.case === "position") m = it.d.value.mapData;
  }
  return ids.map((id) => m[id.toString()]).filter((p): p is LiabilityPosition => !!p);
}

export function entriesFromList(
  items: LiabilityEntryListResponseItem[],
  ids: bigint[],
): LiabilityEntry[] {
  let m: { [key: string]: LiabilityEntry } = {};
  for (const it of items) {
    if (it.d.case === "entry") m = it.d.value.mapData;
  }
  return ids.map((id) => m[id.toString()]).filter((e): e is LiabilityEntry => !!e);
}

export function paymentsFromList(
  items: LiabilityPaymentListResponseItem[],
  ids: bigint[],
): LiabilityPayment[] {
  let m: { [key: string]: LiabilityPayment } = {};
  for (const it of items) {
    if (it.d.case === "payment") m = it.d.value.mapData;
  }
  return ids.map((id) => m[id.toString()]).filter((p): p is LiabilityPayment => !!p);
}
