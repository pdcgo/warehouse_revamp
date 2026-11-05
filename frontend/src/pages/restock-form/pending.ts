import type { PendingList, PendingPart } from "../../features/pending/registry";

// WHAT THE RESTOCK FORM CANNOT DO YET. Every field it shows is stored; what is not finished is the check that a resi or
// an Order ID is not already on another restock (a-reference-in-use-stops-the-restock-form). The form asks the list's
// own search, so the check is real — but it can only see what a selling team may list, and nothing behind it refuses.

/** One unwired part of the form. The id is also its i18n key (`restock.form.pending.<id>`). */
export type PendingId = "invoiceRefCheck" | "receiptCheck";

const PARTS: PendingPart<PendingId>[] = [
  // ⚠ CHECKED ON THE SCREEN ONLY. Nothing on the server refuses a second restock with the same Order ID, so two saves
  // at the same moment both pass, and so does anything that does not come through this form.
  { id: "invoiceRefCheck", kind: "derived" },
  // ⚠ …and the resi the same way, over THIS TEAM's restocks only — a selling team cannot list another team's, so a resi
  // already on another team's restock is not caught.
  { id: "receiptCheck", kind: "derived" },
];

/** What the badges and the summary on this page read. `ns` is where its copy lives. */
export const RESTOCK_FORM_PENDING: PendingList<PendingId> = { ns: "restock.form", parts: PARTS };
