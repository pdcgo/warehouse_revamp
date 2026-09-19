import { PaidRequestScreen } from "../_invoices/HistoryScreens";
import type { PaymentRow } from "../../financeFixtures";

// The payable paid request screen. It is the shared screen with the direction set —
// see _invoices/HistoryScreens for why these three are separate screens rather than tabs.
export const description =
  "PayableAdmin — paid request, the shared screen with the payable direction.";

export interface InvoicePayableAdminPaidRequestPageProps {
  requests: PaymentRow[];
  loading?: boolean;
}

export function InvoicePayableAdminPaidRequestPage({ requests, loading }: InvoicePayableAdminPaidRequestPageProps) {
  return <PaidRequestScreen direction="payable" requests={requests} loading={loading} />;
}
