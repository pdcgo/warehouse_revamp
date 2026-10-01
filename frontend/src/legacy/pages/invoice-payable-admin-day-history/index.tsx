import { DayHistoryScreen } from "../_invoices/HistoryScreens";
import type { DayTotalRow } from "../../financeFixtures";

// The payable day history screen. It is the shared screen with the direction set —
// see _invoices/HistoryScreens for why these three are separate screens rather than tabs.
export const description =
  "PayableAdmin — day history, the shared screen with the payable direction.";

export interface InvoicePayableAdminDayHistoryPageProps {
  days: DayTotalRow[];
  loading?: boolean;
}

export function InvoicePayableAdminDayHistoryPage({ days, loading }: InvoicePayableAdminDayHistoryPageProps) {
  return <DayHistoryScreen direction="payable" days={days} loading={loading} />;
}
