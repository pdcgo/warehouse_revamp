import type { PendingList, PendingPart } from "../../features/pending/registry";

// WHAT THE SELLING TEAM'S RESTOCK PAGE CANNOT DO YET. The contract was rewritten to the decided design
// (the-restock-contract-changes-in-place), but the backend lags it: these fields are ACCEPTED BUT NOT STORED, and two
// RPCs answer Unimplemented, until the backend step. In Storybook the stub plays them; against the real server each
// reads empty or fails. See `features/pending` for the four kinds.

/** One unwired part of the page. The id is also its i18n key (`restock.detail.pending.<id>`). */
export type RestockSellingDetailPendingId =
  | "payingAccount"
  | "courier"
  | "receiptPhoto"
  | "lineSupplier"
  | "lineNote"
  | "problemNotes"
  | "moneyReturned"
  | "markLost";

const PARTS: PendingPart<RestockSellingDetailPendingId>[] = [
  // a-restock-names-its-paying-account — `finance_account_id`, typed on the form, not stored.
  { id: "payingAccount", kind: "dropped" },
  // the-receipt-is-the-tracking-number — the courier is `shipment_id`, a shipment channel; not stored.
  { id: "courier", kind: "dropped" },
  // `receipt_file`, a photo of the label; not stored.
  { id: "receiptPhoto", kind: "dropped" },
  // a-line-may-name-a-supplier-without-a-channel — a line's `supplier_id` / `supplier_channel_id`; not stored, and the
  // store names come from SupplierChannelByIds, which the real server does not answer yet.
  { id: "lineSupplier", kind: "dropped" },
  // three-notes-one-writer-each — the selling team's note on a line ("extra stock"); not stored.
  { id: "lineNote", kind: "dropped" },
  // three-notes-one-writer-each — the warehouse's note on a broken or missing row; not stored.
  { id: "problemNotes", kind: "dropped" },
  // a-restock-names-its-paying-account — Cancel asks "did the money come back?"; the answer is not sent on.
  { id: "moneyReturned", kind: "dropped" },
  // lost-is-set-only-before-the-box-arrives — RestockRequestMarkLost answers Unimplemented.
  { id: "markLost", kind: "dropped" },
];

export const RESTOCK_SELLING_DETAIL_PENDING: PendingList<RestockSellingDetailPendingId> = {
  ns: "restock.detail",
  parts: PARTS,
};
