import { MetricScreen } from "../_statistics/MetricScreen";
import type { MetricRow } from "../../fixtures";

// One of the eight statistics screens. It is the SAME screen as its siblings, asked about a
// different DIMENSION — so it supplies the dimension and nothing else.
//
// See _statistics/MetricScreen for why these are not eight separate implementations: porting them
// independently is how one gains a margin column and another keeps a stale label.
export const description =
  "Shop performance — the shared statistics screen keyed to the Shop dimension.";

export interface StatisticShopPageProps {
  rows: MetricRow[];
  loading?: boolean;
  isError?: boolean;
}

export function StatisticShopPage({ rows, loading, isError }: StatisticShopPageProps) {
  return (
    <MetricScreen
      dimension="Shop"
      title="Shop performance"
      subtitle="Storefront by storefront, across every marketplace."
      rows={rows}
      loading={loading}
      isError={isError}
    />
  );
}
