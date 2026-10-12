import { BillingLogScreen, logDescription } from "../_billing/BillingScreens";
import type { LedgerEntryRow } from "../../financeFixtures";

// The payable log screen — the shared billing log view with the direction set. See
// _billing/BillingScreens for why the four billing views are each written once.
export const description = logDescription;

export interface BillingPayableLogPageProps {
  entries: LedgerEntryRow[];
  loading?: boolean;
}

export function BillingPayableLogPage({ entries, loading }: BillingPayableLogPageProps) {
  return <BillingLogScreen direction="payable" entries={entries} loading={loading} />;
}
