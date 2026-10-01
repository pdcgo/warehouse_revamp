import { MetricScreen } from "../_statistics/MetricScreen";
import type { MetricRow } from "../../fixtures";

// One of the eight statistics screens. It is the SAME screen as its siblings, asked about a
// different DIMENSION — so it supplies the dimension and nothing else.
//
// See _statistics/MetricScreen for why these are not eight separate implementations: porting them
// independently is how one gains a margin column and another keeps a stale label.
export const description =
  "Cost breakdown — the shared statistics screen keyed to the Cost centre dimension.";

export interface StatisticCostPageProps {
  rows: MetricRow[];
  loading?: boolean;
  isError?: boolean;
}

export function StatisticCostPage({ rows, loading, isError }: StatisticCostPageProps) {
  return (
    <MetricScreen
      dimension="Cost centre"
      title="Cost breakdown"
      subtitle="Where the money went, by cost centre."
      rows={rows}
      loading={loading}
      isError={isError}
    />
  );
}
