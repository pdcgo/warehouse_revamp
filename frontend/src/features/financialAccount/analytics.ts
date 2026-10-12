import { useQuery } from "@tanstack/react-query";

import { financialAccountAnalyticClient } from "../../api/clients";
import { key, listQuery } from "../../api/queryClient";
import { CommonSortType } from "../../gen/warehouse/common/v1/list_pb";
import {
  type AnalyticGroupKey,
  AnalyticGroupType,
  AnalyticMetricSort,
  AnalyticTimeframe,
  type FinancialAccountMetric,
} from "../../gen/warehouse/financial_account/v1/financial_account_pb";
import type { PeriodGrain } from "../../lib/period";

// THE ACCOUNTS' REPORTS — settlement's delivery (analytics-are-delivered-the-settlement-way): a time
// series, and a ranking that is searched first and filled second.
//
// Every figure is read from the daily rows, written in the log row's own transaction
// (the-daily-row-is-written-with-the-log-row) — so, unlike settlement's report, these are never behind
// the balances on the accounts page.
//
// All `listQuery`: a window, a grain, a grouping or a page change refines the same question about the
// same team, so the previous figures stay on screen while the next ones load. Pair with RefreshOverlay.

export type Metric = Omit<FinancialAccountMetric, "$typeName" | "$unknown">;

const ZERO: Metric = {
  expense: 0,
  adsExpense: 0,
  adjustment: 0,
  withdrawal: 0,
  restock: 0,
  openingBalance: 0,
  transfer: 0,
  teamPayment: 0,
  capital: 0,
  change: 0,
  openBalance: 0,
  closeBalance: 0,
};

const metricOf = (m: FinancialAccountMetric | undefined): Metric => (m ? { ...ZERO, ...m } : { ...ZERO });

function sum(metrics: Metric[]): Metric {
  const out = { ...ZERO };

  for (const m of metrics) {
    for (const field of Object.keys(ZERO) as (keyof Metric)[]) {
      out[field] += m[field];
    }
  }

  return out;
}

const timeframeOf: Record<PeriodGrain, AnalyticTimeframe> = {
  day: AnalyticTimeframe.DAILY,
  month: AnalyticTimeframe.MONTHLY,
  year: AnalyticTimeframe.YEARLY,
};

export type AccountGroupBy = "account" | "provider" | "changeType";

const groupTypeOf: Record<AccountGroupBy, AnalyticGroupType> = {
  account: AnalyticGroupType.ACCOUNT,
  provider: AnalyticGroupType.PROVIDER,
  changeType: AnalyticGroupType.CHANGE_TYPE,
};

interface Window {
  teamId: bigint | undefined;
  from: string;
  to: string;
  /** False when the window is unbounded or backwards — the screen explains, nothing is sent. */
  valid: boolean;
}

/**
 * The WHOLE window as one metric — the team's, or one account's.
 *
 * The team's is the sum of its PROVIDERS: a closed set of at most six, so one page is all of them, and
 * every account belongs to exactly one. Asked of the server rather than summed from the series on
 * screen, which is paginated and would change the headline as somebody turned pages.
 */
export function useAccountReportSummary({ teamId, from, to, valid, accountId }: Window & { accountId: bigint }) {
  return useQuery({
    ...listQuery,
    queryKey: key.financialAccounts(teamId, { report: "summary", from, to, account: accountId.toString() }),
    enabled: teamId !== undefined && valid,
    queryFn: async (): Promise<Metric> => {
      const dateRange = { startDate: from, endDate: to };

      if (accountId > 0n) {
        const res = await financialAccountAnalyticClient.analyticGroupMetric({
          teamId: teamId!,
          filter: { dateRange, groupType: AnalyticGroupType.ACCOUNT },
          keys: [{ key: { case: "accountId", value: accountId } }],
        });

        return metricOf(res.items[0]?.metric);
      }

      const filter = { dateRange, groupType: AnalyticGroupType.PROVIDER };
      const providers = await financialAccountAnalyticClient.analyticGroupSearch({
        teamId: teamId!,
        filter,
        page: { page: 1, limit: 200 },
      });

      if (providers.keys.length === 0) return { ...ZERO };

      const res = await financialAccountAnalyticClient.analyticGroupMetric({
        teamId: teamId!,
        filter,
        keys: providers.keys,
      });

      return sum(res.items.map((item) => metricOf(item.metric)));
    },
  });
}

export interface AccountReportPoint {
  /** The bucket's first day, `yyyy-mm-dd`. */
  at: string;
  metric: Metric;
}

/** The window, period by period — every bucket including the quiet ones; NEWEST first unless asked otherwise. */
export function useAccountReportSeries(
  args: Window & { grain: PeriodGrain; accountId: bigint; page: number; pageSize: number; dir?: "asc" | "desc" },
) {
  const { teamId, from, to, valid, grain, accountId, page, pageSize, dir = "desc" } = args;

  return useQuery({
    ...listQuery,
    queryKey: key.financialAccounts(teamId, {
      report: "series",
      grain,
      from,
      to,
      account: accountId.toString(),
      dir,
      page,
      pageSize,
    }),
    enabled: teamId !== undefined && valid,
    queryFn: async () => {
      const res = await financialAccountAnalyticClient.analyticTimeSearch({
        teamId: teamId!,
        timeframe: timeframeOf[grain],
        filter: { dateRange: { startDate: from, endDate: to }, accountId },
        sortType: dir === "asc" ? CommonSortType.ASC : CommonSortType.DESC,
        page: { page, limit: pageSize },
      });

      return {
        points: res.datas.map((d): AccountReportPoint => ({ at: d.at, metric: metricOf(d.metric) })),
        totalItems: Number(res.pageInfo?.totalItems ?? 0n),
      };
    },
  });
}

export interface AccountReportGroupRow {
  key: AnalyticGroupKey["key"];
  metric: Metric;
}

/**
 * Accounts, providers or change types RANKED by how much they moved, then filled — two calls by design
 * (analytic_context.md §How We Handle Grouped Metric), so the order and the numbers beside it come from
 * one server-side definition and cannot disagree.
 */
/** What the ranking is ordered by — the movement (by size) or where each closed. */
export type AccountGroupSort = { by: "change" | "close"; dir: "asc" | "desc" };

export function useAccountReportGroups(
  args: Window & { groupBy: AccountGroupBy; page: number; pageSize: number; sort?: AccountGroupSort },
) {
  const { teamId, from, to, valid, groupBy, page, pageSize, sort = { by: "change", dir: "desc" } } = args;

  return useQuery({
    ...listQuery,
    queryKey: key.financialAccounts(teamId, { report: "groups", groupBy, from, to, page, pageSize, sort: `${sort.by}:${sort.dir}` }),
    enabled: teamId !== undefined && valid,
    queryFn: async () => {
      const filter = { dateRange: { startDate: from, endDate: to }, groupType: groupTypeOf[groupBy] };

      const ranked = await financialAccountAnalyticClient.analyticGroupSearch({
        teamId: teamId!,
        filter,
        sort: sort.by === "close" ? AnalyticMetricSort.CLOSE_BALANCE : AnalyticMetricSort.CHANGE,
        sortType: sort.dir === "asc" ? CommonSortType.ASC : CommonSortType.DESC,
        page: { page, limit: pageSize },
      });

      const totalItems = Number(ranked.pageInfo?.totalItems ?? 0n);
      if (ranked.keys.length === 0) return { rows: [] as AccountReportGroupRow[], totalItems };

      const filled = await financialAccountAnalyticClient.analyticGroupMetric({
        teamId: teamId!,
        filter,
        keys: ranked.keys,
      });

      return {
        rows: filled.items.map((item): AccountReportGroupRow => ({ key: item.key!.key, metric: metricOf(item.metric) })),
        totalItems,
      };
    },
  });
}
