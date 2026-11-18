import type { PendingList, PendingPart } from "../../features/pending/registry";

// WHAT THE RESTOCK FORM CANNOT DO YET. Every field it shows is stored, and the check that a resi or an Order ID is not
// already on another restock (a-reference-in-use-stops-the-restock-form) is built on both halves: the screen asks the
// list's own search, and the server refuses a repeat of either within the team (inventory 00048's unique indexes), so two
// saves at the same moment cannot both pass. The Order ID's mark is gone with that. What is left is the resi on ANOTHER
// team's restock: the decision checks this team's only, and whether a resi another team holds should stop the form is
// not defined — so it is said here, not built.

/** One unwired part of the form. The id is also its i18n key (`restock.form.pending.<id>`). */
export type PendingId = "receiptCheck";

const PARTS: PendingPart<PendingId>[] = [
  // ⚠ OVER THIS TEAM'S RESTOCKS ONLY — on the screen and on the server alike. A resi already on another team's restock
  // is not caught: a selling team cannot list another team's, and the decision does not say it should be refused.
  { id: "receiptCheck", kind: "derived" },
];

/** What the badges and the summary on this page read. `ns` is where its copy lives. */
export const RESTOCK_FORM_PENDING: PendingList<PendingId> = { ns: "restock.form", parts: PARTS };
