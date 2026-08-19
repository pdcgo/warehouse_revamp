import { BillingTimelineScreen, timelineDescription } from "../_billing/BillingScreens";
import type { LedgerEntryRow } from "../../financeFixtures";

// One counterparty's receivable movements, in order, with a running balance.
//
// It is the only one of the four billing views that answers "how did we get to this number" —
// the log lists movements but never accumulates them, and the team view shows the total without
// the path. See _billing/BillingScreens.
export const description = timelineDescription;

export interface BillingReceivableTimelinePageProps {
  counterparty: string;
  entries: LedgerEntryRow[];
  loading?: boolean;
}

export function BillingReceivableTimelinePage({ counterparty, entries, loading }: BillingReceivableTimelinePageProps) {
  return (
    <BillingTimelineScreen
      direction="receivable"
      counterparty={counterparty}
      entries={entries}
      loading={loading}
    />
  );
}
