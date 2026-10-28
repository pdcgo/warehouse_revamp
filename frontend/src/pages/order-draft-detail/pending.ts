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
  | "rowBundle"
  | "rowSplit"
  | "listingQty";

const DRAFT_PARTS: PendingPart<PendingId>[] = [
  // A draft stores the shop, the warehouse, the customer, the buyer's username (00021), the courier, the
  // lines, the platform's two dates (00020) and the sell price (00022). The receipt, the references, the
  // tracking number and the note are on screen and are NOT kept — the owner accepted that
  // (`the-draft-page-wears-the-order-form`).
  { id: "draftKeeps", kind: "dropped" },
  // (The sell price's mark is gone: it is `platform_total` on the draft now, and Promote copies it —
  // platform-total-is-required-at-finalize.)
  // A draft line has one `product_id`. A row mapped to a bundle is shown and counted, saved UNMAPPED,
  // and blocks Promote.
  { id: "rowBundle", kind: "dropped" },
  // …and so is a row split into several products.
  { id: "rowSplit", kind: "dropped" },
  // A draft line holds ONE quantity. A count that differs from the listing is saved over it, so the
  // listing's own number — and the warning comparing the two — is gone the next time the draft opens.
  { id: "listingQty", kind: "dropped" },
];

export const ORDER_DRAFT_PENDING: PendingList<PendingId> = {
  ns: "orderForm",
  parts: [...ORDER_FORM_PENDING.parts, ...DRAFT_PARTS],
};
