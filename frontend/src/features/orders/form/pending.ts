import type { PendingList, PendingPart } from "../../pending/registry";

// WHAT THE ORDER FORM CANNOT DO YET — in ONE list.
//
// ⚠ TWO SCREENS DRAW THIS FORM — a new order, and a draft being finished
// (`the-draft-page-wears-the-order-form`) — and both mark their cards against this list. The draft
// page EXTENDS it (its own entries appended), so every badge keeps its number on both screens.
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
  | "bundle"
  | "returnMap"
  | "creditLimit"
  | "profit"
  | "shippingCost"
  | "warehouseFee"
  | "invoice"
  | "orderDate"
  | "receiptCode"
  | "receiptScan"
  | "refsDistinct"
  | "formatRules"
  | "deadline"
  | "buyerUsername";

// The four KINDS and the numbering live in `features/pending` — this file is only this screen's
// list, because "what is missing" is a fact about this screen and nothing else.
const PARTS: PendingPart<PendingId>[] = [
  // ⚠ THE PRODUCTS ARE ORDERED, THE GROUPING IS NOT. A bundle puts ordinary lines on the order and
  // they are submitted like any other (see `allLines` on the page); what has nowhere to live is the
  // fact that they arrived together, so that is what this entry is about.
  { id: "bundle", kind: "dropped" },
  { id: "returnMap", kind: "dropped" },
  { id: "creditLimit", kind: "sample" },
  { id: "profit", kind: "derived" },
  // HIDDEN (owner): nothing prices a shipment, so the field was taken off the screen rather than
  // left as a box to guess into. The entry survives the control, because the ORDER TOTAL is now
  // missing a term and the profit estimate therefore reads high — which is invisible unless said.
  { id: "shippingCost", kind: "missing" },
  { id: "warehouseFee", kind: "sample" },
  { id: "invoice", kind: "sample" },
  // ⚠ NOT `created_at`. The order carries one timestamp, written by the server when the row is — so
  // an order taken on Saturday and typed in on Monday is dated Monday, and the orders list, which
  // filters on exactly that field, files it under the wrong day. WHEN THE CUSTOMER BOUGHT IT is a
  // different fact from when we wrote it down, and the contract has nowhere to put it.
  { id: "orderDate", kind: "dropped" },
  // ⚠ THE COURIER IS STORED, THE NUMBER IS NOT. `shipping_code` on the order is the CARRIER (`jne`),
  // and the receipt is a FILE — there is no field anywhere for the tracking number itself, which is
  // the one thing a buyer asks for by name.
  { id: "receiptCode", kind: "dropped" },
  // ⚠ THE FILE IS NOT READ BY ANYTHING YET. The API that takes the uploaded receipt and answers with
  // the order id and the tracking number printed on it does not exist — so the autofill and the
  // "does this match the file?" check both run against a stand-in (`scanReceipt`).
  { id: "receiptScan", kind: "sample" },
  // The comparison runs and really does refuse the order; what is missing is the authority. A
  // server-side checker sees what this one cannot — the references other orders already carry.
  { id: "refsDistinct", kind: "derived" },
  // The courier and marketplace FORMATS are a table in `checks.ts`, written from what we have seen
  // rather than from anything official. They warn; they never refuse.
  { id: "formatRules", kind: "derived" },
  { id: "deadline", kind: "dropped" },
  { id: "buyerUsername", kind: "dropped" },
];

/** What the badges and the summary on this screen read. `ns` is where its copy lives. */
export const ORDER_FORM_PENDING: PendingList<PendingId> = { ns: "orderForm", parts: PARTS };
