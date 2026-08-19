import { BillingTimelineScreen, timelineDescription } from "../_billing/BillingScreens";
import type { LedgerEntryRow } from "../../financeFixtures";

// One counterparty's payable movements, in order, with a running balance.
//
// It is the only one of the four billing views that answers "how did we get to this number" —
// the log lists movements but never accumulates them, and the team view shows the total without
// the path. See _billing/BillingScreens.
export const description = timelineDescription;

export interface BillingPayableTimelinePageProps {
  counterparty: string;
  entries: LedgerEntryRow[];
  loading?: boolean;
}

export function BillingPayableTimelinePage({ counterparty, entries, loading }: BillingPayableTimelinePageProps) {
  return (
    <BillingTimelineScreen
      direction="payable"
      counterparty={counterparty}
      entries={entries}
      loading={loading}
    />
  );
}
