import type { PendingList, PendingPart } from "../../features/pending/registry";

// WHAT THE SUPPLIER REPORT CANNOT DO YET — see `features/pending` for the four kinds and why a badge's number is its
// position in this list.

/** One unwired part. The id is also its i18n key (`supplierReport.pending.<id>`). */
export type SupplierReportPendingId = "export" | "sales";

const PARTS: PendingPart<SupplierReportPendingId>[] = [
  // NOTHING BUILDS A FILE (owner: *"ada export di sini, kasih unimplemented jadinya"*). The button holds the action's
  // place, as on the account report — whether it carries the ranking with its figures, and this page or the whole
  // ranking, is still open. No contract serves a file.
  { id: "export", kind: "dropped" },
  // PENJUALAN beside Direstok (sales-sit-beside-restocked) — invented from the same row's restock: the supplier figures
  // count what came in from a supplier, and nothing yet counts what went out of it to a buyer.
  { id: "sales", kind: "sample" },
];

export const SUPPLIER_REPORT_PENDING: PendingList<SupplierReportPendingId> = { ns: "supplierReport", parts: PARTS };
