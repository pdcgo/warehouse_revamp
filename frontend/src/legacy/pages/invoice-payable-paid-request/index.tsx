import { PaidRequestScreen } from "../_invoices/HistoryScreens";
import type { PaymentRow } from "../../financeFixtures";

// The payable paid request screen. It is the shared screen with the direction set —
// see _invoices/HistoryScreens for why these three are separate screens rather than tabs.
export const description =
  "Payable — paid request, the shared screen with the payable direction.";

export interface InvoicePayablePaidRequestPageProps {
  requests: PaymentRow[];
  loading?: boolean;
}

export function InvoicePayablePaidRequestPage({ requests, loading }: InvoicePayablePaidRequestPageProps) {
  return <PaidRequestScreen direction="payable" requests={requests} loading={loading} />;
}
