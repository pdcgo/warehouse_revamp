import { useState } from "react";
import { Heading, HStack, Stack, Text } from "@chakra-ui/react";
import { Check, Download, X } from "lucide-react";
import { ActionCell } from "../../components/cells/ActionCell";
import { DateCell } from "../../components/cells/DateCell";
import { StatisticCell } from "../../components/cells/StatisticCell";
import { Alert } from "../../components/display/Alert";
import { BarChart } from "../../components/charts/BarChart";
import { DataTable, type TableColumn } from "../../components/display/DataTable";
import { Summary } from "../../components/display/Summary";
import { Button } from "../../components/inputs/Button";
import { SegmentedRadio } from "../../components/inputs/SegmentedRadio";
import { Pagination } from "../../../components/chrome/Pagination";
import { formatRupiahCompact } from "../../../lib/money";
import type { DayTotalRow, InvoiceDirection, PaymentRow } from "../../financeFixtures";

// The three HISTORY screens each direction has. They are separate screens rather than tabs on the
// invoice list because each answers a different question, and only one of them is about invoices:
//
//   day history   — "what happened on each day" · a period ledger, read to reconcile against a bank
//                   statement. Its rows are DAYS, not invoices.
//   paid history  — "what has been paid" · rows are PAYMENTS. Read when somebody asks whether a
//                   particular transfer landed.
//   paid requests — "what somebody claims to have paid" · rows are payments AWAITING CONFIRMATION.
//                   This is a work queue, and the only one of the three with actions on it.

// ── DAY HISTORY ─────────────────────────────────────────────────────────────────────────────────

export const dayHistoryDescription =
  "A period ledger whose rows are DAYS, not invoices — read to reconcile against a bank statement. The chart and the table are the same figures, because reconciling needs both the shape and the numbers.";

export interface DayHistoryScreenProps {
  direction: InvoiceDirection;
  days: DayTotalRow[];
  loading?: boolean;
}

export function DayHistoryScreen({ direction, days, loading }: DayHistoryScreenProps) {
  const [view, setView] = useState<"chart" | "table">("table");

  const totals = days.reduce(
    (acc, d) => ({
      invoiced: acc.invoiced + d.invoiced,
      paid: acc.paid + d.paid,
      outstanding: acc.outstanding + d.outstanding,
    }),
    { invoiced: 0n, paid: 0n, outstanding: 0n },
  );

  const columns: Array<TableColumn<DayTotalRow>> = [
    { name: "Day", render: (d) => <DateCell value={`${d.day}T00:00:00Z`} grain="date" /> },
    {
      name: "Invoiced",
      align: "end",
      render: (d) => <StatisticCell value={d.invoiced} kind="price" compact />,
    },
    { name: "Paid", align: "end", render: (d) => <StatisticCell value={d.paid} kind="price" compact /> },
    {
      name: "Outstanding",
      align: "end",
      render: (d) => <StatisticCell value={d.outstanding} kind="price" compact />,
    },
  ];

  return (
    <Stack gap="section" data-testid="day-history-screen" data-direction={direction}>
      <HStack justify="space-between" wrap="wrap" gap="card">
        <Heading size="md">Daily {direction === "payable" ? "payable" : "receivable"} history</Heading>
        <HStack gap="2">
          <SegmentedRadio
            items={[
              { value: "table", label: "Table" },
              { value: "chart", label: "Chart" },
            ]}
            value={view}
            onChange={(v) => setView(v as "chart" | "table")}
          />
          <Button tone="plain" variant="outline" icon={Download}>
            Export
          </Button>
        </HStack>
      </HStack>

      <Summary
        items={[
          { label: "Invoiced", value: formatRupiahCompact(totals.invoiced) },
          { label: "Paid", value: formatRupiahCompact(totals.paid), tone: "success" },
          { label: "Outstanding", value: formatRupiahCompact(totals.outstanding), tone: "warning" },
        ]}
        loading={loading}
        columns={3}
      />

      {view === "chart" ? (
        <BarChart
          labels={days.map((d) => d.day.slice(5))}
          series={[
            { name: "Invoiced", values: days.map((d) => Number(d.invoiced) / 1_000_000) },
            { name: "Paid", values: days.map((d) => Number(d.paid) / 1_000_000) },
          ]}
          loading={loading}
          formatValue={(v) => `${v.toFixed(0)}jt`}
        />
      ) : (
        <DataTable
          columns={columns}
          items={days}
          loading={loading}
          emptyTitle="No activity in this period"
          aria-label="Daily history"
        />
      )}
    </Stack>
  );
}

// ── PAID HISTORY ────────────────────────────────────────────────────────────────────────────────

export const paidHistoryDescription =
  "What has actually been paid — rows are PAYMENTS, not invoices. Read when somebody asks whether a particular transfer landed, so the reference is a first-class column.";

export interface PaidHistoryScreenProps {
  direction: InvoiceDirection;
  payments: PaymentRow[];
  loading?: boolean;
}

export function PaidHistoryScreen({ direction, payments, loading }: PaidHistoryScreenProps) {
  const [page, setPage] = useState(1);
  const confirmed = payments.filter((p) => p.confirmed);

  const columns: Array<TableColumn<PaymentRow>> = [
    { name: "When", render: (p) => <DateCell value={p.at} grain="date" /> },
    { name: "Invoice", key: "invoiceCode" },
    { name: "Method", key: "method" },
    // The reference is the string somebody quotes when asking "did this land?" — so it is a column,
    // not something buried in a detail panel.
    { name: "Reference", key: "reference" },
    {
      name: "Amount",
      align: "end",
      render: (p) => <StatisticCell value={p.amount} kind="price" compact />,
    },
  ];

  return (
    <Stack gap="section" data-testid="paid-history-screen" data-direction={direction}>
      <Heading size="md">Payment history</Heading>

      <Summary
        items={[
          { label: "Payments", value: confirmed.length },
          {
            label: "Total",
            value: formatRupiahCompact(confirmed.reduce((s, p) => s + p.amount, 0n)),
            tone: "success",
          },
        ]}
        loading={loading}
        columns={2}
      />

      <DataTable
        columns={columns}
        items={confirmed.slice((page - 1) * 20, page * 20)}
        loading={loading}
        emptyTitle="No payments yet"
        emptyContent="Confirmed payments appear here."
        aria-label="Payment history"
      />

      <Pagination count={confirmed.length} page={page} pageSize={20} onPageChange={setPage} showRange />
    </Stack>
  );
}

// ── PAID REQUESTS ───────────────────────────────────────────────────────────────────────────────

export const paidRequestDescription =
  "Payments somebody CLAIMS to have made, awaiting confirmation against a statement. A work queue — the only one of the three history screens with actions, and it says plainly that these are not yet counted.";

export interface PaidRequestScreenProps {
  direction: InvoiceDirection;
  requests: PaymentRow[];
  loading?: boolean;
}

export function PaidRequestScreen({ direction, requests, loading }: PaidRequestScreenProps) {
  const pending = requests.filter((p) => !p.confirmed);

  const columns: Array<TableColumn<PaymentRow>> = [
    { name: "Claimed", render: (p) => <DateCell value={p.at} grain="relative" /> },
    { name: "Invoice", key: "invoiceCode" },
    { name: "Reference", key: "reference" },
    {
      name: "Amount",
      align: "end",
      render: (p) => <StatisticCell value={p.amount} kind="price" compact />,
    },
    {
      name: "",
      width: "1%",
      render: () => (
        <ActionCell
          items={[
            { title: "Confirm", icon: Check, tone: "success" },
            { title: "Reject", icon: X, tone: "error" },
          ]}
        />
      ),
    },
  ];

  return (
    <Stack gap="section" data-testid="paid-request-screen" data-direction={direction}>
      <Heading size="md">Payment requests</Heading>

      {/* Said outright: these are NOT counted yet. Somebody reading a balance while these sit here
          needs to know the balance does not include them. */}
      <Alert tone="warning" data-testid="paid-request-warning">
        These payments have been claimed but not matched to a statement. They are not counted in any
        balance until confirmed.
      </Alert>

      <DataTable
        columns={columns}
        items={pending}
        loading={loading}
        emptyTitle="Nothing waiting"
        emptyContent="Claimed payments appear here until they are confirmed."
        aria-label="Payment requests"
      />

      {pending.length > 0 && (
        <Text fontSize="sm" color="fg.muted">
          {pending.length} claim{pending.length === 1 ? "" : "s"} worth{" "}
          {formatRupiahCompact(pending.reduce((s, p) => s + p.amount, 0n))} awaiting confirmation.
        </Text>
      )}
    </Stack>
  );
}
