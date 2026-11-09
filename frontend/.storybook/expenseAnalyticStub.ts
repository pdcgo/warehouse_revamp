import type { ServiceImpl } from "@connectrpc/connect";

import { type MetricDef, type TableGroup, EXPENSE_METRICS, isTimeGroup } from "../src/features/analytic/catalogue";
import { type MetricBody, type ReportFilters, sampleService } from "../src/features/analytic/provider";
import { sampleFacts } from "../src/features/analytic/sample";
import { type FilterItem, GroupType, SortType } from "../src/gen/warehouse/analytic_base/v1/analytic_pb";
import type { ExpenseAnalyticService } from "../src/gen/warehouse/expense/v1/expense_analytic_pb";

// ADS EXPENSE AND EXPENSES, as expense_service serves them — answered over the stub transport from the analytic sample's
// expense facts (Toko Melati's ads and typed expenses, Toko Sinar's corrected ads on the day each correction was made,
// Toko Kenanga's rent and payroll, Gudang Pusat's own expenses), through the provider's own `sampleService`, so a story
// drives the real wire path and the numbers cannot disagree with the sample.
//
// THE READER, as the server scopes it: every team reads its own (a fact's `owner`), the root team every team's
// (the-expense-metrics-follow-the-decisions-already-made). THE HEADLINE EQUALS THE ROWS
// (the-expense-prototype-is-accepted): a SUMMARY read carrying `rowsGroup` sums only the facts that group has a key for —
// by Seller the sellers', by Warehouse the warehouses'.
//
// THE "CREATED BY" FEED (ExpensePersonList, a-who-filter-lists-the-people-on-its-rows): everyone a readable fact counts for
// — the typist of an expense, the maker of a correction — the latest day first, the id DESC breaking a tie. With Ads
// expense alone the ads' facts only; otherwise Expenses' facts, which hold every typed kind's.

const GROUP: Partial<Record<GroupType, TableGroup>> = {
  [GroupType.DAILY]: "daily",
  [GroupType.WEEKLY]: "weekly",
  [GroupType.MONTHLY]: "monthly",
  [GroupType.YEARLY]: "yearly",
  [GroupType.SHOP]: "shop",
  [GroupType.TEAM]: "team",
  [GroupType.WAREHOUSE]: "warehouse",
  [GroupType.USER]: "user",
};

function defOf(metricId: string): MetricDef {
  const def = EXPENSE_METRICS.find((m) => m.metricId === metricId);
  if (!def) throw new Error(`expense_service does not serve ${metricId}`);

  return def;
}

function filtersOf(items: FilterItem[]): ReportFilters {
  const out: ReportFilters = { from: "", to: "" };

  for (const { f } of items) {
    if (f.case === "dateRangeFilter") {
      out.from = f.value.dateMin;
      out.to = f.value.dateMax;
    }
    if (f.case === "shopFilter") out.shop = String(f.value.shopId);
    if (f.case === "teamFilter") out.team = String(f.value.teamId);
    if (f.case === "userFilter") out.user = String(f.value.userId);
  }

  return out;
}

/**
 * EVERY expense-metric request, as sent — the rpc, the reading team, the group, the headline's `rowsGroup` and the
 * filters — so a story can assert what reached the wire. A story empties it from its `beforeEach`.
 */
export const expenseMetricCalls: {
  rpc: "metricSearch" | "metricData";
  teamId: bigint;
  groupBy: GroupType;
  rowsGroup: GroupType;
  filters: FilterItem[];
}[] = [];

/** EVERY ExpensePersonList request, as sent — the reading team and the metrics named — emptied from a story's `beforeEach`. */
export const expensePersonCalls: { teamId: bigint; metricIds: string[] }[] = [];

const ROOT_READER = "1";

function messageOf(def: MetricDef, body: MetricBody): Record<string, number> {
  return Object.fromEntries(def.fields.map((f) => [f.name, body[f.name] ?? 0]));
}

/** The case names of one metric's answer — `adsSummary`, `expensesByDay`, … — as the generated oneof spells them. */
const CASE: Record<string, string> = { "metrics/ads": "ads", "metrics/expenses": "expenses" };

export const expenseAnalyticService: Partial<ServiceImpl<typeof ExpenseAnalyticService>> = {
  expensePersonList: (req) => {
    const metricIds = req.filter?.metricIds ?? [];
    expensePersonCalls.push({ teamId: req.teamId, metricIds: [...metricIds] });
    for (const id of metricIds) defOf(id);

    const reader = String(req.teamId);
    const adsOnly = metricIds.length > 0 && metricIds.every((id) => id === "metrics/ads");
    const last = new Map<string, string>();

    for (const fact of sampleFacts(adsOnly ? "metrics/ads" : "metrics/expenses")) {
      if (!fact.user || fact.user === "0") continue;
      if (reader !== ROOT_READER && fact.owner !== reader) continue;
      if ((last.get(fact.user) ?? "") < fact.day) last.set(fact.user, fact.day);
    }

    const ids = [...last.keys()]
      .map((id) => BigInt(id))
      .sort((a, b) => {
        const da = last.get(String(a))!;
        const db = last.get(String(b))!;

        return da !== db ? (da < db ? 1 : -1) : a < b ? 1 : -1;
      });

    return {
      items: [
        {
          d: {
            case: "person" as const,
            value: { mapData: Object.fromEntries(ids.map((id) => [id.toString(), { userId: id, lastDay: last.get(String(id))! }])) },
          },
        },
      ],
      ids,
      pageInfo: { currentPage: 1, totalPage: 1, totalItems: BigInt(ids.length) },
    };
  },

  metricSearch: (req) => {
    expenseMetricCalls.push({
      rpc: "metricSearch",
      teamId: req.teamId,
      groupBy: req.groupBy,
      rowsGroup: GroupType.UNSPECIFIED,
      filters: req.filters,
    });
    const groupBy = GROUP[req.groupBy]!;
    const { keys, hasNext } = sampleService.search(defOf(req.sort?.metricId ?? ""), {
      groupBy,
      filters: filtersOf(req.filters),
      field: req.sort?.field ?? "",
      dir: req.sort?.sortType === SortType.ASC ? "asc" : "desc",
      offset: req.page?.offset ?? 0,
      limit: req.page?.limit ?? 20,
      reader: String(req.teamId),
    });

    return {
      keys: isTimeGroup(groupBy)
        ? { k: { case: "days", value: { days: keys } } }
        : { k: { case: "ids", value: { ids: keys.map((k) => BigInt(k)) } } },
      hasNext,
    };
  },

  metricData: (req) => {
    expenseMetricCalls.push({
      rpc: "metricData",
      teamId: req.teamId,
      groupBy: req.groupBy,
      rowsGroup: req.rowsGroup,
      filters: req.filters,
    });
    const filters = filtersOf(req.filters);
    const reader = String(req.teamId);

    return {
      // The report is written in the expense's own transaction — as of the read.
      asOfUnix: BigInt(Math.floor(Date.now() / 1000)),
      metricDatas: req.metricIds.map((id) => {
        const def = defOf(id);
        const name = CASE[id]!;

        if (req.groupBy === GroupType.SUMMARY) {
          const rows = GROUP[req.rowsGroup];

          return { m: { case: `${name}Summary`, value: messageOf(def, sampleService.summary(def, filters, reader, rows)) } };
        }

        const groupBy = GROUP[req.groupBy]!;
        const keys =
          req.keys?.k.case === "days" ? req.keys.k.value.days : req.keys?.k.case === "ids" ? req.keys.k.value.ids.map(String) : [];
        const bodies = sampleService.data(def, groupBy, filters, keys, reader);

        return {
          m: {
            case: isTimeGroup(groupBy) ? `${name}ByDay` : `${name}ById`,
            value: { items: Object.fromEntries(keys.map((key) => [key, messageOf(def, bodies[key] ?? {})])) },
          },
        };
      }),
    } as never;
  },
};
