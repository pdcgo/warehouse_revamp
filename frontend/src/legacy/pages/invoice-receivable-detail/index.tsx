import { InvoiceDetailScreen } from "../_invoices/InvoiceDetailScreen";
import type { InvoiceLine, InvoiceRow, PaymentRow } from "../../financeFixtures";

// One receivable invoice. The shared detail screen with the direction set — see
// _invoices/InvoiceDetailScreen for why the outstanding amount is the headline rather than the total.
export const description =
  "One receivable invoice — the shared invoice detail, receivable direction.";

export interface InvoiceReceivableDetailPageProps {
  invoice: InvoiceRow;
  lines: InvoiceLine[];
  payments: PaymentRow[];
}

export function InvoiceReceivableDetailPage({ invoice, lines, payments }: InvoiceReceivableDetailPageProps) {
  return (
    <InvoiceDetailScreen
      invoice={invoice}
      lines={lines}
      payments={payments}
      direction="receivable"
    />
  );
}
