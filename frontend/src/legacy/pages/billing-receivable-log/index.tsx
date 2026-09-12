import { BillingLogScreen, logDescription } from "../_billing/BillingScreens";
import type { LedgerEntryRow } from "../../financeFixtures";

// The receivable log screen — the shared billing log view with the direction set. See
// _billing/BillingScreens for why the four billing views are each written once.
export const description = logDescription;

export interface BillingReceivableLogPageProps {
  entries: LedgerEntryRow[];
  loading?: boolean;
}

export function BillingReceivableLogPage({ entries, loading }: BillingReceivableLogPageProps) {
  return <BillingLogScreen direction="receivable" entries={entries} loading={loading} />;
}
