import { Stack, Text } from "@chakra-ui/react";
import { FileText } from "lucide-react";
import { DataTable, type TableColumn } from "../../../legacy/components/display/DataTable";
import { DateCell } from "../../../legacy/components/cells/DateCell";
import { PriceText } from "../../../legacy/components/text/PriceText";
import { ProgressBar } from "../../../legacy/components/feedback/ProgressBar";
import { ToneBadge } from "../../../legacy/components/badges/ToneBadge";
import { ScreenHeader } from "../../components/display/ScreenHeader";
import type { FloorInvoiceRow } from "../../fixtures";

// ── INVOICES, AS THE WAREHOUSE SEES THEM ────────────────────────────────────────────────────────
//
// The warehouse bills its teams for storage and handling. This is the floor's window onto that, and
// it is deliberately much thinner than the selling app's invoicing screens.
//
// ⚠ THE INTERESTING DECISION IS WHAT IS *NOT* HERE. There is no issuing, no editing, no payment
// recording and no credit-note flow — all of which the selling app has. The warehouse supervisor
// needs to answer "has this team paid" before releasing goods, and nothing more. Putting the whole
// invoicing product on a floor tablet would give an operator with a scanner in one hand the ability
// to edit a financial document.
//
// ⚠ AND "PART PAID AND OVERDUE" IS TWO STATES AT ONCE, which a single status column cannot show.
// The status says overdue; the progress bar says how much has actually come in. Showing only one of
// them either hides a payment that was made or hides that it was late.
export const description =
  "The floor's window onto billing — read-only by design. A supervisor needs 'has this team paid' before releasing goods; issuing and editing an invoice from a scanner tablet is not a thing that should be possible.";

const STATUS_TONE = {
  draft: "plain",
  issued: "info",
  paid: "success",
  overdue: "error",
} as const;

export interface InvoicesPageProps {
  rows: FloorInvoiceRow[];
  loading?: boolean;
}

export function InvoicesPage({ rows, loading }: InvoicesPageProps) {
  const columns: Array<TableColumn<FloorInvoiceRow>> = [
    {
      name: "Invoice",
      sticky: "left",
      render: (row) => (
        <Stack gap="0">
          <Text fontSize="sm" fontFamily="mono">
            {row.number}
          </Text>
          <Text fontSize="xs" color="fg.muted">
            {row.team}
          </Text>
        </Stack>
      ),
    },
    { name: "Issued", render: (row) => <DateCell value={row.issuedAt} grain="date" /> },
    { name: "Due", render: (row) => <DateCell value={row.dueAt} grain="date" /> },
    { name: "Amount", align: "end", render: (row) => <PriceText amount={BigInt(row.amount)} /> },
    {
      // ⚠ THE PROGRESS BAR IS THE POINT. "Overdue" alone hides that two thirds arrived; "Rp 900.000
      // paid" alone hides that it is late. Both facts have to be on the row.
      name: "Paid",
      width: "40",
      tooltip: "How much of it has actually arrived. A status of 'overdue' does not say whether any has.",
      render: (row) => {
        const percent = row.amount ? (row.paid / row.amount) * 100 : 0;
        return (
          <Stack gap="1" data-testid="paid-progress" data-percent={Math.round(percent)}>
            <ProgressBar percent={percent} tone={percent >= 100 ? "success" : row.status === "overdue" ? "error" : "info"} />
            <Text fontSize="xs" color="fg.muted">
              {Math.round(percent)}% of <PriceText amount={BigInt(row.amount)} as="span" />
            </Text>
          </Stack>
        );
      },
    },
    { name: "Status", render: (row) => <ToneBadge tone={STATUS_TONE[row.status]}>{row.status}</ToneBadge> },
  ];

  return (
    <Stack gap="section" p="page" data-testid="invoices-page">
      <ScreenHeader icon={FileText} title="Invoices" />

      <Text fontSize="xs" color="fg.muted" data-testid="read-only-note">
        Read-only here. Issuing, editing and recording payment happen in the billing system.
      </Text>

      <DataTable
        columns={columns}
        items={rows}
        loading={loading}
        emptyTitle="No invoices"
        aria-label="Invoices"
        data-testid="invoices-table"
      />
    </Stack>
  );
}
