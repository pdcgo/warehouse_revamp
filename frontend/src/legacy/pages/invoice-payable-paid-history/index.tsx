import { PaidHistoryScreen } from "../_invoices/HistoryScreens";
import type { PaymentRow } from "../../financeFixtures";

// The payable paid history screen. It is the shared screen with the direction set —
// see _invoices/HistoryScreens for why these three are separate screens rather than tabs.
export const description =
  "Payable — paid history, the shared screen with the payable direction.";

export interface InvoicePayablePaidHistoryPageProps {
  payments: PaymentRow[];
  loading?: boolean;
}

export function InvoicePayablePaidHistoryPage({ payments, loading }: InvoicePayablePaidHistoryPageProps) {
  return <PaidHistoryScreen direction="payable" payments={payments} loading={loading} />;
}
