import type { PendingList, PendingPart } from "../../pending/registry";

// WHAT THE ORDER FORM CANNOT DO YET — in ONE list.
//
// ONE SCREEN DRAWS THIS FORM — a new order, and a draft being finished, which is the same page opened with
// `?draft=` (`the-draft-opens-in-the-order-form`); its own draft page, which extended this list, is gone.
//
// ⚠ THE LIST IS EMPTY (2026-10-23). Its last entry, the receipt file, went when shipment's ReceiptCheck was
// built (the-receipt-check-prototype-is-accepted), so a new order carries no mark and no strip —
// `NotImplementedSummary` renders nothing for an empty list. The file stays, and the order-create page still mounts
// the summary, because the draft page EXTENDS this list and the form's cards mark against it: the next part built
// ahead of the system is one entry here, and the strip comes back with it.
//
// ⚠ THE BADGE AND THE SUMMARY READ THIS FILE, both of them. That is the whole point of a registry:
// a badge on a card and a line in the summary strip cannot disagree, and neither can be forgotten
// when the other is added. Writing the sentence into each card instead is how a screen ends up
// claiming eight pending parts while carrying nine.
//
// REMOVING one later is deleting its entry: the badge, the note and the summary row go with it, and
// what is left in this array is the remaining work.

/**
 * One unwired part of the screen. The id is also its i18n key (`orderForm.pending.<id>`). `never` while the list
 * is empty: the draft page's own ids still extend it, and no card can mark itself against an id nobody declared.
 */
export type PendingId = never;

// The four KINDS and the numbering live in `features/pending` — this file is only this screen's
// list, because "what is missing" is a fact about this screen and nothing else.
const PARTS: PendingPart<PendingId>[] = [
  // (The Bundles card's mark is gone: the bundles are BundleList's, and the order keeps no trace of one
  // BY DESIGN — the-order-keeps-only-product-lines.)
  // (The return mapping's mark is gone: a pick is written by ProductReturnMapCreate the moment it is confirmed, a pair
  // already standing is read by ProductReturnMapByIds, and both doors refuse a borrowed line with no map —
  // the-return-map-is-selling-services-and-read-by-ids.)
  // (The debt limits' mark is gone: each creditor's limit on this team and the debt already carried are read by
  // LiabilityCreditByIds — the-debtor-sees-the-limits-set-on-it — the same reading the create's check makes.)
  // (The estimated profit's mark is gone: the figures are real, the formula is the-margin-is-mp-minus-total-beli,
  // the sell price is required, and the floor is the-margin-floor-is-35-percent-for-every-team.)
  // (The shipping cost's mark is gone: an order records no shipping cost BY DESIGN, so the total is not short a
  // term — an-order-records-no-shipping-cost, cod-and-shipping-are-the-platforms.)
  // (The invoice's mark is gone: each line is charged at its PRODUCT's own markup, read off the product
  // (the-cross-markup-belongs-to-the-product), and the warehouse fee is WarehouseFeeCalculate's — nothing on it is a
  // sample any more.)
  // (The receipt file's mark is gone: `scanReceipt` calls shipment's ReceiptCheck, which is built — the autofill and
  // the "does this match the file?" check read the real label — the-receipt-check-prototype-is-accepted.)
  // (The order ID vs tracking number mark is gone: the two are not compared at all — some marketplaces use the order
  // id as the tracking number, the-order-id-may-be-the-tracking-number.)
  // (The formats' mark is gone: neither number's format is checked — the-form-does-not-check-number-formats.)
  // (The buyer's username's mark is gone: it is `buyer_username` on the order and the draft now —
  // the-buyers-username-is-optional.)
];

/** What the badges and the summary on this screen read. `ns` is where its copy lives. */
export const ORDER_FORM_PENDING: PendingList<PendingId> = { ns: "orderForm", parts: PARTS };
