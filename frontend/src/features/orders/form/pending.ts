import type { PendingList, PendingPart } from "../../pending/registry";

// WHAT THE ORDER FORM CANNOT DO YET — in ONE list.
//
// ONE SCREEN DRAWS THIS FORM — a new order, and a draft being finished, which is the same page opened with
// `?draft=` (`the-draft-opens-in-the-order-form`); its own draft page, which extended this list, is gone.
//
// This screen is deliberately ahead of the system: bundles have no contract, the
// Product LinkMap is not built, a debtor cannot read another team's credit terms, nothing prices a
// shipment, and the order message has no field for a deadline or a buyer's username. The owner's
// instruction was to build it anyway and have the SCREEN say which parts are unwired — the list
// shrinks by one entry each time something behind it lands.
//
// ⚠ THE BADGE AND THE SUMMARY READ THIS FILE, both of them. That is the whole point of a registry:
// a badge on a card and a line in the summary strip cannot disagree, and neither can be forgotten
// when the other is added. Writing the sentence into each card instead is how a screen ends up
// claiming eight pending parts while carrying nine.
//
// REMOVING one later is deleting its entry: the badge, the note and the summary row go with it, and
// what is left in this array is the remaining work.

/** One unwired part of the screen. The id is also its i18n key (`orderForm.pending.<id>`). */
export type PendingId =
  | "returnMap"
  | "creditLimit"
  | "profit"
  | "shippingCost"
  | "invoice"
  | "receiptScan"
  | "refsDistinct"
  | "formatRules"
  | "buyerUsername";

// The four KINDS and the numbering live in `features/pending` — this file is only this screen's
// list, because "what is missing" is a fact about this screen and nothing else.
const PARTS: PendingPart<PendingId>[] = [
  // (The Bundles card's mark is gone: the bundles are BundleList's, and the order keeps no trace of one
  // BY DESIGN — the-order-keeps-only-product-lines.)
  { id: "returnMap", kind: "dropped" },
  { id: "creditLimit", kind: "sample" },
  { id: "profit", kind: "derived" },
  // HIDDEN (owner): nothing prices a shipment, so the field was taken off the screen rather than
  // left as a box to guess into. The entry survives the control, because the ORDER TOTAL is now
  // missing a term and the profit estimate therefore reads high — which is invisible unless said.
  { id: "shippingCost", kind: "missing" },
  // The warehouse fee on the invoice is real (WarehouseFeeCalculate, frozen by order create); what is sampled is
  // each owner's MARKUP, which a debtor cannot read off another team's terms.
  { id: "invoice", kind: "sample" },
  // ⚠ THE FILE IS READ BY A SERVICE THAT IS NOT BUILT YET. `scanReceipt` calls shipment's ReceiptCheck
  // (receipt-check-is-shipments), which answers in Storybook from the stub and nowhere else until the
  // backend lands — so outside it, the autofill and the "does this match the file?" check see nothing.
  { id: "receiptScan", kind: "sample" },
  // The comparison runs and really does refuse the order; what is missing is the authority. A
  // server-side checker sees what this one cannot — the references other orders already carry.
  { id: "refsDistinct", kind: "derived" },
  // The courier and marketplace FORMATS are a table in `checks.ts`, written from what we have seen
  // rather than from anything official. They warn; they never refuse.
  { id: "formatRules", kind: "derived" },
  { id: "buyerUsername", kind: "dropped" },
];

/** What the badges and the summary on this screen read. `ns` is where its copy lives. */
export const ORDER_FORM_PENDING: PendingList<PendingId> = { ns: "orderForm", parts: PARTS };
