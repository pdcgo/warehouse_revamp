import type { PendingList, PendingPart } from "../../features/pending/registry";

// What Rack detail admits it cannot do yet.
//
// ⚠ THE LIST IS EMPTY (2026-11-04). Its last entry, the count lock, went when it was found built: the server marks a
// product being counted on the rack's stock (RackStockLine.counting) and RackMove / RackSample refuse it as "being
// counted" (a-lock-stops-sales-and-cancels-too), so the dialogs' locked-at-0 line is the real rule, not a guess.
// `NotImplementedSummary` renders nothing for an empty list; the file and the summary mount stay so the next part built
// ahead of the system is one entry here (the order form's list is the precedent, features/orders/form/pending.ts).

/** `never` while the list is empty: no control can mark itself against an id nobody declared. */
export type RackDetailPendingId = never;

const PARTS: PendingPart<RackDetailPendingId>[] = [
  // (The count lock's mark is gone: the count lock is built and enforced — see above.)
];

export const RACK_DETAIL_PENDING: PendingList<RackDetailPendingId> = {
  ns: "racks.detail",
  parts: PARTS,
};
