import type { PendingList, PendingPart } from "../../features/pending/registry";

// WHAT THE ORDER DETAIL CANNOT DO YET — one list, the same machinery the order list and the order
// form carry.
//
// This is a PREVIEW of the screen the owner specified: seven sections down one page, rather than the
// three tabs the built detail page has. Most of what the sections need is real — the order, its lines
// and their products' pictures, its timeline, its notes, its address, its tracking number and its frozen warehouse
// fee. What is missing clusters in two places: the parcel's trail, and Edit Resi.
//
// The list shrinks by one entry each time something behind it lands. See `features/pending` for the
// four kinds and for why the badge's number is the position in this array.

/** One unwired part of the screen. The id is also its i18n key (`orderDetail.pending.<id>`). */
export type PendingId = "shippingTracking" | "receiptCode";

const PARTS: PendingPart<PendingId>[] = [
  // ⚠ THE TRACKING NUMBER IS STORED NOW (`receipt_code`), BUT THE REST OF THE SHIPMENT IS NOT MODELLED AT ALL — where the parcel is, when the courier
  // scanned it, what it weighed, what the postage cost. The owner expects this section to be EMPTY
  // most of the time ("kebanyakan tidak ada"), which is a design fact worth keeping: the section says
  // "no tracking recorded" rather than hiding, because an absent parcel trail is itself the news.
  //
  // The number was one missing FIELD and has landed; this is a missing INTEGRATION.
  { id: "shippingTracking", kind: "missing" },
  // ⚠ EDIT RESI IS ON SCREEN AND DOES NOTHING. Decided (the-seller-edits-the-resi-until-handover): the selling team
  // changes the tracking number, the label file or both, while the parcel is still in the building. There is no edit
  // RPC yet, so the action only says so. `rowActions.ts` points EDIT_RECEIPT here — the id must be in this list, or the
  // badge reads a position that does not exist.
  { id: "receiptCode", kind: "missing" },
];

/** What the badges and the summary on this screen read. `ns` is where its copy lives. */
export const ORDER_DETAIL_PENDING: PendingList<PendingId> = { ns: "orderDetail", parts: PARTS };
