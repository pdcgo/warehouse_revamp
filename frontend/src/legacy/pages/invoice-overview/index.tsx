import { Heading, SimpleGrid, Stack, Text } from "@chakra-ui/react";
import { ArrowDownLeft, ArrowUpRight, TriangleAlert } from "lucide-react";
import { BarChart } from "../../components/charts/BarChart";
import { Card } from "../../components/display/Card";
import { DataTable, type TableColumn } from "../../components/display/DataTable";
import { Statistic } from "../../components/display/Statistic";
import { Button } from "../../components/inputs/Button";
import { DateCell } from "../../components/cells/DateCell";
import { StatisticCell } from "../../components/cells/StatisticCell";
import { formatRupiahCompact } from "../../../lib/money";
import type { DayTotalRow, InvoiceRow } from "../../financeFixtures";
import { InvoiceStatusBadge } from "../_invoices/InvoiceStatusBadge";

// The invoicing OVERVIEW — both directions on one screen.
//
// It exists because the two lists cannot answer the question people actually arrive with: not "what
// do we owe" or "what are we owed" separately, but whether the two are in balance and what is about
// to go wrong. Reading that off two screens means holding one number in your head while you navigate
// to the other.
//
// So the screen leads with the NET position and puts what is overdue — in both directions — directly
// beneath it. Everything else is a link into the list that owns it.
export const description =
  "Both invoice directions on one screen. The two lists cannot answer whether payable and receivable are in balance, which is the question people actually arrive with — so this leads with the net position and what is overdue in either direction.";

export interface InvoiceOverviewPageProps {
  invoices: InvoiceRow[];
  days: DayTotalRow[];
  loading?: boolean;
}

export function InvoiceOverviewPage({ invoices, days, loading }: InvoiceOverviewPageProps) {
  const open = invoices.filter((i) => i.status !== "paid" && i.status !== "void");

  const owed = open
    .filter((i) => i.direction === "receivable")
    .reduce((s, i) => s + (i.total - i.paid), 0n);
  const owing = open
    .filter((i) => i.direction === "payable")
    .reduce((s, i) => s + (i.total - i.paid), 0n);

  const overdue = invoices.filter((i) => i.status === "overdue");

  const columns: Array<TableColumn<InvoiceRow>> = [
    { name: "Invoice", key: "code" },
    { name: "Counterparty", key: "counterparty" },
    {
      name: "Direction",
      render: (row) => (
        <Text fontSize="sm">{row.direction === "payable" ? "We owe" : "Owed to us"}</Text>
      ),
    },
    { name: "Status", render: (row) => <InvoiceStatusBadge status={row.status} /> },
    { name: "Due", render: (row) => <DateCell value={row.dueAt} grain="relative" /> },
    {
      name: "Outstanding",
      align: "end",
      render: (row) => <StatisticCell value={row.total - row.paid} kind="price" compact />,
    },
  ];

  return (
    <Stack gap="section" data-testid="invoice-overview-page">
      <Heading size="md">Invoicing</Heading>

      <SimpleGrid columns={{ base: 1, md: 3 }} gap="card">
        <Statistic title="Owed to us" icon={ArrowDownLeft} tone="success" loading={loading}>
          {formatRupiahCompact(owed)}
        </Statistic>
        <Statistic title="We owe" icon={ArrowUpRight} tone="warning" loading={loading}>
          {formatRupiahCompact(owing)}
        </Statistic>
        {/* The NET position — the number neither list can show. */}
        <Statistic
          title="Net position"
          icon={owed >= owing ? ArrowDownLeft : ArrowUpRight}
          tone={owed >= owing ? "success" : "error"}
          loading={loading}
          help={owed >= owing ? "In our favour" : "Against us"}
        >
          {formatRupiahCompact(owed > owing ? owed - owing : owing - owed)}
        </Statistic>
      </SimpleGrid>

      <Card>
        <Stack gap="2">
          <Text fontSize="sm" fontWeight="medium">
            Invoiced and paid, by day
          </Text>
          <BarChart
            labels={days.map((d) => d.day.slice(5))}
            series={[
              { name: "Invoiced", values: days.map((d) => Number(d.invoiced) / 1_000_000) },
              { name: "Paid", values: days.map((d) => Number(d.paid) / 1_000_000) },
            ]}
            loading={loading}
            height={200}
            formatValue={(v) => `${v.toFixed(0)}jt`}
          />
        </Stack>
      </Card>

      <Stack gap="2">
        <Stack direction="row" justify="space-between" align="center">
          <Text fontWeight="medium" display="flex" alignItems="center" gap="2">
            <TriangleAlert size={16} /> Overdue, both directions
          </Text>
          <Button size="xs" tone="plain" variant="ghost" href="/invoices/receivable">
            Open receivable
          </Button>
        </Stack>

        <DataTable
          columns={columns}
          items={overdue}
          size="sm"
          loading={loading}
          emptyTitle="Nothing overdue"
          emptyContent="Every invoice is within its terms."
          aria-label="Overdue invoices"
        />
      </Stack>
    </Stack>
  );
}
