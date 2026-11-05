import type { PendingList, PendingPart } from "../../features/pending/registry";

// WHAT THE WAREHOUSE'S RESTOCK PAGE CANNOT DO YET. Everything it reads is real but two things: the courier's charge noted
// when the box is signed for is not kept, and the broken units' photo is a sample. In the order they sit on the page —
// the number on a badge is its position here.

/** One unwired part of the page. The id is also its i18n key (`restock.detail.pending.<id>`). */
export type PendingId = "arrivalCod" | "brokenPhoto";

const PARTS: PendingPart<PendingId>[] = [
  // ⚠ THE CHARGE NOTED AT TANDAI TIBA IS THROWN AWAY (the-cod-can-be-noted-when-the-box-arrives): RestockRequestArrive
  // takes no charge. The header's sign dialog has the fields; a toast after the sign says to enter it again at Terima. And
  // it goes AGAINST the business decision the-warehouse-cost-is-the-couriers-charge-at-the-door (entered at accept).
  { id: "arrivalCod", kind: "dropped", conflict: true },
  // ⚠ THE BROKEN UNITS' PHOTO IS A SAMPLE (a-broken-product-carries-a-photo): the accept page picks one and keeps nothing,
  // so every broken line shows the same drawing (brokenPhotoSample.ts) beside its count.
  { id: "brokenPhoto", kind: "sample" },
];

/** What the badges and the summary on this page read. `ns` is where its copy lives. */
export const RESTOCK_WAREHOUSE_DETAIL_PENDING: PendingList<PendingId> = { ns: "restock.detail", parts: PARTS };
