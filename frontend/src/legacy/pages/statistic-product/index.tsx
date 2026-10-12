import { MetricScreen } from "../_statistics/MetricScreen";
import type { MetricRow } from "../../fixtures";

// One of the eight statistics screens. It is the SAME screen as its siblings, asked about a
// different DIMENSION — so it supplies the dimension and nothing else.
//
// See _statistics/MetricScreen for why these are not eight separate implementations: porting them
// independently is how one gains a margin column and another keeps a stale label.
export const description =
  "Product performance — the shared statistics screen keyed to the Product dimension.";

export interface StatisticProductPageProps {
  rows: MetricRow[];
  loading?: boolean;
  isError?: boolean;
}

export function StatisticProductPage({ rows, loading, isError }: StatisticProductPageProps) {
  return (
    <MetricScreen
      dimension="Product"
      title="Product performance"
      subtitle="Which products earn, and which only move."
      rows={rows}
      loading={loading}
      isError={isError}
    />
  );
}
