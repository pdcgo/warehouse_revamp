import { CreateLogScreen, createLogDescription } from "../_billing/BillingScreens";

// Posting an ADJUSTMENT — an entry whose purpose is to correct an earlier one.
//
// It demands one thing the ordinary entry does not: WHAT IT CORRECTS. An adjustment that does not
// say what it is fixing is indistinguishable from an unexplained change to the books, and it is
// exactly the entry an auditor stops on.
export const description = createLogDescription;

export interface BillingCreateLogAdjustmentPageProps {
  onSubmit?(values: { amount: string; memo: string; reference: string }): void;
  busy?: boolean;
}

export function BillingCreateLogAdjustmentPage({ onSubmit, busy }: BillingCreateLogAdjustmentPageProps) {
  return (
    <CreateLogScreen
      title="Post an adjustment"
      adjustment
      onSubmit={onSubmit}
      busy={busy}
    />
  );
}
