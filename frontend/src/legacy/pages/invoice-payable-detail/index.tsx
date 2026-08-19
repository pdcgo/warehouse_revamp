import { InvoiceDetailScreen } from "../_invoices/InvoiceDetailScreen";
import type { InvoiceLine, InvoiceRow, PaymentRow } from "../../financeFixtures";

// One payable invoice. The shared detail screen with the direction set — see
// _invoices/InvoiceDetailScreen for why the outstanding amount is the headline rather than the total.
export const description =
  "One payable invoice — the shared invoice detail, payable direction.";

export interface InvoicePayableDetailPageProps {
  invoice: InvoiceRow;
  lines: InvoiceLine[];
  payments: PaymentRow[];
}

export function InvoicePayableDetailPage({ invoice, lines, payments }: InvoicePayableDetailPageProps) {
  return (
    <InvoiceDetailScreen
      invoice={invoice}
      lines={lines}
      payments={payments}
      direction="payable"
    />
  );
}
