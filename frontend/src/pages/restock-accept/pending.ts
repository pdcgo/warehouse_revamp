import type { PendingList, PendingPart } from "../../features/pending/registry";

// WHAT THE ACCEPT SCREEN CANNOT DO YET. The count itself is real — received, broken, the placements and the courier's
// charge all reach the accept handler. What lags is everything the restock rewrite added a field for and the backend
// step has not stored yet (the-restock-contract-changes-in-place). In the order the screen shows them. See
// `features/pending` for the four kinds.

/** One unwired part of the page. The id is also its i18n key (`restock.accept.pending.<id>`). */
export type RestockAcceptPendingId = "courier" | "lineSupplier" | "lineNote" | "problemNotes";

const PARTS: PendingPart<RestockAcceptPendingId>[] = [
  // `restocks.shipment_id` is accepted but not stored — the real restock reads no courier, so this shows "—" there.
  { id: "courier", kind: "sample" },
  // A line's supplier and store (a-line-names-the-channel-it-was-bought-from) are not stored, and SupplierChannelByIds
  // answers Unimplemented — every line reads "not connected" against the real API.
  { id: "lineSupplier", kind: "sample" },
  // The selling team's line note — "extra stock" (extra-units-are-added-by-the-selling-teams-edit) — is not stored.
  { id: "lineNote", kind: "sample" },
  // The warehouse's notes on the broken and missing units (three-notes-one-writer-each) are sent and not kept.
  { id: "problemNotes", kind: "dropped" },
];

export const RESTOCK_ACCEPT_PENDING: PendingList<RestockAcceptPendingId> = {
  ns: "restock.accept",
  parts: PARTS,
};
