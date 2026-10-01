import { CreateLogScreen, createLogDescription } from "../_billing/BillingScreens";

// Posting a billing entry by hand.
//
// The memo is REQUIRED. A hand-posted entry with no explanation is the one nobody can reconcile
// later, and it is the reason manual entries get distrusted as a class.
export const description = createLogDescription;

export interface BillingCreateLogPageProps {
  onSubmit?(values: { amount: string; memo: string; reference: string }): void;
  busy?: boolean;
}

export function BillingCreateLogPage({ onSubmit, busy }: BillingCreateLogPageProps) {
  return (
    <CreateLogScreen
      title="Post a billing entry"
      onSubmit={onSubmit}
      busy={busy}
    />
  );
}
