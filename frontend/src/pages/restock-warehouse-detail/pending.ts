import type { PendingList, PendingPart } from "../../features/pending/registry";

// WHAT THE WAREHOUSE'S RESTOCK PAGE CANNOT DO YET. The contract was rewritten to the decided design
// (the-restock-contract-changes-in-place), but the backend lags it: these fields are ACCEPTED BUT NOT STORED, and
// signing for the box answers Unimplemented, until the backend step. In Storybook the stub plays them; against the real
// server each reads empty or fails. See `features/pending` for the four kinds.
//
// The labels are shared with the selling detail (`restock.detail.pending.*`) — the same field means the same thing on
// either side.

/** One unwired part of the page. The id is also its i18n key (`restock.detail.pending.<id>`). */
export type RestockWarehouseDetailPendingId =
  | "signForBox"
  | "courier"
  | "receiptPhoto"
  | "lineSupplier"
  | "lineNote"
  | "problemNotes";

const PARTS: PendingPart<RestockWarehouseDetailPendingId>[] = [
  // the-warehouse-signs-and-accepts-the-team-does-the-rest — RestockRequestArrive answers Unimplemented.
  { id: "signForBox", kind: "dropped" },
  // the-receipt-is-the-tracking-number — the courier is `shipment_id`; not stored.
  { id: "courier", kind: "dropped" },
  // `receipt_file`, a photo of the label; not stored.
  { id: "receiptPhoto", kind: "dropped" },
  // a-line-may-name-a-supplier-without-a-channel — a line's supplier and store; not stored.
  { id: "lineSupplier", kind: "dropped" },
  // three-notes-one-writer-each — the selling team's note on a line; not stored.
  { id: "lineNote", kind: "dropped" },
  // three-notes-one-writer-each — this warehouse's note on a broken or missing row, typed at accept; not stored.
  { id: "problemNotes", kind: "dropped" },
];

export const RESTOCK_WAREHOUSE_DETAIL_PENDING: PendingList<RestockWarehouseDetailPendingId> = {
  ns: "restock.detail",
  parts: PARTS,
};
