import { InvoiceListScreen } from "../_invoices/InvoiceListScreen";
import type { InvoiceRow } from "../../financeFixtures";

// PAYABLE ACROSS EVERY TEAM — the admin view.
//
// Same shared screen, plus a TEAM column, and that column is the entire difference. On a single
// team's payable list every row is implicitly "ours"; here the rows come from many teams, and
// without naming which, two identical-looking debts to the same supplier are indistinguishable.
//
// It also cannot create invoices, for the same reason its per-team counterpart cannot.
export const description =
  "Payable across every team — the shared invoice list plus a team column, which is the whole difference: without it, two identical debts to one supplier from different teams are indistinguishable.";

export interface InvoicePayableAdminListPageProps {
  invoices: InvoiceRow[];
  loading?: boolean;
  isError?: boolean;
}

export function InvoicePayableAdminListPage({
  invoices,
  loading,
  isError,
}: InvoicePayableAdminListPageProps) {
  return (
    <InvoiceListScreen
      direction="payable"
      title="Payable — all teams"
      invoices={invoices}
      showTeam
      loading={loading}
      isError={isError}
    />
  );
}
