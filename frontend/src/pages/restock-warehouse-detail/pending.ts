import type { PendingList, PendingPart } from "../../features/pending/registry";

// WHAT THE WAREHOUSE'S RESTOCK PAGE CANNOT DO YET. Everything it reads is real but the door's extras and the notes' gaps.
// In the order they sit on the page — the title row, then the sections in the nav's order: the box, then its info
// (the-restock-page-leads-with-the-box) — the number on a badge is its position here.

/** One unwired part of the page. The id is also its i18n key (`restock.detail.pending.<id>`). */
export type PendingId =
  | "arrivalCod"
  | "brokenPhoto"
  | "brokenRack"
  | "courierPhoto"
  | "sellingNoteBy"
  | "warehouseNoteKept"
  | "trailChanges";

const PARTS: PendingPart<PendingId>[] = [
  // ⚠ THE CHARGE NOTED AT TANDAI TIBA IS THROWN AWAY (the-cod-can-be-noted-when-the-box-arrives): RestockRequestArrive
  // takes no charge. The title row's sign dialog has the fields; a toast after the sign says to enter it again at Terima.
  // And it goes AGAINST the business decision the-warehouse-cost-is-the-couriers-charge-at-the-door (entered at accept).
  { id: "arrivalCod", kind: "dropped", conflict: true },
  // ⚠ THE BROKEN UNITS' PHOTO IS A SAMPLE (a-broken-product-carries-a-photo): the accept page picks one and keeps nothing,
  // so every broken line shows the same drawing (photoSamples.ts) beside its count.
  { id: "brokenPhoto", kind: "sample" },
  // ⚠ THE BROKEN UNITS' RACK IS A SAMPLE (the-detail-pages-show-the-slip-and-the-broken-rack): Terima's "put on a rack" is
  // not kept, so the Tempat cell shows the line's first place as where they went. And it goes AGAINST the business decision
  // a-broken-unit-is-thrown-away.
  { id: "brokenRack", kind: "sample", conflict: true },
  // ⚠ THE COURIER'S SLIP IS A SAMPLE (the-detail-pages-show-the-slip-and-the-broken-rack): no act keeps the photo, so a
  // restock with a charge shows the same drawing in its Ongkir COD section.
  { id: "courierPhoto", kind: "sample" },
  // ⚠ WHO WROTE THE SELLING TEAM'S NOTE, AND WHEN, IS NOT STORED (the-notes-are-one-per-writer): shown is the restock's last
  // raise or edit — real, but an edit that changed only a line counts too.
  { id: "sellingNoteBy", kind: "derived" },
  // ⚠ THIS WAREHOUSE'S NOTE IS THROWN AWAY (the-warehouse-writes-its-own-note): Ubah writes it, and nothing stores it — a
  // save says so, and the block reads empty again.
  { id: "warehouseNoteKept", kind: "dropped" },
  // ⚠ AN EDIT'S ROW DOES NOT SAY WHAT CHANGED. The server writes "edited" and nothing more; the row shows who and when.
  { id: "trailChanges", kind: "missing" },
];

/** What the badges and the summary on this page read. `ns` is where its copy lives. */
export const RESTOCK_WAREHOUSE_DETAIL_PENDING: PendingList<PendingId> = { ns: "restock.detail", parts: PARTS };
