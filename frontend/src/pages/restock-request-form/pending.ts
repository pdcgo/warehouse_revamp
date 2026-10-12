import type { PendingList, PendingPart } from "../../features/pending/registry";

// WHAT THE RESTOCK FORM CANNOT DO YET. The restock contract was rewritten to the decided design
// (the-restock-contract-changes-in-place), and the backend lags it: these fields are ACCEPTED BUT NOT STORED until the
// backend step, so what is typed into them is thrown away on save. See `features/pending` for the four kinds.
//
// ⚠ THE ORDER IS THE ORDER THE CONTROLS APPEAR IN — the lines come first, then the payment and parcel card — because the
// number on each mark is its position here.

/** One unwired part of the form. The id is also its i18n key (`restock.form.pending.<id>`). */
export type RestockFormPendingId = "lineSupplier" | "lineNote" | "financeAccount" | "shipment" | "receiptFile";

const PARTS: PendingPart<RestockFormPendingId>[] = [
  // a-line-connects-to-any-teams-supplier-from-a-popup, a-line-may-name-a-supplier-without-a-channel:
  // restock_items.supplier_id / supplier_channel_id have no column yet, and SupplierChannelByIds (the store's name
  // on a line) answers Unimplemented.
  { id: "lineSupplier", kind: "dropped" },
  // extra-units-are-added-by-the-selling-teams-edit, three-notes-one-writer-each: restock_items.note.
  { id: "lineNote", kind: "dropped" },
  // a-restock-names-its-paying-account: restocks.paid_from_account_id — required on the wire, kept nowhere yet.
  { id: "financeAccount", kind: "dropped" },
  // the-receipt-is-the-tracking-number: restocks.shipment_id.
  { id: "shipment", kind: "dropped" },
  // the-receipt-is-the-tracking-number: restocks.receipt_file.
  { id: "receiptFile", kind: "dropped" },
];

export const RESTOCK_FORM_PENDING: PendingList<RestockFormPendingId> = {
  ns: "restock.form",
  parts: PARTS,
};
