import { InvoiceListScreen } from "../_invoices/InvoiceListScreen";
import type { InvoiceRow } from "../../financeFixtures";

// The RECEIVABLE invoice list — money owed to us.
//
// It is the shared invoice list with the direction set; see _invoices/InvoiceListScreen for why the
// three variants are not three implementations.
//
// This is the direction that CAN create invoices: you raise what you are owed. Its payable
// counterpart deliberately cannot.
export const description =
  "Receivable invoices — the shared invoice list, receivable direction. The direction that can raise invoices, because you raise what you are owed.";

export interface InvoiceReceivableListPageProps {
  invoices: InvoiceRow[];
  loading?: boolean;
  isError?: boolean;
}

export function InvoiceReceivableListPage({
  invoices,
  loading,
  isError,
}: InvoiceReceivableListPageProps) {
  return (
    <InvoiceListScreen
      direction="receivable"
      title="Receivable"
      invoices={invoices}
      canCreate
      loading={loading}
      isError={isError}
    />
  );
}
