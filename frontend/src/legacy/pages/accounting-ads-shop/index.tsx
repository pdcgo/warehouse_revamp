import { AdSpendScreen } from "../_accounting/AdSpendScreen";
import type { AdSpendRow } from "../../financeFixtures";

// Ad spend, grouped by shop.
//
// It is the shared ad screen with one prop changed; see _accounting/AdSpendScreen for why the
// four are not four implementations, and why ROAS is computed there rather than per screen.
export const description =
  "Ad spend by shop — the shared ad-spend screen, grouped by shop.";

export interface AccountingAdsShopPageProps {
  rows: AdSpendRow[];
  loading?: boolean;
  isError?: boolean;
}

export function AccountingAdsShopPage({ rows, loading, isError }: AccountingAdsShopPageProps) {
  return (
    <AdSpendScreen
      title="Ad spend by shop"
      subtitle="Which storefronts the advertising money went to."
      grouping="shop"
      rows={rows}
      loading={loading}
      isError={isError}
    />
  );
}
