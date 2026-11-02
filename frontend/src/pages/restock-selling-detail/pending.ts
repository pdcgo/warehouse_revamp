import type { PendingList, PendingPart } from "../../features/pending/registry";

// WHAT A RESTOCK'S PAGE CANNOT DO YET — one thing, and only while the restock can still be cancelled. The list shrinks
// by one entry each time something behind it lands.

/** One unwired part of the page. The id is also its i18n key (`restock.detail.pending.<id>`). */
export type PendingId = "cancelReview";

const PARTS: PendingPart<PendingId>[] = [
  // ⚠ NOTHING CHECKS A CANCELLATION. The cancel dialog warns that it will be (owner: *"taruh di unimplemented juga khusus
  // ini"*, a-restock-cancel-warns-it-will-be-checked); no screen, queue or record does it — the check is MISSING.
  { id: "cancelReview", kind: "missing" },
];

/** What the badges and the summary on this page read. `ns` is where its copy lives. */
export const RESTOCK_SELLING_DETAIL_PENDING: PendingList<PendingId> = { ns: "restock.detail", parts: PARTS };
