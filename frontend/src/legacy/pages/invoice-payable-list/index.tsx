import { InvoiceListScreen } from "../_invoices/InvoiceListScreen";
import type { InvoiceRow } from "../../financeFixtures";

// The PAYABLE invoice list — money we owe.
//
// It is the shared invoice list with the direction set; see _invoices/InvoiceListScreen.
//
// ⚠ It deliberately CANNOT create an invoice. What you owe arrives from somebody else — a supplier
// issues it — so offering a "New Invoice" button here would invite inventing a debt that no supplier
// has actually claimed. The receivable list is the direction that raises invoices.
export const description =
  "Payable invoices — the shared invoice list, payable direction. It cannot raise an invoice: what you owe arrives from a supplier, so creating one here would invent a debt.";

export interface InvoicePayableListPageProps {
  invoices: InvoiceRow[];
  loading?: boolean;
  isError?: boolean;
}

export function InvoicePayableListPage({
  invoices,
  loading,
  isError,
}: InvoicePayableListPageProps) {
  return (
    <InvoiceListScreen
      direction="payable"
      title="Payable"
      invoices={invoices}
      loading={loading}
      isError={isError}
    />
  );
}
