import type { PendingList, PendingPart } from "../../features/pending/registry";

// WHAT THE SELLING TEAM'S RESTOCK LIST CANNOT DO YET. The contract was rewritten to the decided design
// (the-restock-contract-changes-in-place), but the backend lags it until the backend step: a line's supplier and store
// and the courier are accepted but not stored, Cancel's money answer is not sent on, and Mark Lost answers
// Unimplemented. In Storybook the stub plays them. See `features/pending` for the four kinds.

/** One unwired part of the page. The id is also its i18n key (`restock.selling.pending.<id>`). */
export type RestockSellingPendingId = "lineSupplier" | "courier" | "moneyReturned" | "markLost";

const PARTS: PendingPart<RestockSellingPendingId>[] = [
  // a-line-names-the-channel-it-was-bought-from — the Supplier column reads the lines' supplier and store; not stored.
  { id: "lineSupplier", kind: "dropped" },
  // the-receipt-is-the-tracking-number — the courier is `shipment_id`; not stored.
  { id: "courier", kind: "dropped" },
  // a-restock-names-its-paying-account — Cancel asks "did the money come back?"; the answer is not sent on.
  { id: "moneyReturned", kind: "dropped" },
  // lost-is-set-only-before-the-box-arrives — RestockRequestMarkLost answers Unimplemented.
  { id: "markLost", kind: "dropped" },
];

export const RESTOCK_SELLING_PENDING: PendingList<RestockSellingPendingId> = {
  ns: "restock.selling",
  parts: PARTS,
};
