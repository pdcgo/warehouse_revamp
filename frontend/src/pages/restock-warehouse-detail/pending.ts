import type { PendingList, PendingPart } from "../../features/pending/registry";

// WHAT THE WAREHOUSE'S RESTOCK PAGE CANNOT DO YET. Everything it reads is real but the door's extras and the notes' gaps.
// In the order they sit on the page — the title row, then the sections in the nav's order: the box, then its info
// (the-restock-page-leads-with-the-box) — the number on a badge is its position here.

/** One unwired part of the page. The id is also its i18n key (`restock.detail.pending.<id>`). */
export type PendingId = "arrivalCod" | "brokenRack";

const PARTS: PendingPart<PendingId>[] = [
  // ⚠ THE CHARGE NOTED AT TANDAI TIBA IS THROWN AWAY (the-cod-can-be-noted-when-the-box-arrives): RestockRequestArrive
  // takes no charge. The title row's sign dialog has the fields; a toast after the sign says to enter it again at Terima.
  // And it goes AGAINST the business decision the-warehouse-cost-is-the-couriers-charge-at-the-door (entered at accept).
  { id: "arrivalCod", kind: "dropped", conflict: true },
  // (The broken units' photo and the courier's slip were samples here until Terima kept them — they are the restock's own
  // now, read through RestockDoorPhotos: the-detail-pages-show-the-broken-photo,
  // the-detail-pages-show-the-slip-and-the-broken-rack.)
  // ⚠ THE BROKEN UNITS' RACK IS A SAMPLE (the-detail-pages-show-the-slip-and-the-broken-rack): Terima's "put on a rack" is
  // not kept, so the Tempat cell shows the line's first place as where they went. And it goes AGAINST the business decision
  // a-broken-unit-is-thrown-away.
  { id: "brokenRack", kind: "sample", conflict: true },
  // (This warehouse's note was thrown away here until it was kept — RestockRequestWarehouseNoteSet stores it with its
  // writer and time: the-warehouse-writes-its-own-note.)
];

/** What the badges and the summary on this page read. `ns` is where its copy lives. */
export const RESTOCK_WAREHOUSE_DETAIL_PENDING: PendingList<PendingId> = { ns: "restock.detail", parts: PARTS };
