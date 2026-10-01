import { useQuery } from "@tanstack/react-query";

import { settlementAnalyticClient } from "../../api/clients";
import { key, listQuery } from "../../api/queryClient";
import { CommonSortType } from "../../gen/warehouse/common/v1/list_pb";
import {
  AnalyticGroupType,
  AnalyticMetricSort,
  AnalyticTimeframe,
} from "../../gen/warehouse/settlement/v1/settlement_pb";
import type { PeriodGrain } from "../../lib/period";
import { measureOf, type SettlementMeasure } from "./measure";

// THE SETTLEMENT REPORTS' reads (docs/business/settlement/analytic_context.md).
//
// ⚠ THE GRAIN IS ON THE WIRE here, unlike the daily statement. These RPCs roll up on the server and cap
// the span per grain (366 days, 60 months, 20 years), so a yearly view genuinely reaches back years —
// which a client rollup of a 366-day daily series never could.
//
// All three are `listQuery`: a window, a grain or a page change REFINES the same question about the same
// team, so the previous figures stay on screen while the next ones load. Pair with RefreshOverlay.

const timeframeOf: Record<PeriodGrain, AnalyticTimeframe> = {
  day: AnalyticTimeframe.DAILY,
  month: AnalyticTimeframe.MONTHLY,
  year: AnalyticTimeframe.YEARLY,
};

export type SettlementGroupBy = "shop" | "user";

const groupTypeOf: Record<SettlementGroupBy, AnalyticGroupType> = {
  shop: AnalyticGroupType.SHOP,
  user: AnalyticGroupType.USER,
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

/**
 * The WHOLE window as one metric — the team grouped by itself.
 *
 * ⚠ Asked of the server rather than summed from the series on screen: the series is paginated, and a
 * headline that summed the visible page would change as somebody turned pages.
 */
export function useSettlementSummary({ teamId, from, to, valid }: Window) {
  return useQuery({
    ...listQuery,
    queryKey: key.settlement(teamId, { report: "summary", from, to }),
    enabled: teamId !== undefined && valid,
    queryFn: async (): Promise<SettlementMeasure> => {
      const res = await settlementAnalyticClient.analyticGroupMetric({
        teamId: teamId!,
        filter: { dateRange: { startDate: from, endDate: to }, groupType: AnalyticGroupType.TEAM },
        ids: [teamId!],
      });

      return measureOf(res.metrics[teamId!.toString()]);
    },
  });
}

/** The window, period by period — NEWEST first, one row per bucket including the quiet ones. */
export function useSettlementSeries(
  args: Window & { grain: PeriodGrain; page: number; pageSize: number },
) {
  const { teamId, from, to, valid, grain, page, pageSize } = args;

  return useQuery({
    ...listQuery,
    queryKey: key.settlement(teamId, { report: "series", grain, from, to, page, pageSize }),
    enabled: teamId !== undefined && valid,
    queryFn: async () => {
      const res = await settlementAnalyticClient.analyticTimeSearch({
        teamId: teamId!,
        timeframe: timeframeOf[grain],
        filter: { dateRange: { startDate: from, endDate: to }, userId: 0n, shopId: 0n },
        sortType: CommonSortType.DESC,
        page: { page, limit: pageSize },
      });

      return {
        points: res.datas.map(
          (d): SettlementPoint => ({ at: d.at, measure: measureOf(d.metric) }),
        ),
        totalItems: Number(res.pageInfo?.totalItems ?? 0n),
      };
    },
  });
}

/**
 * Shops or users RANKED by the hidden cost they carry at the window's end, then filled.
 *
 * Two calls by design (analytic_context.md §How We Handle Grouped Metric): the search ranks and pages,
 * the metric fills exactly that page — both from one server-side definition, so the order and the
 * numbers beside it cannot disagree.
 */
export function useSettlementGroups(
  args: Window & { groupBy: SettlementGroupBy; page: number; pageSize: number },
) {
  const { teamId, from, to, valid, groupBy, page, pageSize } = args;

  return useQuery({
    ...listQuery,
    queryKey: key.settlement(teamId, { report: "groups", groupBy, from, to, page, pageSize }),
    enabled: teamId !== undefined && valid,
    queryFn: async () => {
      const filter = { dateRange: { startDate: from, endDate: to }, groupType: groupTypeOf[groupBy] };

      const ranked = await settlementAnalyticClient.analyticGroupSearch({
        teamId: teamId!,
        filter,
        // The largest shortfall first: close_balance is negative, so ASCENDING is worst first.
        sort: AnalyticMetricSort.CLOSE_BALANCE,
        sortType: CommonSortType.ASC,
        page: { page, limit: pageSize },
      });

      const totalItems = Number(ranked.pageInfo?.totalItems ?? 0n);

      if (ranked.ids.length === 0) {
        return { rows: [] as SettlementGroupRow[], totalItems };
      }

      const filled = await settlementAnalyticClient.analyticGroupMetric({
        teamId: teamId!,
        filter,
        ids: ranked.ids,
      });

      return {
        rows: ranked.ids.map(
          (id): SettlementGroupRow => ({ id, measure: measureOf(filled.metrics[id.toString()]) }),
        ),
        totalItems,
      };
    },
  });
}
