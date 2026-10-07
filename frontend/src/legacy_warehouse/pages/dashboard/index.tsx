import { SimpleGrid, Stack, Text } from "@chakra-ui/react";
import { Clock, FileText, Gauge, LogIn, LogOut } from "lucide-react";
import { Card } from "../../../legacy/components/display/Card";
import { DataTable, type TableColumn } from "../../../legacy/components/display/DataTable";
import { OverviewCard } from "../../components/display/OverviewCard";
import { ScreenHeader } from "../../components/display/ScreenHeader";
import type { DwellRow } from "../../fixtures";

// ── THE FLOOR DASHBOARD ─────────────────────────────────────────────────────────────────────────
//
// Three cards, and what makes it a FLOOR dashboard rather than a business one is that all three are
// scoped to TODAY. There is no month, no comparison to last week, no growth rate.
//
// That is the right call and worth stating: the person reading this is deciding what to do in the
// next hour. "Outbound is up 12% year on year" changes nothing about which trolley to load next.
// Everything historical lives in Warehouse insight, one menu group down, for a different reader.
//
// ── THE THIRD CARD IS THE ONE THAT EARNS ITS PLACE ──────────────────────────────────────────────
//
// Two cards say how much moved. The third says how long things SAT — and it is the only thing on
// the screen that identifies a problem rather than reporting a number. A queue that is not moving
// looks exactly like a queue that is moving, in a count.
export const description =
  "The floor dashboard: today's inbound and outbound broken down by state, plus how long orders sat in each state. Everything is scoped to today — the reader is deciding what to do in the next hour.";

export interface DashboardPageProps {
  inbound: Array<{ state: string; orders: number; units: number; cancelled?: boolean }>;
  outbound: Array<{ state: string; orders: number; units: number; cancelled?: boolean }>;
  invoices: Array<{ state: string; orders: number; units: number; cancelled?: boolean }>;
  dwell: DwellRow[];
  loading?: boolean;
}

export function DashboardPage({ inbound, outbound, invoices, dwell, loading }: DashboardPageProps) {
  const columns: Array<TableColumn<DwellRow>> = [
    { name: "Transition", key: "state" },
    { name: "Orders", key: "count", align: "end" },
    {
      name: "Median",
      align: "end",
      tooltip: "The middle order. Half moved faster than this.",
      render: (row) => <Text fontSize="sm">{row.medianMinutes}m</Text>,
    },
    {
      // ⚠ THE WORST CASE IS A COLUMN, NOT A FOOTNOTE.
      //
      // A median alone says the floor is fine while one order has been sitting for four hours. The
      // median is what the shift feels; the worst is what the customer feels, and only one of them
      // is actionable. Showing both is the whole value of the card.
      name: "Worst",
      align: "end",
      tooltip: "The slowest single order. This is the one worth chasing.",
      render: (row) => (
        <Text fontSize="sm" fontWeight={row.worstMinutes > 120 ? "semibold" : "normal"} color={row.worstMinutes > 120 ? "fg.error" : undefined}>
          {row.worstMinutes}m
        </Text>
      ),
    },
  ];

  return (
    <Stack gap="section" p="page" data-testid="dashboard-page">
      <ScreenHeader icon={Gauge} title="Dashboard" />

      <SimpleGrid columns={{ base: 1, md: 2, xl: 3 }} gap="3">
        <OverviewCard title="Inbound today" icon={LogIn} rows={inbound} loading={loading} colorPalette="blue" />
        <OverviewCard title="Outbound today" icon={LogOut} rows={outbound} loading={loading} colorPalette="green" />
        <OverviewCard title="Invoices today" icon={FileText} rows={invoices} loading={loading} colorPalette="orange" />
      </SimpleGrid>

      <Card p="0" overflow="hidden" data-testid="dwell-card">
        <Stack gap="0">
          <Stack gap="0" px="3" py="2" borderBottomWidth="1px">
            <Text fontWeight="semibold" fontSize="sm">
              <Clock size={14} style={{ display: "inline", verticalAlign: "-2px", marginRight: 6 }} />
              How long orders sat, today
            </Text>
            <Text fontSize="xs" color="fg.muted">
              A queue that has stopped moving looks identical to one that is moving, in a count.
            </Text>
          </Stack>
          <DataTable
            columns={columns}
            items={dwell}
            loading={loading}
            emptyTitle="Nothing has moved yet today"
            aria-label="Time in state"
          />
        </Stack>
      </Card>
    </Stack>
  );
}
