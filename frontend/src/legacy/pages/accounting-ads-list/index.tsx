import { AdSpendScreen } from "../_accounting/AdSpendScreen";
import type { AdSpendRow } from "../../financeFixtures";

// Ad spend, grouped by nothing — the raw lines.
//
// It is the shared ad screen with one prop changed; see _accounting/AdSpendScreen for why the
// four are not four implementations, and why ROAS is computed there rather than per screen.
export const description =
  "Ad spend — the shared ad-spend screen, grouped by nothing.";

export interface AccountingAdsListPageProps {
  rows: AdSpendRow[];
  loading?: boolean;
  isError?: boolean;
}

export function AccountingAdsListPage({ rows, loading, isError }: AccountingAdsListPageProps) {
  return (
    <AdSpendScreen
      title="Ad spend"
      subtitle="Every campaign line, ungrouped."
      grouping="none"
      rows={rows}
      loading={loading}
      isError={isError}
    />
  );
}
