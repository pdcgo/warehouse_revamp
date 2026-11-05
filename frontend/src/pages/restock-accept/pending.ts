import type { PendingList, PendingPart } from "../../features/pending/registry";

// WHAT THE ACCEPT PAGE CANNOT DO YET. The count, the placements and the courier's charge are kept; the photos taken at
// the door and a rack for the broken units are not. In the order they sit on the page — the number on a badge is its
// position here.

/** One unwired part of the page. The id is also its i18n key (`restock.accept.pending.<id>`). */
export type PendingId = "codFromArrival" | "courierPhoto" | "brokenPhoto" | "brokenRack";

const PARTS: PendingPart<PendingId>[] = [
  // ⚠ THE CHARGE NOTED AT TIBA IS NOT HERE (terima-starts-from-the-charge-noted-at-tiba): the charge opens with the
  // restock's own, and Tandai Tiba keeps none yet — so a charge noted there is MISSING, and must be typed again.
  { id: "codFromArrival", kind: "missing" },
  // ⚠ THE COURIER'S SLIP IS THROWN AWAY (the-courier-slip-has-an-optional-photo): the accept carries the charge and its
  // note, not a photo, and the picked file is never uploaded.
  { id: "courierPhoto", kind: "dropped" },
  // ⚠ THE BROKEN PHOTO IS THROWN AWAY (a-broken-product-carries-a-photo): RestockRequestReceivedLine has no photo.
  { id: "brokenPhoto", kind: "dropped" },
  // ⚠ A RACK FOR THE BROKEN UNITS IS THROWN AWAY (a-broken-product-may-go-on-a-rack): the received line places the good
  // units only, so broken ones are recorded as thrown away whatever is chosen. And the choice itself goes AGAINST the
  // business decision a-broken-unit-is-thrown-away — said in the row.
  { id: "brokenRack", kind: "dropped", conflict: true },
];

/** What the badges and the summary on this page read. `ns` is where its copy lives. */
export const RESTOCK_ACCEPT_PENDING: PendingList<PendingId> = { ns: "restock.accept", parts: PARTS };
