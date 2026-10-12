import type { PendingList, PendingPart } from "../../features/pending/registry";

// WHAT THIS SCREEN CANNOT DO YET.
//
// Every column on the draft row is a real field (`the-draft-list-is-the-drafts-tab`). The gaps are
// above the table: the strip it shares with the order list (the owner's eight stages over a contract
// that still carries the old six statuses), and the summary's "ready" card, which can only count the
// page on screen.

/** One unwired part of the screen. The id is also its i18n key (`orderDrafts.pending.<id>`). */
export type PendingId = "statusSet" | "readyCount";

const PARTS: PendingPart<PendingId>[] = [
  { id: "statusSet", kind: "missing" },
  // Real readiness, wrong scope: counted over this page, not the whole set.
  { id: "readyCount", kind: "derived" },
];

export const ORDER_DRAFTS_PENDING: PendingList<PendingId> = { ns: "orderDrafts", parts: PARTS };
