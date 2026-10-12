import type { PendingList, PendingPart } from "../../features/pending/registry";

// WHAT THE ACCOUNT REPORT CANNOT DO YET — see `features/pending` for the four kinds and why a badge's number is its
// position in this list.

/** One unwired part. The id is also its i18n key (`financialAccounts.report.pending.<id>`). */
export type ReportPendingId = "export";

const PARTS: PendingPart<ReportPendingId>[] = [
  // NOTHING BUILDS A FILE (owner: *"sama action export, kasih warning unimplemented"*). The button is here so the action
  // has its place and a shape to argue about — the periods with their nine types, or the account and provider
  // breakdowns too; this page or the whole window. No contract serves a file, as on the orders list.
  { id: "export", kind: "dropped" },
];

export const REPORT_PENDING: PendingList<ReportPendingId> = { ns: "financialAccounts.report", parts: PARTS };
