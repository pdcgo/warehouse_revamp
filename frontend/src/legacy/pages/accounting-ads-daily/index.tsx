import { AdSpendScreen } from "../_accounting/AdSpendScreen";
import type { AdSpendRow } from "../../financeFixtures";

// Ad spend, grouped by day.
//
// It is the shared ad screen with one prop changed; see _accounting/AdSpendScreen for why the
// four are not four implementations, and why ROAS is computed there rather than per screen.
export const description =
  "Ad spend by day — the shared ad-spend screen, grouped by day.";

export interface AccountingAdsDailyPageProps {
  rows: AdSpendRow[];
  loading?: boolean;
  isError?: boolean;
}

export function AccountingAdsDailyPage({ rows, loading, isError }: AccountingAdsDailyPageProps) {
  return (
    <AdSpendScreen
      title="Ad spend by day"
      subtitle="Daily totals across every shop and channel."
      grouping="day"
      rows={rows}
      loading={loading}
      isError={isError}
    />
  );
}
