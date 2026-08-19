import { useMemo, useState } from "react";
import { Heading, HStack, Stack, Text } from "@chakra-ui/react";
import { Download } from "lucide-react";
import { DataTable, type TableColumn, type TableSort } from "../../components/display/DataTable";
import { Summary } from "../../components/display/Summary";
import { SegmentedRadio } from "../../components/inputs/SegmentedRadio";
import { Button } from "../../components/inputs/Button";
import { SearchInput } from "../../components/inputs/SearchInput";
import { BarChart } from "../../components/charts/BarChart";
import { LineChart } from "../../components/charts/LineChart";
import { StatisticCell } from "../../components/cells/StatisticCell";
import { ClippedText } from "../../components/text/ClippedText";
import { Pagination } from "../../../components/chrome/Pagination";
import { formatRupiahCompact } from "../../../lib/money";
import { METRIC_SERIES, METRIC_SPINE, type MetricRow } from "../../fixtures";

// ── THE STATISTICS SCREEN, ONCE ─────────────────────────────────────────────────────────────────
//
// The legacy system has EIGHT of these — by product, by shop, by team, by supplier, by user, by
// cost, cross-product, and historical. They are not eight screens. They are ONE screen asked about a
// different DIMENSION each time: same period control, same chart-or-table toggle, same measures,
// same export.
//
// Porting them as eight independent files is how they drift — one gains a margin column, another
// keeps a stale label — so the screen lives here once and each route supplies its dimension.
//
// Two decisions carried from the original:
//
//  1. CHART AND TABLE ARE A TOGGLE, NOT BOTH AT ONCE. They answer different questions — the chart
//     says which way it is moving, the table says which rows to act on — and showing both halves
//     each. The toggle is a SegmentedRadio because it is a view choice, not a filter.
//  2. MARGIN IS COMPUTED HERE, NOT PASSED IN. Revenue minus cost is the number every one of these
//     screens is actually read for, and computing it per screen is how two screens end up
//     disagreeing about whether it includes shipping.
export const description =
  "The statistics screen, defined ONCE. The legacy system has eight of these — they are one screen asked about a different dimension each time, so the dimension is a prop and the screen is not copied.";

export type MetricView = "chart" | "table";

export interface MetricScreenProps {
  // What this instance is ABOUT — "Product", "Shop", "Team". Names the screen and its first column.
  dimension: string;
  title: string;
  // One sentence on what the reader is looking at, since eight near-identical screens otherwise
  // become indistinguishable in a browser tab.
  subtitle?: string;
  rows: MetricRow[];
  loading?: boolean;
  isError?: boolean;
  // Some dimensions have no meaningful trend (a cross-product breakdown is not a time series), so
  // those instances drop the chart rather than drawing a meaningless one.
  chartable?: boolean;
}

export function MetricScreen({
  dimension,
  title,
  subtitle,
  rows,
  loading,
  isError,
  chartable = true,
}: MetricScreenProps) {
  const [view, setView] = useState<MetricView>(chartable ? "chart" : "table");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<TableSort>();
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) => r.label.toLowerCase().includes(q) || (r.sublabel ?? "").toLowerCase().includes(q),
    );
  }, [rows, search]);

  const sorted = useMemo(() => {
    if (!sort?.key) return filtered;
    const direction = sort.desc ? -1 : 1;

    return [...filtered].sort((a, b) => {
      // Margin is DERIVED, so it is not a plain key lookup — hence the branch rather than an index.
      const value = (r: MetricRow) =>
        sort.key === "margin" ? r.revenue - r.cost : (r[sort.key as keyof MetricRow] ?? 0);
      const av = value(a);
      const bv = value(b);
      if (av === bv) return 0;
      return (av > bv ? 1 : -1) * direction;
    });
  }, [filtered, sort]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, r) => ({
          orders: acc.orders + r.orders,
          units: acc.units + r.units,
          revenue: acc.revenue + r.revenue,
          cost: acc.cost + r.cost,
        }),
        { orders: 0, units: 0, revenue: 0n, cost: 0n },
      ),
    [rows],
  );

  const columns: Array<TableColumn<MetricRow>> = [
    {
      name: dimension,
      sortKey: "label",
      sticky: "left",
      render: (row) => (
        <Stack gap="0.5" lineHeight="short" minW="0">
          <ClippedText fontWeight="medium">{row.label}</ClippedText>
          {row.sublabel && (
            <Text fontSize="xs" color="fg.muted">
              {row.sublabel}
            </Text>
          )}
        </Stack>
      ),
    },
    { name: "Orders", key: "orders", align: "end", sortKey: "orders" },
    { name: "Units", key: "units", align: "end", sortKey: "units" },
    {
      name: "Revenue",
      align: "end",
      sortKey: "revenue",
      render: (row) => <StatisticCell value={row.revenue} kind="price" compact />,
    },
    {
      name: "Cost",
      align: "end",
      sortKey: "cost",
      render: (row) => <StatisticCell value={row.cost} kind="price" compact />,
    },
    {
      name: "Margin",
      align: "end",
      sortKey: "margin",
      // Decision 2: derived here, once, for all eight screens.
      tooltip: "Revenue minus cost, before shipping and fees.",
      render: (row) => <StatisticCell value={row.revenue - row.cost} kind="price" compact />,
    },
  ];

  return (
    <Stack gap="section" data-testid="metric-screen" data-dimension={dimension}>
      <HStack justify="space-between" wrap="wrap" gap="card">
        <Stack gap="0.5">
          <Heading size="md">{title}</Heading>
          {subtitle && (
            <Text fontSize="sm" color="fg.muted">
              {subtitle}
            </Text>
          )}
        </Stack>

        <HStack gap="2">
          {chartable && (
            // Decision 1: a VIEW choice, so a segmented control rather than a filter tab.
            <SegmentedRadio
              items={[
                { value: "chart", label: "Chart" },
                { value: "table", label: "Table" },
              ]}
              value={view}
              onChange={(v) => setView(v as MetricView)}
            />
          )}
          <Button tone="plain" variant="outline" icon={Download} data-testid="metric-export">
            Export
          </Button>
        </HStack>
      </HStack>

      <Summary
        items={[
          { label: "Orders", value: totals.orders.toLocaleString("id-ID") },
          { label: "Units", value: totals.units.toLocaleString("id-ID") },
          { label: "Revenue", value: formatRupiahCompact(totals.revenue), tone: "success" },
          { label: "Margin", value: formatRupiahCompact(totals.revenue - totals.cost), tone: "active" },
        ]}
        loading={loading}
      />

      {view === "chart" && chartable ? (
        <Stack gap="section" data-testid="metric-chart">
          <LineChart
            labels={METRIC_SPINE}
            series={METRIC_SERIES}
            loading={loading}
            formatValue={(v) => formatRupiahCompact(BigInt(Math.round(v * 1000)))}
          />
          <BarChart
            labels={sorted.slice(0, 6).map((r) => r.label)}
            series={[{ name: "Units", values: sorted.slice(0, 6).map((r) => r.units) }]}
            loading={loading}
          />
        </Stack>
      ) : (
        <>
          <SearchInput
            value={search}
            onChange={(v) => {
              setSearch(v);
              setPage(1);
            }}
            placeholder={`Search ${dimension.toLowerCase()}`}
            maxW="72"
          />

          <DataTable
            columns={columns}
            items={sorted.slice((page - 1) * 20, page * 20)}
            loading={loading}
            isError={isError}
            sort={sort}
            onSort={setSort}
            headerSticky
            emptyTitle={`No ${dimension.toLowerCase()} data for this period`}
            emptyContent="Try a wider date range."
            errorTitle="Could not load these figures"
            aria-label={title}
          />

          <Pagination
            count={sorted.length}
            page={page}
            pageSize={20}
            onPageChange={setPage}
            showRange
          />
        </>
      )}
    </Stack>
  );
}
