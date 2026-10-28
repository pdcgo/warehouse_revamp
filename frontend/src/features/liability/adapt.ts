import {
  type LiabilityCredit,
  LiabilityCreditByIdsDataType,
  type LiabilityCreditByIdsResponseList,
  type LiabilityLog,
  LiabilityLogListDataType,
  type LiabilityLogListResponseItem,
  type LiabilityPayment,
  LiabilityPaymentListDataType,
  type LiabilityPaymentListResponseItem,
  type LiabilityPosition,
  LiabilityPositionListDataType,
  type LiabilityPositionListResponseItem,
  type LiabilityTerms,
  LiabilityTermsListDataType,
  type LiabilityTermsListResponseItem,
  type LiabilityTermsChange,
  LiabilityTermsHistoryListDataType,
  type LiabilityTermsHistoryListResponseItem,
} from "../../gen/warehouse/liability/v1/liability_pb";

// The liability lists moved to the guideline shape; the POSITION / ENTRY / PAYMENT slices reuse the
// LiabilityPosition / LiabilityLog / LiabilityPayment messages directly (a position is keyed by
// counterparty_id, the others by their id). These pull the row slices out at the query boundary.

export const positionRowData = (): LiabilityPositionListDataType[] => [
  LiabilityPositionListDataType.POSITION,
];
export const logRowData = (): LiabilityLogListDataType[] => [LiabilityLogListDataType.LOG];
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

export function logsFromList(
  items: LiabilityLogListResponseItem[],
  ids: bigint[],
): LiabilityLog[] {
  let m: { [key: string]: LiabilityLog } = {};
  for (const it of items) {
    if (it.d.case === "log") m = it.d.value.mapData;
  }
  return ids.map((id) => m[id.toString()]).filter((e): e is LiabilityLog => !!e);
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

// ─── terms (#189) ───────────────────────────────────────────────────────────────────────────────
//
// ⚠ THE TERMS SLICE IS KEYED BY `counterparty_id`, AND 0 IS A REAL KEY — the creditor's DEFAULT row,
// applying to every debtor without one of their own. So this cannot filter falsy ids the way an
// id-keyed list safely could, and `ids` may legitimately contain 0.

export const termsRowData = (): LiabilityTermsListDataType[] => [LiabilityTermsListDataType.TERMS];
export const termsChangeRowData = (): LiabilityTermsHistoryListDataType[] => [
  LiabilityTermsHistoryListDataType.CHANGE,
];

export function termsFromList(
  items: LiabilityTermsListResponseItem[],
  ids: bigint[],
): LiabilityTerms[] {
  let m: { [key: string]: LiabilityTerms } = {};
  for (const it of items) {
    if (it.d.case === "terms") m = it.d.value.mapData;
  }
  return ids.map((id) => m[id.toString()]).filter((t): t is LiabilityTerms => !!t);
}

export function termsChangesFromList(
  items: LiabilityTermsHistoryListResponseItem[],
  ids: bigint[],
): LiabilityTermsChange[] {
  let m: { [key: string]: LiabilityTermsChange } = {};
  for (const it of items) {
    if (it.d.case === "change") m = it.d.value.mapData;
  }
  return ids.map((id) => m[id.toString()]).filter((c): c is LiabilityTermsChange => !!c);
}

// ─── the debtor's side of a limit (the-debtor-sees-the-limits-set-on-it) ─────────────────────────
//
// A ByIds answer, keyed by CREDITOR id. Every creditor asked about is present — an absent one could not be told from
// an unlimited one — except the asking team itself, which the server drops as the credit check does.

export const creditRowData = (): LiabilityCreditByIdsDataType[] => [LiabilityCreditByIdsDataType.CREDIT];

/** The CREDIT slice, keyed by creditor id. `creditLimit` stays `undefined` for unlimited — never 0. */
export function creditsFromByIds(items: {
  [key: string]: LiabilityCreditByIdsResponseList;
}): Map<string, LiabilityCredit> {
  const out = new Map<string, LiabilityCredit>();

  for (const [id, list] of Object.entries(items)) {
    for (const it of list.items) {
      if (it.d.case !== "credit") continue;

      const credit = it.d.value.mapData[id];
      if (credit) out.set(id, credit);
    }
  }

  return out;
}
