import { useMemo, useState } from "react";
import { Heading, HStack, Stack, Text } from "@chakra-ui/react";
import { Download } from "lucide-react";
import { DateCell } from "../../components/cells/DateCell";
import { StatisticCell } from "../../components/cells/StatisticCell";
import { BarChart } from "../../components/charts/BarChart";
import { DataTable, type TableColumn, type TableSort } from "../../components/display/DataTable";
import { Summary } from "../../components/display/Summary";
import { Button } from "../../components/inputs/Button";
import { SegmentedRadio } from "../../components/inputs/SegmentedRadio";
import { ToneBadge } from "../../components/badges/ToneBadge";
import { formatRupiahCompact } from "../../../lib/money";
import type { AdSpendRow } from "../../financeFixtures";

// ── AD SPEND, GROUPED FOUR WAYS ─────────────────────────────────────────────────────────────────
//
// The legacy system has four ad screens — a raw list, by day, by month, and by shop. They are one
// screen with a different GROUPING, and the grouping is genuinely the only difference: the measures,
// the ROAS rule and the export are identical.
//
// ⚠ ROAS IS COMPUTED HERE, ONCE, AND IT IS THE POINT OF THE SCREEN. Revenue divided by spend is what
// says whether an ad is worth running, and a screen that showed spend and revenue as two columns
// without it would leave every reader doing the division by hand — differently, and sometimes wrong.
//
// The threshold below 1.0 is not a style choice either: below 1, the advertising is losing money,
// and that is a fact worth colouring rather than leaving to be noticed.
export const description =
  "Ad spend grouped four ways — a raw list, by day, by month, by shop. One screen with a different grouping; the measures and the ROAS rule are identical, and ROAS below 1.0 is coloured because it means the advertising is losing money.";

export type AdGrouping = "none" | "day" | "month" | "shop";

interface GroupedRow {
  key: string;
  label: string;
  at?: bigint;
  shopName?: string;
  channel?: string;
  spend: bigint;
  revenue: bigint;
  clicks: number;
}

// roas — revenue for every rupiah spent. Below 1.0 the campaign is losing money.
function roas(row: { spend: bigint; revenue: bigint }): number {
  if (row.spend <= 0n) return 0;
  return Number(row.revenue) / Number(row.spend);
}

function groupRows(rows: AdSpendRow[], grouping: AdGrouping): GroupedRow[] {
  if (grouping === "none") {
    return rows.map((r) => ({
      key: r.id.toString(),
      label: r.channel,
      at: r.at,
      shopName: r.shopName,
      channel: r.channel,
      spend: r.spend,
      revenue: r.revenue,
      clicks: r.clicks,
    }));
  }

  const buckets = new Map<string, GroupedRow>();

  for (const r of rows) {
    const date = new Date(Number(r.at) * 1000);
    const key =
      grouping === "shop"
        ? r.shopName
        : grouping === "month"
          ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
          : date.toISOString().slice(0, 10);

    const existing = buckets.get(key);
    if (existing) {
      existing.spend += r.spend;
      existing.revenue += r.revenue;
      existing.clicks += r.clicks;
    } else {
      buckets.set(key, {
        key,
        label: key,
        at: grouping === "shop" ? undefined : r.at,
        shopName: grouping === "shop" ? r.shopName : undefined,
        spend: r.spend,
        revenue: r.revenue,
        clicks: r.clicks,
      });
    }
  }

  return [...buckets.values()];
}

export interface AdSpendScreenProps {
  title: string;
  subtitle?: string;
  grouping: AdGrouping;
  rows: AdSpendRow[];
  loading?: boolean;
  isError?: boolean;
}

export function AdSpendScreen({
  title,
  subtitle,
  grouping,
  rows,
  loading,
  isError,
}: AdSpendScreenProps) {
  const [view, setView] = useState<"table" | "chart">("table");
  const [sort, setSort] = useState<TableSort>();

  const grouped = useMemo(() => groupRows(rows, grouping), [rows, grouping]);

  const sorted = useMemo(() => {
    if (!sort?.key) return grouped;
    const direction = sort.desc ? -1 : 1;

    return [...grouped].sort((a, b) => {
      const value = (r: GroupedRow) => (sort.key === "roas" ? roas(r) : (r[sort.key as keyof GroupedRow] ?? 0));
      const av = value(a);
      const bv = value(b);
      if (av === bv) return 0;
      return (av > bv ? 1 : -1) * direction;
    });
  }, [grouped, sort]);

  const totals = grouped.reduce(
    (acc, r) => ({ spend: acc.spend + r.spend, revenue: acc.revenue + r.revenue, clicks: acc.clicks + r.clicks }),
    { spend: 0n, revenue: 0n, clicks: 0 },
  );
  const totalRoas = roas(totals);

  const columns: Array<TableColumn<GroupedRow>> = [
    {
      name: grouping === "shop" ? "Shop" : grouping === "none" ? "Channel" : "Period",
      sticky: "left",
      render: (row) =>
        grouping === "none" ? (
          <Stack gap="0" lineHeight="short">
            <Text fontSize="sm" fontWeight="medium">
              {row.channel}
            </Text>
            <Text fontSize="xs" color="fg.muted">
              {row.shopName}
            </Text>
          </Stack>
        ) : grouping === "shop" ? (
          <Text fontSize="sm">{row.shopName}</Text>
        ) : (
          <DateCell value={`${row.label}${grouping === "month" ? "-01" : ""}T00:00:00Z`} grain={grouping === "month" ? "month" : "date"} />
        ),
    },
    {
      name: "Spend",
      align: "end",
      sortKey: "spend",
      render: (row) => <StatisticCell value={row.spend} kind="price" compact />,
    },
    {
      name: "Revenue",
      align: "end",
      sortKey: "revenue",
      render: (row) => <StatisticCell value={row.revenue} kind="price" compact />,
    },
    { name: "Clicks", key: "clicks", align: "end", sortKey: "clicks" },
    {
      name: "ROAS",
      align: "end",
      sortKey: "roas",
      tooltip: "Revenue for every rupiah spent. Below 1.0 the advertising is losing money.",
      render: (row) => {
        const value = roas(row);
        return (
          <ToneBadge tone={value >= 1 ? "success" : "error"} data-testid="roas-badge">
            {value.toFixed(2)}×
          </ToneBadge>
        );
      },
    },
  ];

  return (
    <Stack gap="section" data-testid="ad-spend-screen" data-grouping={grouping}>
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
          <SegmentedRadio
            items={[
              { value: "table", label: "Table" },
              { value: "chart", label: "Chart" },
            ]}
            value={view}
            onChange={(v) => setView(v as "table" | "chart")}
          />
          <Button tone="plain" variant="outline" icon={Download}>
            Export
          </Button>
        </HStack>
      </HStack>

      <Summary
        items={[
          { label: "Spend", value: formatRupiahCompact(totals.spend), tone: "warning" },
          { label: "Revenue", value: formatRupiahCompact(totals.revenue), tone: "success" },
          { label: "Clicks", value: totals.clicks.toLocaleString("id-ID") },
          {
            label: "ROAS",
            value: `${totalRoas.toFixed(2)}×`,
            tone: totalRoas >= 1 ? "success" : "error",
          },
        ]}
        loading={loading}
      />

      {view === "chart" ? (
        <BarChart
          labels={sorted.map((r) => (grouping === "shop" ? r.shopName ?? r.label : r.label))}
          series={[
            { name: "Spend", values: sorted.map((r) => Number(r.spend) / 1_000_000) },
            { name: "Revenue", values: sorted.map((r) => Number(r.revenue) / 1_000_000) },
          ]}
          loading={loading}
          formatValue={(v) => `${v.toFixed(1)}jt`}
        />
      ) : (
        <DataTable
          columns={columns}
          items={sorted}
          loading={loading}
          isError={isError}
          sort={sort}
          onSort={setSort}
          emptyTitle="No ad spend in this period"
          errorTitle="Could not load ad spend"
          aria-label={title}
        />
      )}
    </Stack>
  );
}
