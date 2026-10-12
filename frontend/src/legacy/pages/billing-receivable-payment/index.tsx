import { BillingPaymentScreen, paymentDescription } from "../_billing/BillingScreens";
import type { PaymentRow } from "../../financeFixtures";

// The receivable payment screen — the shared billing payment view with the direction set. See
// _billing/BillingScreens for why the four billing views are each written once.
export const description = paymentDescription;

export interface BillingReceivablePaymentPageProps {
  payments: PaymentRow[];
  loading?: boolean;
}

export function BillingReceivablePaymentPage({ payments, loading }: BillingReceivablePaymentPageProps) {
  return <BillingPaymentScreen direction="receivable" payments={payments} loading={loading} />;
}
