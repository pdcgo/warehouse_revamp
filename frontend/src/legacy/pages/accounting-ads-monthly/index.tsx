import { AdSpendScreen } from "../_accounting/AdSpendScreen";
import type { AdSpendRow } from "../../financeFixtures";

// Ad spend, grouped by month.
//
// It is the shared ad screen with one prop changed; see _accounting/AdSpendScreen for why the
// four are not four implementations, and why ROAS is computed there rather than per screen.
export const description =
  "Ad spend by month — the shared ad-spend screen, grouped by month.";

export interface AccountingAdsMonthlyPageProps {
  rows: AdSpendRow[];
  loading?: boolean;
  isError?: boolean;
}

export function AccountingAdsMonthlyPage({ rows, loading, isError }: AccountingAdsMonthlyPageProps) {
  return (
    <AdSpendScreen
      title="Ad spend by month"
      subtitle="Monthly totals, for judging the trend rather than the day."
      grouping="month"
      rows={rows}
      loading={loading}
      isError={isError}
    />
  );
}
