import { PaidHistoryScreen } from "../_invoices/HistoryScreens";
import type { PaymentRow } from "../../financeFixtures";

// The receivable paid history screen. It is the shared screen with the direction set —
// see _invoices/HistoryScreens for why these three are separate screens rather than tabs.
export const description =
  "Receivable — paid history, the shared screen with the receivable direction.";

export interface InvoiceReceivablePaidHistoryPageProps {
  payments: PaymentRow[];
  loading?: boolean;
}

export function InvoiceReceivablePaidHistoryPage({ payments, loading }: InvoiceReceivablePaidHistoryPageProps) {
  return <PaidHistoryScreen direction="receivable" payments={payments} loading={loading} />;
}
