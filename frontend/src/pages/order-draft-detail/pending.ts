import type { PendingList, PendingPart } from "../../features/pending/registry";
import { ORDER_FORM_PENDING } from "../../features/orders/form/pending";
import type { PendingId as FormPendingId } from "../../features/orders/form/pending";

// WHAT THE DRAFT PAGE CANNOT DO YET — the order form's list, plus what only a draft is missing.
//
// ⚠ APPENDED, so every card's badge keeps its number: the shared cards mark themselves against
// `ORDER_FORM_PENDING`, and a badge's number is its position.

export type PendingId =
  | FormPendingId
  | "draftKeeps"
  | "sellPrice"
  | "rowBundle"
  | "rowSplit"
  | "makeBundle"
  | "listingQty";

const DRAFT_PARTS: PendingPart<PendingId>[] = [
  // A draft stores the shop, the warehouse, the customer, the courier and the lines. The receipt, the
  // references, the tracking number, the note, the dates and the buyer's username are on screen and
  // are NOT kept — the owner accepted that (`the-draft-page-wears-the-order-form`).
  { id: "draftKeeps", kind: "dropped" },
  // The sell price starts as the rows' platform prices and can be typed over — but a draft has no field
  // for it, so a typed one is not kept. It could arrive with the draft from the start (the app reads
  // the order total too), which is the contract question in `design_clarify.md`.
  { id: "sellPrice", kind: "dropped" },
  // A draft line has one `product_id`. A row mapped to a bundle is shown and counted, saved UNMAPPED,
  // and blocks Promote.
  { id: "rowBundle", kind: "dropped" },
  // …and so is a row split into several products.
  { id: "rowSplit", kind: "dropped" },
  // "Make it a bundle" has nowhere to write a bundle — templates are still a sample.
  { id: "makeBundle", kind: "missing" },
  // A draft line holds ONE quantity. A count that differs from the listing is saved over it, so the
  // listing's own number — and the warning comparing the two — is gone the next time the draft opens.
  { id: "listingQty", kind: "dropped" },
];

export const ORDER_DRAFT_PENDING: PendingList<PendingId> = {
  ns: "orderForm",
  parts: [...ORDER_FORM_PENDING.parts, ...DRAFT_PARTS],
};
