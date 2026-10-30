import { Code, ConnectError, type ServiceImpl } from "@connectrpc/connect";

import { bucketOfDay, timeSpine } from "../src/features/analytic/provider";
import type { TimeGroup } from "../src/features/analytic/catalogue";
import { type FilterItem, GroupType, SortType } from "../src/gen/warehouse/analytic_base/v1/analytic_pb";
import type { SettlementAnalyticService } from "../src/gen/warehouse/settlement/v1/settlement_analytic_pb";
import { type SettlementBookRow, dayKey, settlementBook } from "./fixtures";

// THE SETTLEMENT METRICS, as settlement_service serves them — folded from the ledger book in fixtures.ts with the
// service's own rules, so a story checks the screen against the arithmetic the RPC keeps, not against itself:
//
//   a movement      summed over the key's days in the window
//   the position    Σ change over every row up to the key's END, never a sum of periods (a-position-is-its-own-stat-type)
//   an id key       anything with a row up to the window's end — a shop quiet in the window still ranks
//   a period key    every period of the window, a quiet one included; one outside the window is zero
//   a shop AND a person together is refused (one-settlement-metric-reads-both-tables)

const ROOT_TEAM = 1n;

const TIME: Partial<Record<GroupType, TimeGroup>> = {
  [GroupType.DAILY]: "daily",
  [GroupType.WEEKLY]: "weekly",
  [GroupType.MONTHLY]: "monthly",
  [GroupType.YEARLY]: "yearly",
};

type Row = SettlementBookRow & { date: string };

interface Scope {
  from: string;
  to: string;
  shop?: bigint;
  user?: bigint;
  team?: bigint;
}

function scopeOf(teamId: bigint, groupBy: GroupType, items: FilterItem[]): { scope: Scope; rows: Row[] } {
  const scope: Scope = { from: "", to: "" };

  for (const { f } of items) {
    if (f.case === "dateRangeFilter") {
      scope.from = f.value.dateMin;
      scope.to = f.value.dateMax;
    }
    if (f.case === "shopFilter") scope.shop = f.value.shopId;
    if (f.case === "userFilter") scope.user = f.value.userId;
    if (f.case === "teamFilter") scope.team = f.value.teamId;
  }

  const person = groupBy === GroupType.USER || scope.user !== undefined;
  const shop = groupBy === GroupType.SHOP || scope.shop !== undefined;
  if (person && shop) throw new ConnectError("a shop and a person cannot be read together", Code.InvalidArgument);

  const rows = settlementBook
    .map((row) => ({ ...row, date: dayKey(row.ago) }))
    .filter((row) => teamId === ROOT_TEAM || row.teamId === teamId)
    .filter((row) => scope.team === undefined || row.teamId === scope.team)
    .filter((row) => scope.shop === undefined || row.shopId === scope.shop)
    .filter((row) => scope.user === undefined || row.userId === scope.user);

  return { scope, rows };
}

const sum = (rows: Row[], pick: (row: Row) => bigint) => rows.reduce((total, row) => total + pick(row), 0n);

const changeOf = (row: Row) =>
  row.initialTotal + row.initialTotalCancel + row.fund + row.externalAdsFee + row.marketplaceAdjustment + row.withdrawal;

/** Both metrics' figures for one key: its rows in [from, to], and the position at `to`. */
function figuresOf(rows: Row[], from: string, to: string) {
  const moved = rows.filter((row) => row.date >= from && row.date <= to);
  const sales = -sum(moved, (row) => row.initialTotal + row.initialTotalCancel);
  const types = {
    fund: sum(moved, (row) => row.fund),
    externalAdsFee: sum(moved, (row) => row.externalAdsFee),
    affiliateFee: 0n,
    marketplaceAdjustment: sum(moved, (row) => row.marketplaceAdjustment),
    shipmentAdjustment: 0n,
    logisticReimbursement: 0n,
    platformReimbursement: 0n,
    marketplaceProgram: 0n,
    other: 0n,
    systemAdjustment: 0n,
  };
  const received = Object.values(types).reduce((total, value) => total + value, 0n);
  const gap = sales - received;

  return {
    settlement: {
      sales,
      received,
      withdrawn: -sum(moved, (row) => row.withdrawal),
      gap,
      // From the key's own sums. Unset with no sale to divide by.
      takeRate: sales > 0n ? Number(gap) / Number(sales) : undefined,
      positionToDate: -sum(
        rows.filter((row) => row.date <= to),
        changeOf,
      ),
    },
    types,
  };
}

const ZERO = figuresOf([], "", "");

/** The last day of the period starting on `start`. */
function periodEnd(start: string, group: TimeGroup): string {
  const d = new Date(`${start}T00:00:00Z`);
  if (group === "daily") return start;
  if (group === "weekly") d.setUTCDate(d.getUTCDate() + 6);
  if (group === "monthly") d.setUTCMonth(d.getUTCMonth() + 1, 0);
  if (group === "yearly") d.setUTCFullYear(d.getUTCFullYear() + 1, 0, 0);

  return d.toISOString().slice(0, 10);
}

/** A period key's figures — the period clipped to the window; zero when they do not meet. */
function periodFigures(rows: Row[], scope: Scope, key: string, group: TimeGroup) {
  const from = key > scope.from ? key : scope.from;
  const end = periodEnd(key, group);
  const to = end < scope.to ? end : scope.to;

  return from <= to ? figuresOf(rows, from, to) : ZERO;
}

const idOf = (row: Row, groupBy: GroupType): bigint =>
  groupBy === GroupType.SHOP ? row.shopId : groupBy === GroupType.USER ? row.userId : row.teamId;

/** A field's value by its proto name — `position_to_date` → `positionToDate`. */
function fieldOf(figures: ReturnType<typeof figuresOf>, metricId: string, field: string): number {
  const local = field.replace(/_(\w)/g, (_, c: string) => c.toUpperCase());
  const message: Record<string, unknown> = metricId === "metrics/settlement/types" ? figures.types : figures.settlement;
  const value = message[local];

  return value === undefined ? Number.NEGATIVE_INFINITY : Number(value);
}

export const settlementAnalyticService: Partial<ServiceImpl<typeof SettlementAnalyticService>> = {
  metricSearch: (req) => {
    const { scope, rows } = scopeOf(req.teamId, req.groupBy, req.filters);
    const metricId = req.sort?.metricId ?? "";
    const field = req.sort?.field ?? "";
    const time = TIME[req.groupBy];

    let ranked: { key: string; value: number; tie: string }[];

    if (time) {
      ranked = timeSpine(scope.from, scope.to, time).map((key) => ({
        key,
        value: fieldOf(periodFigures(rows, scope, key, time), metricId, field),
        tie: key,
      }));
    } else {
      const ids = [...new Set(rows.filter((row) => row.date <= scope.to).map((row) => idOf(row, req.groupBy)))].filter(
        (id) => id > 0n,
      );
      ranked = ids.map((id) => ({
        key: String(id),
        value: fieldOf(
          figuresOf(
            rows.filter((row) => idOf(row, req.groupBy) === id),
            scope.from,
            scope.to,
          ),
          metricId,
          field,
        ),
        tie: String(id).padStart(20, "0"),
      }));
    }

    const sign = req.sort?.sortType === SortType.ASC ? 1 : -1;
    ranked.sort((a, b) => sign * (a.value - b.value) || (a.tie < b.tie ? 1 : a.tie > b.tie ? -1 : 0));

    const offset = req.page?.offset ?? 0;
    const limit = req.page?.limit ?? 20;
    const page = ranked.slice(offset, offset + limit + 1);
    const keys = page.slice(0, limit).map((r) => r.key);

    return {
      keys: time ? { k: { case: "days", value: { days: keys } } } : { k: { case: "ids", value: { ids: keys.map((k) => BigInt(k)) } } },
      hasNext: page.length > limit,
    };
  },

  metricData: (req) => {
    const { scope, rows } = scopeOf(req.teamId, req.groupBy, req.filters);
    const time = TIME[req.groupBy];
    const prefixOf = (metricId: string) => (metricId === "metrics/settlement/types" ? "types" : "settlement");
    const pick = (figures: ReturnType<typeof figuresOf>, metricId: string) =>
      metricId === "metrics/settlement/types" ? figures.types : figures.settlement;

    if (req.groupBy === GroupType.SUMMARY) {
      const figures = figuresOf(rows, scope.from, scope.to);

      return {
        metricDatas: req.metricIds.map((id) => ({ m: { case: `${prefixOf(id)}Summary`, value: pick(figures, id) } })),
      } as never;
    }

    const keys =
      req.keys?.k.case === "days" ? req.keys.k.value.days : req.keys?.k.case === "ids" ? req.keys.k.value.ids.map(String) : [];

    const figuresByKey = new Map(
      keys.map((key) => [
        key,
        time
          ? periodFigures(rows, scope, bucketOfDay(key, time), time)
          : figuresOf(
              rows.filter((row) => String(idOf(row, req.groupBy)) === key),
              scope.from,
              scope.to,
            ),
      ]),
    );

    return {
      metricDatas: req.metricIds.map((id) => ({
        m: {
          case: `${prefixOf(id)}${time ? "ByDay" : "ById"}`,
          value: { items: Object.fromEntries(keys.map((key) => [key, pick(figuresByKey.get(key) ?? ZERO, id)])) },
        },
      })),
    } as never;
  },
};
