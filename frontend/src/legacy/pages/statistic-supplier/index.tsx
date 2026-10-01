import { MetricScreen } from "../_statistics/MetricScreen";
import type { MetricRow } from "../../fixtures";

// One of the eight statistics screens. It is the SAME screen as its siblings, asked about a
// different DIMENSION — so it supplies the dimension and nothing else.
//
// See _statistics/MetricScreen for why these are not eight separate implementations: porting them
// independently is how one gains a margin column and another keeps a stale label.
export const description =
  "Supplier performance — the shared statistics screen keyed to the Supplier dimension.";

export interface StatisticSupplierPageProps {
  rows: MetricRow[];
  loading?: boolean;
  isError?: boolean;
}

export function StatisticSupplierPage({ rows, loading, isError }: StatisticSupplierPageProps) {
  return (
    <MetricScreen
      dimension="Supplier"
      title="Supplier performance"
      subtitle="What each suppliers goods actually return."
      rows={rows}
      loading={loading}
      isError={isError}
    />
  );
}
