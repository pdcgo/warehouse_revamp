import { Stack, Text } from "@chakra-ui/react";
import { History } from "lucide-react";
import { DataTable, type TableColumn } from "../../../legacy/components/display/DataTable";
import { DateCell } from "../../../legacy/components/cells/DateCell";
import { ScreenHeader } from "../../components/display/ScreenHeader";
import type { StockDayRow } from "../../fixtures";

// ── DAILY STOCK HISTORY ─────────────────────────────────────────────────────────────────────────
//
// One row per SKU per day: what we opened with, what moved, what we closed with. The screen somebody
// opens when a number is wrong and they need to find the day it went wrong.
//
// ⚠ THE ROW HAS TO BALANCE, AND WHEN IT DOES NOT, THAT IS THE ANSWER.
//
//     opening + inbound − outbound + adjustment = closing
//
// Everything on this screen follows from that identity. It is not a report of activity — it is a
// LEDGER, and its value is entirely in being checkable. A row that does not balance is either a bug
// or a movement nobody recorded, and both are worth stopping for.
//
// ⚠ AN ADJUSTMENT IS THE ADMISSION THAT SOMETHING HAPPENED OFF-LEDGER. It is the only column that
// does not correspond to a physical movement — somebody corrected the count by hand — so it is the
// column to look at first, and it is marked. The reason for it lives on the problem-items screen,
// which is the seam an unexplained shortfall hides in: this screen knows two units vanished and not
// why, and that one knows why and not which day.
export const description =
  "One row per SKU per day, and the row must balance: opening + in − out + adjustment = closing. Adjustments are marked because they are the only column with no physical movement behind them.";

export interface DailyStockPageProps {
  rows: StockDayRow[];
  loading?: boolean;
}

export function DailyStockPage({ rows, loading }: DailyStockPageProps) {
  const balances = (r: StockDayRow) => r.opening + r.inbound - r.outbound + r.adjustment === r.closing;

  const columns: Array<TableColumn<StockDayRow>> = [
    { name: "Day", sticky: "left", render: (row) => <DateCell value={row.day} grain="date" /> },
    {
      name: "Product",
      render: (row) => (
        <Stack gap="0" maxW="56">
          <Text fontSize="sm" lineClamp={1}>
            {row.product}
          </Text>
          <Text fontSize="xs" color="fg.muted" fontFamily="mono">
            {row.sku}
          </Text>
        </Stack>
      ),
    },
    { name: "Team", key: "team" },
    { name: "Opening", key: "opening", align: "end" },
    { name: "In", key: "inbound", align: "end" },
    { name: "Out", key: "outbound", align: "end" },
    {
      name: "Adjustment",
      align: "end",
      tooltip: "A hand correction — the only column with no physical movement behind it.",
      render: (row) =>
        row.adjustment === 0 ? (
          <Text fontSize="sm" color="fg.muted">
            —
          </Text>
        ) : (
          <Text fontSize="sm" fontWeight="semibold" color="fg.warning" data-testid="adjustment">
            {row.adjustment > 0 ? `+${row.adjustment}` : row.adjustment}
          </Text>
        ),
    },
    {
      name: "Closing",
      align: "end",
      render: (row) => (
        <Text fontSize="sm" fontWeight="medium">
          {row.closing}
        </Text>
      ),
    },
    {
      // A ledger's only real feature. It is a column rather than a footnote because a reader
      // scanning for the bad day should not have to do the arithmetic themselves.
      name: "Balances",
      align: "center",
      tooltip: "opening + in − out + adjustment = closing",
      render: (row) => (
        <Text
          fontSize="sm"
          color={balances(row) ? "fg.success" : "fg.error"}
          data-testid="balance-check"
          data-balances={balances(row) ? "true" : "false"}
        >
          {balances(row) ? "✓" : "does not balance"}
        </Text>
      ),
    },
  ];

  return (
    <Stack gap="section" p="page" data-testid="daily-stock-page">
      <ScreenHeader icon={History} title="Daily stock history" />

      <DataTable
        columns={columns}
        items={rows}
        loading={loading}
        emptyTitle="No movement recorded"
        aria-label="Daily stock history"
        data-testid="stock-history-table"
      />

      <Text fontSize="xs" color="fg.muted">
        An adjustment says a count was corrected by hand. Why it was corrected lives on Problem items
        — this screen knows which day, that one knows the reason.
      </Text>
    </Stack>
  );
}
