import { DayHistoryScreen } from "../_invoices/HistoryScreens";
import type { DayTotalRow } from "../../financeFixtures";

// The receivable day history screen. It is the shared screen with the direction set —
// see _invoices/HistoryScreens for why these three are separate screens rather than tabs.
export const description =
  "Receivable — day history, the shared screen with the receivable direction.";

export interface InvoiceReceivableDayHistoryPageProps {
  days: DayTotalRow[];
  loading?: boolean;
}

export function InvoiceReceivableDayHistoryPage({ days, loading }: InvoiceReceivableDayHistoryPageProps) {
  return <DayHistoryScreen direction="receivable" days={days} loading={loading} />;
}
