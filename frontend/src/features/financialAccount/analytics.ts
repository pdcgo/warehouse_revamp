import type { MessageInitShape } from "@bufbuild/protobuf";
import { useQuery } from "@tanstack/react-query";

import { financialAccountAnalyticClient } from "../../api/clients";
import { key, listQuery } from "../../api/queryClient";
import { type FilterItemSchema, GroupType, SortType } from "../../gen/warehouse/analytic_base/v1/analytic_pb";
import type { AccountChangeMetric } from "../../gen/warehouse/financial_account/v1/financial_account_analytic_pb";
import type {
  FinancialAccountChangeType,
  FinancialAccountProvider,
} from "../../gen/warehouse/financial_account/v1/financial_account_pb";
import type { PeriodGrain } from "../../lib/period";
import { timeSpine } from "../analytic/provider";

// THE ACCOUNTS' REPORT — read through the Finance metrics (the-pattern-replaces-the-shipped-analytics): the same
// `MetricSearch` / `MetricData` the Analytic composer reads, over `metrics/financial_accounts` (the statement) and
// `metrics/financial_accounts/types` (one amount per change type). The three reads this screen had are removed.
//
// Every figure is read from the daily rows, written in the log row's own transaction
// (the-daily-row-is-written-with-the-log-row) — so, unlike settlement's report, these are never behind the balances on
// the accounts page. A balance is one running sum (the-balance-series-is-a-running-sum).
//
// All `listQuery`: a window, a grain, a grouping or a page change refines the same question about the same team, so the
// previous figures stay on screen while the next ones load. Pair with RefreshOverlay.

/** One key's figures as this screen reads them — the nine change types, their net, and the balance at the two edges. */
export interface Metric {
  expense: number;
  adsExpense: number;
  adjustment: number;
  withdrawal: number;
  restock: number;
  /** The change TYPE opening_balance — an account's first deposit (the metric's `account_opening`). */
  openingBalance: number;
  transfer: number;
  teamPayment: number;
  capital: number;
  change: number;
  /** The balance at the key's first day in the window (the metric's `opening_balance` position). */
  openBalance: number;
  /** The balance at its last day (`closing_balance`). */
  closeBalance: number;
}

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

const CHANGES = "metrics/financial_accounts";
const TYPES = "metrics/financial_accounts/types";

/** An Account changes answer as the screen's Metric — the positions renamed apart from the change type. */
function metricOf(m: AccountChangeMetric | undefined): Metric {
  if (!m) return { ...ZERO };

  return {
    expense: m.expense,
    adsExpense: m.adsExpense,
    adjustment: m.adjustment,
    withdrawal: m.withdrawal,
    restock: m.restock,
    openingBalance: m.accountOpening,
    transfer: m.transfer,
    teamPayment: m.teamPayment,
    capital: m.capital,
    change: m.change,
    openBalance: m.openingBalance,
    closeBalance: m.closingBalance,
  };
}

const GROUP_OF_GRAIN: Record<PeriodGrain, GroupType> = {
  day: GroupType.DAILY,
  month: GroupType.MONTHLY,
  year: GroupType.YEARLY,
};

const SPINE_OF_GRAIN = { day: "daily", month: "monthly", year: "yearly" } as const;

export type AccountGroupBy = "account" | "provider" | "changeType";

const GROUP_OF: Record<AccountGroupBy, GroupType> = {
  account: GroupType.ACCOUNT,
  provider: GroupType.PROVIDER,
  changeType: GroupType.CHANGE_TYPE,
};

interface Window {
  teamId: bigint | undefined;
  from: string;
  to: string;
  /** False when the window is unbounded, backwards or over a year — the screen explains, nothing is sent. */
  valid: boolean;
}

type Filter = MessageInitShape<typeof FilterItemSchema>;

/**
 * The window, and one account when picked (finance-filters-by-account) — what every report read sends, and so what its
 * export sends (a-report-export-is-the-whole-view-as-a-file).
 */
export function filtersOf(from: string, to: string, accountId?: bigint): Filter[] {
  const out: Filter[] = [{ f: { case: "dateRangeFilter", value: { dateMin: from, dateMax: to } } }];
  if (accountId && accountId > 0n) out.push({ f: { case: "accountFilter", value: { accountIds: [accountId] } } });

  return out;
}

/** The WHOLE window as one metric — the team's, or one account's: the metric grouped by SUMMARY. */
export function useAccountReportSummary({ teamId, from, to, valid, accountId }: Window & { accountId: bigint }) {
  return useQuery({
    ...listQuery,
    queryKey: key.financialAccounts(teamId, { report: "summary", from, to, account: accountId.toString() }),
    enabled: teamId !== undefined && valid,
    queryFn: async (): Promise<Metric> => {
      const res = await financialAccountAnalyticClient.metricData({
        teamId: teamId!,
        groupBy: GroupType.SUMMARY,
        filters: filtersOf(from, to, accountId),
        metricIds: [CHANGES],
      });
      const m = res.metricDatas[0]?.m;

      return metricOf(m?.case === "changesSummary" ? m.value : undefined);
    },
  });
}

export interface AccountReportPoint {
  /** The bucket's first day, `yyyy-mm-dd`. */
  at: string;
  metric: Metric;
}

/**
 * The window, period by period — every bucket including the quiet ones; NEWEST first unless asked otherwise. A time
 * group sorted by its period needs no search: the screen lists the periods itself and fills a page of them.
 */
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
      const spine = timeSpine(from, to, SPINE_OF_GRAIN[grain]);
      if (dir === "desc") spine.reverse();
      const days = spine.slice((page - 1) * pageSize, page * pageSize);

      if (days.length === 0) return { points: [] as AccountReportPoint[], totalItems: spine.length };

      const res = await financialAccountAnalyticClient.metricData({
        teamId: teamId!,
        groupBy: GROUP_OF_GRAIN[grain],
        filters: filtersOf(from, to, accountId),
        keys: { k: { case: "days", value: { days } } },
        metricIds: [CHANGES],
      });
      const m = res.metricDatas[0]?.m;
      const items = m?.case === "changesByDay" ? m.value.items : {};

      return {
        points: days.map((at): AccountReportPoint => ({ at, metric: metricOf(items[at]) })),
        totalItems: spine.length,
      };
    },
  });
}

/** A group's key, typed by what it is — an account's id, or a provider's or a change type's enum number. */
export type AccountReportKey =
  | { case: "accountId"; value: bigint }
  | { case: "provider"; value: FinancialAccountProvider }
  | { case: "changeType"; value: FinancialAccountChangeType };

export interface AccountReportGroupRow {
  key: AccountReportKey;
  metric: Metric;
}

/** What the ranking is ordered by — the movement (by size) or where each closed. */
export type AccountGroupSort = { by: "change" | "close"; dir: "asc" | "desc" };

/**
 * Accounts, providers or change types RANKED, then filled — MetricSearch then MetricData, so the order and the numbers
 * beside it come from one server-side definition. A change-type key carries its type's figure as `change` and no
 * balance (the Change types metric's `amount`).
 *
 * Ranked by the movement BY SIZE — the largest in or out first — as this screen always has: the search returns every
 * key (an account list is small, there are six providers and nine types), and the size order is applied here.
 */
export function useAccountReportGroups(
  args: Window & { groupBy: AccountGroupBy; page: number; pageSize: number; sort?: AccountGroupSort },
) {
  const { teamId, from, to, valid, groupBy, page, pageSize, sort = { by: "change", dir: "desc" } } = args;

  return useQuery({
    ...listQuery,
    queryKey: key.financialAccounts(teamId, { report: "groups", groupBy, from, to, page, pageSize, sort: `${sort.by}:${sort.dir}` }),
    enabled: teamId !== undefined && valid,
    queryFn: async () => {
      const metricId = groupBy === "changeType" ? TYPES : CHANGES;
      const field = groupBy === "changeType" ? "amount" : sort.by === "close" ? "closing_balance" : "change";
      const filters = filtersOf(from, to);

      const ranked = await financialAccountAnalyticClient.metricSearch({
        teamId: teamId!,
        groupBy: GROUP_OF[groupBy],
        filters,
        sort: { metricId, field, sortType: sort.dir === "asc" ? SortType.ASC : SortType.DESC },
        page: { offset: 0, limit: 200 },
      });
      const ids = ranked.keys?.k.case === "ids" ? ranked.keys.k.value.ids : [];
      if (ids.length === 0) return { rows: [] as AccountReportGroupRow[], totalItems: 0 };

      const filled = await financialAccountAnalyticClient.metricData({
        teamId: teamId!,
        groupBy: GROUP_OF[groupBy],
        filters,
        keys: { k: { case: "ids", value: { ids } } },
        metricIds: [metricId],
      });
      const m = filled.metricDatas[0]?.m;

      const rows = ids.map((id): AccountReportGroupRow => {
        const k = id.toString();
        const metric =
          m?.case === "typesById"
            ? { ...ZERO, change: m.value.items[k]?.amount ?? 0 }
            : metricOf(m?.case === "changesById" ? m.value.items[k] : undefined);
        const rowKey: AccountReportKey =
          groupBy === "account"
            ? { case: "accountId", value: id }
            : groupBy === "provider"
              ? { case: "provider", value: Number(id) as FinancialAccountProvider }
              : { case: "changeType", value: Number(id) as FinancialAccountChangeType };

        return { key: rowKey, metric };
      });

      // The movement by SIZE, the key breaking a tie as the server's does.
      if (sort.by === "change") {
        const sign = sort.dir === "asc" ? 1 : -1;
        rows.sort(
          (a, b) => sign * (Math.abs(a.metric.change) - Math.abs(b.metric.change)) || Number(b.key.value) - Number(a.key.value),
        );
      }

      return { rows: rows.slice((page - 1) * pageSize, page * pageSize), totalItems: rows.length };
    },
  });
}
