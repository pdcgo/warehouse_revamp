import { SimpleGrid, Stack, Text } from "@chakra-ui/react";
import { BarChart3 } from "lucide-react";
import { BarChart } from "../../../legacy/components/charts/BarChart";
import { Card } from "../../../legacy/components/display/Card";
import { DataTable, type TableColumn } from "../../../legacy/components/display/DataTable";
import { ScreenHeader } from "../../components/display/ScreenHeader";
import type { TeamThroughputRow } from "../../fixtures";

// ── WAREHOUSE INSIGHT ───────────────────────────────────────────────────────────────────────────
//
// The historical screen, and the counterweight to the dashboard. The dashboard is today and is read
// by whoever is on shift; this is weeks and is read by whoever is deciding what to change.
//
// ⚠ THE ONE JUDGEMENT THAT MATTERS HERE IS THE SORT ORDER, AND THE ORIGINAL GETS IT WRONG.
//
// A throughput table sorted by volume puts the biggest team at the top. That is the team that is
// FINE — big and busy — and it buries the small team whose damage rate is catastrophic at the
// bottom, below the fold, where nobody scrolls.
//
// Sorting by the RATIO instead puts the row worth a phone call first. The volume is still a column;
// it is just not what decides the order. A ranking is an argument about what matters, and "biggest"
// is almost never the answer on a screen whose job is to surface problems.
export const description =
  "The historical counterweight to the dashboard. Sorted by damage RATIO, not volume — sorting by volume puts the team that is fine at the top and buries the one worth a phone call.";

export interface InsightPageProps {
  teams: TeamThroughputRow[];
  daily: Array<{ day: string; inbound: number; outbound: number }>;
  loading?: boolean;
}

export function InsightPage({ teams, daily, loading }: InsightPageProps) {
  const ratio = (row: TeamThroughputRow) => (row.outbound ? row.damaged / row.outbound : row.damaged ? 1 : 0);

  const ranked = [...teams].sort((a, b) => ratio(b) - ratio(a));

  const columns: Array<TableColumn<TeamThroughputRow>> = [
    { name: "Team", key: "team", sticky: "left" },
    {
      // First column after the name, because it decides the order and a reader should be able to see
      // why the rows are where they are.
      name: "Damage rate",
      align: "end",
      tooltip: "Damaged units as a share of units shipped. This is what the table is sorted by.",
      render: (row) => {
        const r = ratio(row);
        return (
          <Text
            fontSize="sm"
            fontWeight={r > 0.05 ? "semibold" : "normal"}
            color={r > 0.05 ? "fg.error" : undefined}
            data-testid="damage-rate"
          >
            {(r * 100).toFixed(1)}%
          </Text>
        );
      },
    },
    { name: "Shipped", key: "outbound", align: "end" },
    { name: "Received", key: "inbound", align: "end" },
    { name: "Damaged", key: "damaged", align: "end" },
    { name: "Returns", key: "returns", align: "end" },
  ];

  return (
    <Stack gap="section" p="page" data-testid="insight-page">
      <ScreenHeader icon={BarChart3} title="Warehouse insight" />

      <SimpleGrid columns={{ base: 1, lg: 2 }} gap="3">
        <Card>
          <Text fontSize="sm" fontWeight="medium" mb="2">
            Movement this week
          </Text>
          {/* ⚠ GROUPED, NOT STACKED, and deliberately. Stacking would make the bars a total — but
              inbound and outbound are not parts of one quantity, they are two flows in opposite
              directions, and adding them together produces a number that means nothing. */}
          <BarChart
            labels={daily.map((d) => d.day)}
            series={[
              { name: "Received", values: daily.map((d) => d.inbound) },
              { name: "Shipped", values: daily.map((d) => d.outbound) },
            ]}
            loading={loading}
            height={240}
            emptyText="No movement this week"
          />
        </Card>

        <Card>
          <Text fontSize="sm" fontWeight="medium" mb="2">
            Damage rate by team
          </Text>
          <BarChart
            labels={ranked.map((t) => t.team)}
            series={[{ name: "Damage rate %", values: ranked.map((t) => Number((ratio(t) * 100).toFixed(1))) }]}
            loading={loading}
            height={240}
            formatValue={(v) => `${v}%`}
            emptyText="No teams"
          />
        </Card>
      </SimpleGrid>

      <Stack gap="1">
        <Text fontSize="sm" fontWeight="medium">
          Teams, worst rate first
        </Text>
        <Text fontSize="xs" color="fg.muted">
          Not sorted by volume. The biggest team is the one that is fine.
        </Text>
        <DataTable
          columns={columns}
          items={ranked}
          loading={loading}
          emptyTitle="No throughput recorded"
          aria-label="Team throughput"
          data-testid="team-table"
        />
      </Stack>
    </Stack>
  );
}
