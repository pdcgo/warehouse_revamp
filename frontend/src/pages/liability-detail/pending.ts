import type { PendingList, PendingPart } from "../../features/pending/registry";

// WHAT THE PAIR DETAIL CANNOT DO YET. Two things, and they are one decision seen from its two ends:
// a team payment names the account it LEFT and the account it LANDED IN
// (a-team-payment-posts-on-accept, docs/business/financial_account). The pickers are built; the
// contract is not — `LiabilityPaymentRecordRequest` and `LiabilityPaymentConfirmRequest` carry no
// account id, so what is picked is thrown away. See `features/pending` for the four kinds.

/** One unwired part of the page. The id is also its i18n key (`liabilityDetail.pending.<id>`). */
export type LiabilityDetailPendingId = "fromAccount" | "toAccount";

const PARTS: PendingPart<LiabilityDetailPendingId>[] = [
  // The PAYER's half, picked when the payment is recorded — `from_account_id`.
  { id: "fromAccount", kind: "dropped" },
  // The CREDITOR's half, picked when the payment is accepted — `to_account_id`.
  { id: "toAccount", kind: "dropped" },
];

export const LIABILITY_DETAIL_PENDING: PendingList<LiabilityDetailPendingId> = {
  ns: "liabilityDetail",
  parts: PARTS,
};
