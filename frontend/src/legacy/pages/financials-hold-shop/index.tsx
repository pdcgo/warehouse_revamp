import { HoldScreen, type HoldRow } from "../_financials/HoldScreen";

// Held funds BY SHOP — which storefront the money is stuck behind.
//
// The shop view is the one used to chase, because a marketplace hold is a shop-level fact: you
// contact the account that holds it. The team view aggregates the same money for a different
// question. See _financials/HoldScreen for why they are one screen.
export const description =
  "Held funds by shop — the view used to chase, because a marketplace hold belongs to a storefront account.";

export interface FinancialsHoldShopPageProps {
  rows: HoldRow[];
  loading?: boolean;
  isError?: boolean;
}

export function FinancialsHoldShopPage({ rows, loading, isError }: FinancialsHoldShopPageProps) {
  return (
    <HoldScreen
      subjectLabel="Shop"
      title="Held funds by shop"
      rows={rows}
      loading={loading}
      isError={isError}
    />
  );
}
