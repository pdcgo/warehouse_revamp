import { useMemo, useState } from "react";
import { Heading, HStack, Stack, Text } from "@chakra-ui/react";
import { BarChart } from "../../components/charts/BarChart";
import { LineChart } from "../../components/charts/LineChart";
import { DataTable, type TableColumn } from "../../components/display/DataTable";
import { Summary } from "../../components/display/Summary";
import { SegmentedRadio } from "../../components/inputs/SegmentedRadio";
import { PeriodGrainPicker } from "../../../components/datetime/PeriodGrainPicker";
import { StatisticCell } from "../../components/cells/StatisticCell";
import type { PeriodGrain } from "../../../lib/period";
import { formatRupiahCompact } from "../../../lib/money";
import type { LedgerEntryRow } from "../../financeFixtures";

// LEDGER STATISTICS — the shape of the journal rather than its contents.
//
// It answers questions the entry list cannot: is posting volume rising, which accounts move most,
// are debits and credits arriving evenly. Those are questions about the BOOKKEEPING itself, and they
// are usually asked when something feels wrong — a month that looks quiet, an account that suddenly
// has forty entries.
//
// ⚠ IT COUNTS ENTRIES AS WELL AS TOTALLING THEM, and the count is listed first. A month with the
// same total but three times the entries is a month somebody worked very differently, and a screen
// that only showed money would hide that completely.
export const description =
  "The shape of the journal rather than its contents — posting volume, which accounts move most, whether debits and credits arrive evenly. It counts entries as well as totalling them, because the count is what reveals a month somebody worked differently.";

export interface AccountingLedgerStatisticPageProps {
  entries: LedgerEntryRow[];
  loading?: boolean;
}

export function AccountingLedgerStatisticPage({
  entries,
  loading,
}: AccountingLedgerStatisticPageProps) {
  const [grain, setGrain] = useState<PeriodGrain>("month");
  const [view, setView] = useState<"table" | "chart">("chart");

  const byAccount = useMemo(() => {
    const buckets = new Map<string, { account: string; count: number; debit: bigint; credit: bigint }>();

    for (const e of entries) {
      const current = buckets.get(e.account) ?? { account: e.account, count: 0, debit: 0n, credit: 0n };
      current.count += 1;
      current.debit += e.debit;
      current.credit += e.credit;
      buckets.set(e.account, current);
    }

    // Most active first — the account that moved most is the one worth looking at when something
    // feels wrong.
    return [...buckets.values()].sort((a, b) => b.count - a.count);
  }, [entries]);

  const totals = entries.reduce(
    (acc, e) => ({ debit: acc.debit + e.debit, credit: acc.credit + e.credit }),
    { debit: 0n, credit: 0n },
  );

  const columns: Array<TableColumn<(typeof byAccount)[number]>> = [
    { name: "Account", key: "account" },
    // Listed FIRST — see the note above.
    { name: "Entries", key: "count", align: "end" },
    {
      name: "Debits",
      align: "end",
      render: (r) => <StatisticCell value={r.debit} kind="price" compact />,
    },
    {
      name: "Credits",
      align: "end",
      render: (r) => <StatisticCell value={r.credit} kind="price" compact />,
    },
  ];

  return (
    <Stack gap="section" data-testid="ledger-statistic-page">
      <HStack justify="space-between" wrap="wrap" gap="card">
        <Stack gap="0.5">
          <Heading size="md">Ledger statistics</Heading>
          <Text fontSize="sm" color="fg.muted">
            The shape of the journal, not its contents.
          </Text>
        </Stack>
        <HStack gap="2">
          <PeriodGrainPicker value={grain} onChange={setGrain} />
          <SegmentedRadio
            items={[
              { value: "chart", label: "Chart" },
              { value: "table", label: "Table" },
            ]}
            value={view}
            onChange={(v) => setView(v as "table" | "chart")}
          />
        </HStack>
      </HStack>

      <Summary
        items={[
          { label: "Entries posted", value: entries.length },
          { label: "Accounts touched", value: byAccount.length },
          { label: "Debits", value: formatRupiahCompact(totals.debit) },
          { label: "Credits", value: formatRupiahCompact(totals.credit) },
        ]}
        loading={loading}
      />

      {view === "chart" ? (
        <Stack gap="section" data-testid="ledger-statistic-charts">
          <BarChart
            labels={byAccount.map((a) => a.account)}
            series={[{ name: "Entries", values: byAccount.map((a) => a.count) }]}
            loading={loading}
          />
          <LineChart
            labels={["W1", "W2", "W3", "W4"]}
            series={[{ name: "Entries posted", values: [12, 18, 9, 24] }]}
            loading={loading}
          />
        </Stack>
      ) : (
        <DataTable
          columns={columns}
          items={byAccount}
          loading={loading}
          emptyTitle="Nothing posted in this period"
          aria-label="Ledger statistics"
        />
      )}
    </Stack>
  );
}
