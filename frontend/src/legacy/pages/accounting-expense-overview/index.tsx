import { useMemo, useState } from "react";
import { Heading, HStack, Stack, Text } from "@chakra-ui/react";
import { BarChart } from "../../components/charts/BarChart";
import { LineChart } from "../../components/charts/LineChart";
import { DataTable, type TableColumn } from "../../components/display/DataTable";
import { Summary } from "../../components/display/Summary";
import { PeriodGrainPicker } from "../../../components/datetime/PeriodGrainPicker";
import { StatisticCell } from "../../components/cells/StatisticCell";
import { ToneBadge } from "../../components/badges/ToneBadge";
import type { PeriodGrain } from "../../../lib/period";
import { formatRupiahCompact } from "../../../lib/money";
import type { ExpenseRow } from "../../financeFixtures";

// Expenses, ROLLED UP — where the money went, rather than what each line was.
//
// It is a separate screen from the expense list, and the distinction is between two genuinely
// different questions: the list answers "what is this charge and who is owed it back"; this answers
// "what are we actually spending money on". You cannot get the second by reading the first, because
// the answer is a shape rather than a set of rows.
//
// SHARE OF TOTAL is the column that makes it useful. An amount tells you what rent cost; a share
// tells you rent is two thirds of everything, which is the fact that changes a decision.
export const description =
  "Expenses rolled up by category — 'what are we spending money on', which the line-by-line list cannot answer. Share of total is the column that matters: an amount says what rent cost, a share says it is two thirds of everything.";

export interface AccountingExpenseOverviewPageProps {
  expenses: ExpenseRow[];
  loading?: boolean;
}

export function AccountingExpenseOverviewPage({
  expenses,
  loading,
}: AccountingExpenseOverviewPageProps) {
  const [grain, setGrain] = useState<PeriodGrain>("month");

  const byCategory = useMemo(() => {
    const buckets = new Map<string, bigint>();
    for (const e of expenses) {
      buckets.set(e.category, (buckets.get(e.category) ?? 0n) + e.amount);
    }

    const total = expenses.reduce((s, e) => s + e.amount, 0n);

    // Largest first — the biggest line is the one worth questioning, and alphabetical order buries
    // it among the small ones.
    return [...buckets.entries()]
      .map(([category, amount]) => ({
        category,
        amount,
        share: total > 0n ? (Number(amount) / Number(total)) * 100 : 0,
      }))
      .sort((a, b) => Number(b.amount - a.amount));
  }, [expenses]);

  const total = expenses.reduce((s, e) => s + e.amount, 0n);

  const columns: Array<TableColumn<(typeof byCategory)[number]>> = [
    { name: "Category", render: (r) => <ToneBadge tone="plain">{r.category}</ToneBadge> },
    {
      name: "Amount",
      align: "end",
      render: (r) => <StatisticCell value={r.amount} kind="price" compact />,
    },
    {
      name: "Share",
      align: "end",
      tooltip: "This category as a share of everything spent in the period.",
      render: (r) => (
        <Text fontVariantNumeric="tabular-nums" fontWeight="medium">
          {r.share.toFixed(1)}%
        </Text>
      ),
    },
  ];

  return (
    <Stack gap="section" data-testid="expense-overview-page">
      <HStack justify="space-between" wrap="wrap" gap="card">
        <Stack gap="0.5">
          <Heading size="md">Expense overview</Heading>
          <Text fontSize="sm" color="fg.muted">
            Where the money went, rather than what each line was.
          </Text>
        </Stack>
        <PeriodGrainPicker value={grain} onChange={setGrain} />
      </HStack>

      <Summary
        items={[
          { label: "Total spent", value: formatRupiahCompact(total), tone: "warning" },
          { label: "Categories", value: byCategory.length },
          {
            label: "Largest category",
            value: byCategory[0] ? `${byCategory[0].category} ${byCategory[0].share.toFixed(0)}%` : "—",
            tone: "active",
          },
        ]}
        loading={loading}
        columns={3}
      />

      <BarChart
        labels={byCategory.map((c) => c.category)}
        series={[{ name: "Spend", values: byCategory.map((c) => Number(c.amount) / 1_000_000) }]}
        loading={loading}
        formatValue={(v) => `${v.toFixed(1)}jt`}
      />

      <DataTable
        columns={columns}
        items={byCategory}
        loading={loading}
        emptyTitle="Nothing spent in this period"
        aria-label="Expenses by category"
      />

      <LineChart
        labels={["W1", "W2", "W3", "W4"]}
        series={[{ name: "Spend", values: [6.1, 4.8, 18.2, 2.3] }]}
        loading={loading}
        formatValue={(v) => `${v.toFixed(1)}jt`}
      />
    </Stack>
  );
}
