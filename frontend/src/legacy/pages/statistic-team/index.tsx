import { MetricScreen } from "../_statistics/MetricScreen";
import type { MetricRow } from "../../fixtures";

// One of the eight statistics screens. It is the SAME screen as its siblings, asked about a
// different DIMENSION — so it supplies the dimension and nothing else.
//
// See _statistics/MetricScreen for why these are not eight separate implementations: porting them
// independently is how one gains a margin column and another keeps a stale label.
export const description =
  "Team performance — the shared statistics screen keyed to the Team dimension.";

export interface StatisticTeamPageProps {
  rows: MetricRow[];
  loading?: boolean;
  isError?: boolean;
}

export function StatisticTeamPage({ rows, loading, isError }: StatisticTeamPageProps) {
  return (
    <MetricScreen
      dimension="Team"
      title="Team performance"
      subtitle="How each selling team is doing against its own stock."
      rows={rows}
      loading={loading}
      isError={isError}
    />
  );
}
