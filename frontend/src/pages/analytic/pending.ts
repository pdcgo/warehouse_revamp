import type { PendingList, PendingPart } from "../../features/pending/registry";

/** What the Analytic screen shows before its backend exists. The id is also its i18n key (`analytic.pending.<id>`). */
export type AnalyticPendingId = "figures" | "catalogue" | "pickers";

// The whole screen is built ahead of its backend (HARD RULE 6): every figure is invented, the metric list is a mirror of
// the decided proto options rather than read from the services, and the three entity pickers list sample entities.
const PARTS: PendingPart<AnalyticPendingId>[] = [
  { id: "figures", kind: "sample" },
  { id: "catalogue", kind: "sample" },
  { id: "pickers", kind: "sample" },
];

export const ANALYTIC_PENDING: PendingList<AnalyticPendingId> = { ns: "analytic", parts: PARTS };
