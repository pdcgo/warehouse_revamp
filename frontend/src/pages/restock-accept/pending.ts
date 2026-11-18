import type { PendingList, PendingPart } from "../../features/pending/registry";

// WHAT THE ACCEPT PAGE CANNOT DO YET. The count, the placements, the courier's charge and the photos taken at the door
// are kept; a rack for the broken units is not. In the order they sit on the page — the lines first, then the info
// beside or under them (the-accept-page-puts-the-box-left-and-the-info-right) — the number on a badge is its position
// here.
//
// The broken units' photo and the courier's slip were marks here (`dropped`) until both were kept: uploaded as they are
// picked and sent with the count (a-broken-product-carries-a-photo, the-courier-slip-has-an-optional-photo).

/** One unwired part of the page. The id is also its i18n key (`restock.accept.pending.<id>`). */
export type PendingId = "brokenRack" | "codFromArrival";

const PARTS: PendingPart<PendingId>[] = [
  // ⚠ A RACK FOR THE BROKEN UNITS IS THROWN AWAY (a-broken-product-may-go-on-a-rack): the received line places the good
  // units only, so broken ones are recorded as thrown away whatever is chosen. And the choice itself goes AGAINST the
  // business decision a-broken-unit-is-thrown-away — said in the row.
  { id: "brokenRack", kind: "dropped", conflict: true },
  // ⚠ THE CHARGE NOTED AT TIBA IS NOT HERE (terima-starts-from-the-charge-noted-at-tiba): the charge opens with the
  // restock's own, and Tandai Tiba keeps none yet — so a charge noted there is MISSING, and must be typed again.
  { id: "codFromArrival", kind: "missing" },
];

/** What the badges and the summary on this page read. `ns` is where its copy lives. */
export const RESTOCK_ACCEPT_PENDING: PendingList<PendingId> = { ns: "restock.accept", parts: PARTS };
