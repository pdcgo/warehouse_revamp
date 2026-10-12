import { BillingPaymentScreen, paymentDescription } from "../_billing/BillingScreens";
import type { PaymentRow } from "../../financeFixtures";

// The payable payment screen — the shared billing payment view with the direction set. See
// _billing/BillingScreens for why the four billing views are each written once.
export const description = paymentDescription;

export interface BillingPayablePaymentPageProps {
  payments: PaymentRow[];
  loading?: boolean;
}

export function BillingPayablePaymentPage({ payments, loading }: BillingPayablePaymentPageProps) {
  return <BillingPaymentScreen direction="payable" payments={payments} loading={loading} />;
}
