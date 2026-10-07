import { MetricScreen } from "../_statistics/MetricScreen";
import type { MetricRow } from "../../fixtures";

// CROSS-PRODUCT — which products are bought TOGETHER.
//
// It is the one dimension in the family with **no chart**, and that is a deliberate `chartable`
// false rather than an oversight. A cross-product breakdown is not a time series: the rows are
// pairs, not periods, and drawing them on a line would imply a progression from one pair to the
// next that does not exist. A bar chart of pair counts would be legible but would say less than the
// sorted table already does.
//
// Everything else — the measures, the margin rule, the export — is the shared screen, because those
// do not change with the dimension.
export const description =
  "Which products are bought together. The one dimension with NO chart: the rows are pairs, not periods, so a time series would imply a progression that does not exist.";

export interface StatisticProductCrossPageProps {
  rows: MetricRow[];
  loading?: boolean;
  isError?: boolean;
}

export function StatisticProductCrossPage({
  rows,
  loading,
  isError,
}: StatisticProductCrossPageProps) {
  return (
    <MetricScreen
      dimension="Product pair"
      title="Bought together"
      subtitle="Which products keep appearing on the same order."
      rows={rows}
      loading={loading}
      isError={isError}
      chartable={false}
    />
  );
}
