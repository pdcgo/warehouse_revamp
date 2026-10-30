import { type MessageInitShape, getOption } from "@bufbuild/protobuf";
import { useQuery } from "@tanstack/react-query";

import { settlementAnalyticClient } from "../../api/clients";
import { key, listQuery } from "../../api/queryClient";
import {
  type FilterItemSchema,
  GroupType,
  type MetricKeys,
  SortType,
  metric,
} from "../../gen/warehouse/analytic_base/v1/analytic_pb";
import { type MetricData, SettlementMetricSchema } from "../../gen/warehouse/settlement/v1/settlement_analytic_pb";
import { type PeriodGrain, bucketSpine } from "../../lib/period";
import { measureOf, type SettlementMeasure } from "./measure";

// THE SETTLEMENT REPORT's reads (docs/business/settlement/analytic_context.md). settlement_service serves them as the
// metric `metrics/settlement`, through the analytic pattern every service's figures share
// (docs/business/analytic/rpc_provide.md, the-pattern-replaces-the-shipped-analytics):
//
//   useSettlementSummary   MetricData SUMMARY — the window's headline, keyed without any page
//   useSettlementSeries    the periods are listed HERE (a time group needs no search), then MetricData fills the page's
//   useSettlementGroups    MetricSearch by shop or person, the largest position first, then MetricData for that page
//
// ⚠ A FIGURE LAGS THE POST by the broker's delivery — the reports are folded, never summed from the ledger live.
//
// All three are `listQuery`: a window, a grain or a page change REFINES the same question about the same team, so the
// previous figures stay on screen while the next ones load (HARD RULE 10). Pair with RefreshOverlay.

/** The metric's id, read off the proto — never typed by hand. */
const SETTLEMENT = getOption(SettlementMetricSchema, metric).metricId;

export type SettlementGroupBy = "shop" | "user";

const groupTypeOf: Record<SettlementGroupBy, GroupType> = {
  shop: GroupType.SHOP,
  user: GroupType.USER,
};

const timeGroupOf: Record<PeriodGrain, GroupType> = {
  day: GroupType.DAILY,
  month: GroupType.MONTHLY,
  year: GroupType.YEARLY,
};

export interface SettlementPoint {
  /** The bucket's first day, `yyyy-mm-dd`. */
  at: string;
  measure: SettlementMeasure;
}

export interface SettlementGroupRow {
  id: bigint;
  measure: SettlementMeasure;
}

interface Window {
  teamId: bigint | undefined;
  from: string;
  to: string;
  /** False when the window is unbounded or backwards — the screen explains, nothing is sent. */
  valid: boolean;
}

type Filter = MessageInitShape<typeof FilterItemSchema>;

const windowFilter = (from: string, to: string): Filter[] => [
  { f: { case: "dateRangeFilter", value: { dateMin: from, dateMax: to } } },
];

const idsOf = (keys: MetricKeys | undefined): bigint[] => (keys?.k.case === "ids" ? keys.k.value.ids : []);

/** The one answer for `metrics/settlement` — the call asks for nothing else. */
function settlementData(datas: MetricData[]) {
  const m = datas[0]?.m;

  return {
    byId: m?.case === "settlementById" ? m.value.items : {},
    byDay: m?.case === "settlementByDay" ? m.value.items : {},
    summary: m?.case === "settlementSummary" ? m.value : undefined,
  };
}

/** A bucket label — `2026-10-07`, `2026-10`, `2026` — as its first day, the key a period is filled by. */
function firstDay(label: string, grain: PeriodGrain): string {
  if (grain === "year") return `${label}-01-01`;
  if (grain === "month") return `${label}-01`;

  return label;
}

/**
 * The WHOLE window as one measure — the metric grouped by SUMMARY.
 *
 * ⚠ Asked of the server rather than summed from the series on screen: the series is paginated, and a position is not a
 * sum of periods at all.
 */
export function useSettlementSummary({ teamId, from, to, valid }: Window) {
  return useQuery({
    ...listQuery,
    queryKey: key.settlement(teamId, { report: "summary", from, to }),
    enabled: teamId !== undefined && valid,
    queryFn: async (): Promise<SettlementMeasure> => {
      const res = await settlementAnalyticClient.metricData({
        teamId: teamId!,
        groupBy: GroupType.SUMMARY,
        filters: windowFilter(from, to),
        metricIds: [SETTLEMENT],
      });

      return measureOf(settlementData(res.metricDatas).summary);
    },
  });
}

/**
 * The window, period by period — NEWEST first, one row per period including the quiet ones, which still carry the
 * position. A time group needs no search: the periods are listed here, and a page is a slice of that list.
 */
export function useSettlementSeries(args: Window & { grain: PeriodGrain; page: number; pageSize: number }) {
  const { teamId, from, to, valid, grain, page, pageSize } = args;

  return useQuery({
    ...listQuery,
    queryKey: key.settlement(teamId, { report: "series", grain, from, to, page, pageSize }),
    enabled: teamId !== undefined && valid,
    queryFn: async () => {
      const periods = bucketSpine(from, to, grain)
        .map((label) => firstDay(label, grain))
        .reverse();
      const keys = periods.slice((page - 1) * pageSize, page * pageSize);

      const filled =
        keys.length === 0
          ? undefined
          : await settlementAnalyticClient.metricData({
              teamId: teamId!,
              groupBy: timeGroupOf[grain],
              filters: windowFilter(from, to),
              keys: { k: { case: "days", value: { days: keys } } },
              metricIds: [SETTLEMENT],
            });

      const byDay = settlementData(filled?.metricDatas ?? []).byDay;

      return {
        points: keys.map((at): SettlementPoint => ({ at, measure: measureOf(byDay[at]) })),
        totalItems: periods.length,
      };
    },
  });
}

/**
 * Shops or people RANKED by the position they carry at the window's end, the largest first, then filled — two calls
 * from one server-side definition, so the order and the numbers beside it cannot disagree. A shop quiet in the window
 * still ranks by what it carries in.
 *
 * No total: a page says only whether another follows (a-metric-page-has-no-total) — the growing pager.
 */
export function useSettlementGroups(args: Window & { groupBy: SettlementGroupBy; page: number; pageSize: number }) {
  const { teamId, from, to, valid, groupBy, page, pageSize } = args;

  return useQuery({
    ...listQuery,
    queryKey: key.settlement(teamId, { report: "groups", groupBy, from, to, page, pageSize }),
    enabled: teamId !== undefined && valid,
    queryFn: async () => {
      const filters = windowFilter(from, to);

      const ranked = await settlementAnalyticClient.metricSearch({
        teamId: teamId!,
        groupBy: groupTypeOf[groupBy],
        filters,
        sort: { metricId: SETTLEMENT, field: "position_to_date", sortType: SortType.DESC },
        page: { offset: (page - 1) * pageSize, limit: pageSize },
      });

      const ids = idsOf(ranked.keys);
      if (ids.length === 0) return { rows: [] as SettlementGroupRow[], hasNext: ranked.hasNext };

      const filled = await settlementAnalyticClient.metricData({
        teamId: teamId!,
        groupBy: groupTypeOf[groupBy],
        filters,
        keys: { k: { case: "ids", value: { ids } } },
        metricIds: [SETTLEMENT],
      });
      const byId = settlementData(filled.metricDatas).byId;

      return {
        rows: ids.map((id): SettlementGroupRow => ({ id, measure: measureOf(byId[id.toString()]) })),
        hasNext: ranked.hasNext,
      };
    },
  });
}
