import type { PendingList, PendingPart } from "../../features/pending/registry";

// WHAT THIS SCREEN CANNOT DO YET.
//
// Every column on the draft row is a real field (`the-draft-list-is-the-drafts-tab`). The one gap is above the table:
// the summary's "ready" card, which can only count the page on screen. (The order list's stage strip, and its mark, left
// with `the-drafts-are-a-list-of-their-own`.)

/** One unwired part of the screen. The id is also its i18n key (`orderDrafts.pending.<id>`). */
export type PendingId = "readyCount";

const PARTS: PendingPart<PendingId>[] = [
  // Real readiness, wrong scope: counted over this page, not the whole set.
  { id: "readyCount", kind: "derived" },
];

export const ORDER_DRAFTS_PENDING: PendingList<PendingId> = { ns: "orderDrafts", parts: PARTS };
