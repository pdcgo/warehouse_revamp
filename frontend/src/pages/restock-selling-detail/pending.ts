import type { PendingList, PendingPart } from "../../features/pending/registry";

// WHAT A RESTOCK'S PAGE CANNOT DO YET. The list shrinks by one entry each time something behind it lands. In the order
// they sit on the page — the number on a badge is its position here.

/** One unwired part of the page. The id is also its i18n key (`restock.detail.pending.<id>`). */
export type PendingId =
  | "cancelReview"
  | "brokenPhoto"
  | "courierPhoto"
  | "sellingNoteBy"
  | "lateNote"
  | "warehouseNote"
  | "trailChanges";

const PARTS: PendingPart<PendingId>[] = [
  // ⚠ NOTHING CHECKS A CANCELLATION. The cancel dialog warns that it will be (owner: *"taruh di unimplemented juga khusus
  // ini"*, a-restock-cancel-warns-it-will-be-checked); no screen, queue or record does it — the check is MISSING.
  { id: "cancelReview", kind: "missing" },
  // ⚠ THE BROKEN UNITS' PHOTO IS A SAMPLE (a-broken-product-carries-a-photo): the accept page picks one and keeps nothing,
  // so every broken line shows the same drawing (photoSamples.ts) — in the Penyesuaian dialog, and on a phone's block.
  { id: "brokenPhoto", kind: "sample" },
  // ⚠ THE COURIER'S SLIP IS A SAMPLE (the-detail-pages-show-the-slip-and-the-broken-rack): no act keeps the photo, so a
  // restock with a charge shows the same drawing in its Ongkir COD section.
  { id: "courierPhoto", kind: "sample" },
  // ⚠ WHO WROTE THE NOTE, AND WHEN, IS NOT STORED (the-notes-are-one-per-writer). Shown is the restock's last raise or
  // edit — real, but an edit that changed only a line counts too.
  { id: "sellingNoteBy", kind: "derived" },
  // ⚠ A NOTE EDITED PAST THE RESTOCK'S WAY IS THROWN AWAY (the-note-is-edited-in-any-status): the server keeps the head of a
  // restock closed once it arrives; Ubah is there, the save says it was not kept.
  { id: "lateNote", kind: "dropped" },
  // ⚠ THE WAREHOUSE'S NOTE HAS NO FIELD. When it may be written — from the box's arrival, the owner's leaning — is not
  // the owner's to decide; the block is shown, empty, and says so.
  { id: "warehouseNote", kind: "missing" },
  // ⚠ AN EDIT'S ROW DOES NOT SAY WHAT CHANGED. The server writes "edited" and nothing more; the row shows who and when.
  { id: "trailChanges", kind: "missing" },
];

/** What the badges and the summary on this page read. `ns` is where its copy lives. */
export const RESTOCK_SELLING_DETAIL_PENDING: PendingList<PendingId> = { ns: "restock.detail", parts: PARTS };
