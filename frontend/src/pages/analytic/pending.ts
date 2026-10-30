import type { PendingList, PendingPart } from "../../features/pending/registry";

/** What the Analytic screen shows before its backend exists. The id is also its i18n key (`analytic.pending.<id>`). */
export type AnalyticPendingId = "figures" | "catalogue" | "pickers";

// Built ahead of most of its backend (HARD RULE 6). The five ORDER metrics are served by selling_service and read off its
// contract; every other metric's figures are still invented and its entry a mirror of the decided proto options; and the
// product and supplier pickers list sample entities. Each entry goes when the last metric it covers is served.
const PARTS: PendingPart<AnalyticPendingId>[] = [
  { id: "figures", kind: "sample" },
  { id: "catalogue", kind: "sample" },
  { id: "pickers", kind: "sample" },
];

export const ANALYTIC_PENDING: PendingList<AnalyticPendingId> = { ns: "analytic", parts: PARTS };
