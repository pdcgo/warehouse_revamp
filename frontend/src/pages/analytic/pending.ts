import type { PendingList, PendingPart } from "../../features/pending/registry";

/** What the Analytic screen shows before its backend exists. The id is also its i18n key (`analytic.pending.<id>`). */
export type AnalyticPendingId = "figures" | "catalogue";

// Built ahead of most of its backend (HARD RULE 6). The five ORDER metrics and Warehouse Fee are served by selling_service and the two
// SETTLEMENT metrics by settlement_service, each read off its contract; every other metric's figures are still invented
// and its entry a mirror of the decided proto options. Each entry goes when the last metric it covers is served. (The
// product and supplier filters searched sample entries until Lost stock was served; they search the real ones now.)
const PARTS: PendingPart<AnalyticPendingId>[] = [
  { id: "figures", kind: "sample" },
  { id: "catalogue", kind: "sample" },
];

export const ANALYTIC_PENDING: PendingList<AnalyticPendingId> = { ns: "analytic", parts: PARTS };
