import { PaidRequestScreen } from "../_invoices/HistoryScreens";
import type { PaymentRow } from "../../financeFixtures";

// The receivable paid request screen. It is the shared screen with the direction set —
// see _invoices/HistoryScreens for why these three are separate screens rather than tabs.
export const description =
  "Receivable — paid request, the shared screen with the receivable direction.";

export interface InvoiceReceivablePaidRequestPageProps {
  requests: PaymentRow[];
  loading?: boolean;
}

export function InvoiceReceivablePaidRequestPage({ requests, loading }: InvoiceReceivablePaidRequestPageProps) {
  return <PaidRequestScreen direction="receivable" requests={requests} loading={loading} />;
}
