import type { PendingList, PendingPart } from "../../features/pending/registry";

// WHAT THE RESTOCK LIST CANNOT DO YET. The list itself is real, and so are its courier filter, its statistics and its
// export. The list shrinks by one entry each time something behind it lands.

/** One unwired part of the page. The id is also its i18n key (`restock.selling.pending.<id>`). */
export type PendingId = "cancelReview";

// In the order they sit on the screen — the number on a badge is its position here.
const PARTS: PendingPart<PendingId>[] = [
  // (Ekspor carried a `dropped` mark — its click thrown away with a toast — until RestockRequestExport wrote the list as a
  // file, the-restock-list-exports-and-filters-by-courier.)
  // (The courier filter carried a `dropped` mark until the list could ask for it: `RestockRequestListFilter.shipment_id`,
  // the-restock-list-exports-and-filters-by-courier.)
  // (The statistics' cards and Rincian's value per paying account carried two `sample` marks, `summary` and `payments`,
  // until RestockSellingStat counted them — through the list's own predicate, so they follow every filter.)
  // ⚠ NOTHING CHECKS A CANCELLATION. The cancel dialog warns that it will be (owner: *"taruh di unimplemented juga khusus
  // ini"*, a-restock-cancel-warns-it-will-be-checked); no screen, queue or record does it — the check is MISSING.
  { id: "cancelReview", kind: "missing" },
  // (The notes dialog — the-list-opens-the-notes-in-a-dialog — carried a mark for the warehouse's note until it was kept:
  // read there now with its writer and time, the-warehouse-writes-its-own-note.)
];

/** What the badges and the summary on this page read. `ns` is where its copy lives. */
export const RESTOCK_SELLING_PENDING: PendingList<PendingId> = { ns: "restock.selling", parts: PARTS };
