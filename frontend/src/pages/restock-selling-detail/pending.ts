import type { PendingList, PendingPart } from "../../features/pending/registry";

// WHAT A RESTOCK'S PAGE CANNOT DO YET. The list shrinks by one entry each time something behind it lands. In the order
// they sit on the page — the number on a badge is its position here.

/** One unwired part of the page. The id is also its i18n key (`restock.detail.pending.<id>`). */
export type PendingId = "cancelReview";

const PARTS: PendingPart<PendingId>[] = [
  // ⚠ NOTHING CHECKS A CANCELLATION. The cancel dialog warns that it will be (owner: *"taruh di unimplemented juga khusus
  // ini"*, a-restock-cancel-warns-it-will-be-checked); no screen, queue or record does it — the check is MISSING.
  { id: "cancelReview", kind: "missing" },
  // (The broken units' photo and the courier's slip were samples here until Terima kept them — they are the restock's own
  // now, read through RestockDoorPhotos: the-detail-pages-show-the-broken-photo,
  // the-detail-pages-show-the-slip-and-the-broken-rack.)
  // (The warehouse's note had no field until the receiving warehouse's own note was kept — read here with its writer and
  // time: the-warehouse-writes-its-own-note.)
];

/** What the badges and the summary on this page read. `ns` is where its copy lives. */
export const RESTOCK_SELLING_DETAIL_PENDING: PendingList<PendingId> = { ns: "restock.detail", parts: PARTS };
