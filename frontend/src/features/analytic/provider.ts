// THE METRIC PROVIDER — the two steps of docs/business/analytic/rpc_provide.md, in plain TypeScript with no React, so an
// export or a later screen can reuse it (rpc_provide_clarify.md#the-two-steps):
//
//   1. ONE MetricSearch, in the service that owns the sorted field — it returns the ranked keys and whether another
//      page follows. A time group sorted by date needs no search: the provider lists the days itself.
//   2. MetricData in EVERY service that owns a selected metric, with the same keys and the same filters — the filters
//      scope the numbers, never the keys (the-fill-step-scopes-its-numbers-by-the-filters).
//   And the headline: the same metrics read with group SUMMARY and no keys (the-headline-is-the-metric-grouped-by-summary).
//
// A metric with a `schema` is SERVED: its service answers MetricSearch / MetricData over the wire — the five order
// metrics, by selling_service. Every other metric is still a SAMPLE (sample.ts), answered here by the same two steps,
// until its service ships. The steps do not change between the two.

import type { DescMessage, MessageInitShape } from "@bufbuild/protobuf";

import { orderAnalyticClient } from "../../api/clients";
import {
  type FilterItemSchema,
  GroupType as PbGroupType,
  type MetricKeysSchema,
  SortType,
} from "../../gen/warehouse/analytic_base/v1/analytic_pb";
import type { MetricData } from "../../gen/warehouse/selling/v1/order_analytic_pb";
import { daySpine } from "../../lib/period";
import { type FilterType, type MetricDef, type TableGroup, type TimeGroup, isTimeGroup, metricById } from "./catalogue";
import { type Fact, sampleFacts } from "./sample";

export type SortDirection = "asc" | "desc";

/** A table's ONE sort (one-sort-field-per-table): a field of a metric, or — for a time group — the period itself. */
export type ReportSort = { by: "key"; dir: SortDirection } | { by: "field"; metricId: string; field: string; dir: SortDirection };

/** The filters a request carries — only those every selected metric supports. The date range is always set. */
export interface ReportFilters {
  from: string;
  to: string;
  shop?: string;
  product?: string;
  supplier?: string;
  /** The seller (the-team-group-is-the-seller). */
  team?: string;
  warehouse?: string;
  user?: string;
}

/**
 * A metric's figures for one key — every field, zero when nothing happened. ⚠ A field the service left UNSET is ABSENT,
 * never 0: a warehouse is not shown a seller's money (a-warehouse-sees-no-seller-money), and the screen drops its column.
 */
export type MetricBody = Record<string, number>;

/**
 * A key is a string here — a shop id ("13") or a bucket's first day ("2026-10-01"). The contract carries an `IDList` of
 * uint64 or a `DayList` of strings (the-key-lives-in-the-map); the provider converts at the wire.
 */
export type ReportKey = string;

export interface ReportRequest {
  groupBy: TableGroup;
  metricIds: string[];
  filters: ReportFilters;
  sort: ReportSort;
  page: number;
  pageSize: number;
}

export interface ReportResult {
  /** The rows, in order — exactly the keys step 1 sent (the-rows-are-the-keys-step-one-sends). */
  keys: ReportKey[];
  /** Read limit + 1 — no total (a-page-says-whether-another-follows). */
  hasNext: boolean;
  /** metricId → key → body. Every asked key is present. */
  cells: Record<string, Record<ReportKey, MetricBody>>;
  /** metricId → the headline body, group SUMMARY. */
  summary: Record<string, MetricBody>;
}

export const EMPTY_REPORT: ReportResult = { keys: [], hasNext: false, cells: {}, summary: {} };

// ── keys ─────────────────────────────────────────────────────────────────────────────────────────

/** The Monday a day's ISO week starts on — a week is Monday to Sunday, Jakarta (a-week-is-monday-to-sunday-jakarta). */
function mondayOf(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));

  return d.toISOString().slice(0, 10);
}

/** A day's bucket at a time group — always the bucket's first day. */
export function bucketOfDay(day: string, group: TimeGroup): string {
  if (group === "weekly") return mondayOf(day);
  if (group === "monthly") return `${day.slice(0, 7)}-01`;
  if (group === "yearly") return `${day.slice(0, 4)}-01-01`;

  return day;
}

/** Every bucket a window touches, oldest first — a quiet one included, so a missing row never reads as one that did not load. */
export function timeSpine(from: string, to: string, group: TimeGroup): string[] {
  const out: string[] = [];
  for (const day of daySpine(from, to)) {
    const bucket = bucketOfDay(day, group);
    if (out[out.length - 1] !== bucket) out.push(bucket);
  }

  return out;
}

function keyOf(fact: Fact, group: TableGroup): ReportKey | undefined {
  if (isTimeGroup(group)) return bucketOfDay(fact.day, group);
  if (group === "shop") return fact.shop;
  if (group === "product") return fact.product;
  if (group === "supplier") return fact.supplier;
  if (group === "team") return fact.team;
  if (group === "warehouse") return fact.warehouse;
  if (group === "user") return fact.user;

  return undefined;
}

/** Ids compare as numbers, days as strings. The tie-breaker is always the key, DESC (the-key-breaks-every-tie). */
function compareKeys(a: ReportKey, b: ReportKey, group: TableGroup): number {
  if (isTimeGroup(group)) return a < b ? -1 : a > b ? 1 : 0;

  return Number(a) - Number(b);
}

// ── one sample service ──────────────────────────────────────────────────────────────────────────

/** A metric honours only the filters it declares — the provider never sends it another. */
function inScope(def: MetricDef, fact: Fact, filters: ReportFilters): boolean {
  if (fact.day < filters.from || fact.day > filters.to) return false;

  const checks: [FilterType, string | undefined, string | undefined][] = [
    ["shop", filters.shop, fact.shop],
    ["product", filters.product, fact.product],
    ["supplier", filters.supplier, fact.supplier],
    ["team", filters.team, fact.team],
    ["warehouse", filters.warehouse, fact.warehouse],
    ["user", filters.user, fact.user],
  ];

  return checks.every(([type, wanted, actual]) => !wanted || !def.supportedFilters.includes(type) || wanted === actual);
}

function emptyBody(def: MetricDef): MetricBody {
  return Object.fromEntries(def.fields.map((f) => [f.name, 0]));
}

/** Sum a metric's facts in scope, by key — the fold a real service reads from its report table. */
function rollUp(def: MetricDef, group: TableGroup | "summary", filters: ReportFilters): Map<ReportKey, MetricBody> {
  const out = new Map<ReportKey, MetricBody>();

  for (const fact of sampleFacts(def.metricId)) {
    if (!inScope(def, fact, filters)) continue;

    const key = group === "summary" ? "" : keyOf(fact, group);
    if (key === undefined) continue;

    const body = out.get(key) ?? emptyBody(def);
    for (const field of def.fields) body[field.name] = (body[field.name] ?? 0) + (fact.values[field.name] ?? 0);
    out.set(key, body);
  }

  return out;
}

/**
 * THE SAMPLE SERVICE — the two steps over invented facts. Exported because the Storybook stub answers a SERVED metric's
 * RPCs with it, so a story reads the same numbers through the wire as the samples read here.
 */
export const sampleService = {
  /** STEP 1 — only keys it HAS figures for; ranked; the key DESC on a tie; limit + 1. */
  search(
    def: MetricDef,
    req: { groupBy: TableGroup; filters: ReportFilters; field: string; dir: SortDirection; offset: number; limit: number },
  ): { keys: ReportKey[]; hasNext: boolean } {
    const rows = [...rollUp(def, req.groupBy, req.filters).entries()];
    const sign = req.dir === "desc" ? -1 : 1;
    rows.sort(([ka, a], [kb, b]) => sign * ((a[req.field] ?? 0) - (b[req.field] ?? 0)) || -compareKeys(ka, kb, req.groupBy));

    const taken = rows.slice(req.offset, req.offset + req.limit + 1);

    return { keys: taken.slice(0, req.limit).map(([key]) => key), hasNext: taken.length > req.limit };
  },

  /** STEP 2 — every asked key, an all-zero body where nothing happened. */
  data(def: MetricDef, groupBy: TableGroup, filters: ReportFilters, keys: ReportKey[]): Record<ReportKey, MetricBody> {
    const rolled = rollUp(def, groupBy, filters);

    return Object.fromEntries(keys.map((key) => [key, rolled.get(key) ?? emptyBody(def)]));
  },

  /** THE HEADLINE — the same metric, group SUMMARY, no keys: equal to the rows by construction. */
  summary(def: MetricDef, filters: ReportFilters): MetricBody {
    return rollUp(def, "summary", filters).get("") ?? emptyBody(def);
  },
};

// ── a served metric, over the wire ──────────────────────────────────────────────────────────────

const PB_GROUP: Record<TableGroup | "summary", PbGroupType> = {
  summary: PbGroupType.SUMMARY,
  daily: PbGroupType.DAILY,
  weekly: PbGroupType.WEEKLY,
  monthly: PbGroupType.MONTHLY,
  yearly: PbGroupType.YEARLY,
  product: PbGroupType.PRODUCT,
  shop: PbGroupType.SHOP,
  supplier: PbGroupType.SUPPLIER,
  team: PbGroupType.TEAM,
  warehouse: PbGroupType.WAREHOUSE,
  user: PbGroupType.USER,
};

type Filter = MessageInitShape<typeof FilterItemSchema>;

/** The request's filters as the contract carries them — each case's number is its FilterType's. */
function wireFilters(filters: ReportFilters): Filter[] {
  const out: Filter[] = [{ f: { case: "dateRangeFilter", value: { dateMin: filters.from, dateMax: filters.to } } }];
  const id = (v: string) => BigInt(v);

  if (filters.shop) out.push({ f: { case: "shopFilter", value: { shopId: id(filters.shop) } } });
  if (filters.product) out.push({ f: { case: "productFilter", value: { productId: id(filters.product) } } });
  if (filters.supplier) out.push({ f: { case: "supplierFilter", value: { supplierId: id(filters.supplier) } } });
  if (filters.team) out.push({ f: { case: "teamFilter", value: { teamId: id(filters.team) } } });
  if (filters.warehouse) out.push({ f: { case: "warehouseFilter", value: { warehouseId: id(filters.warehouse) } } });
  if (filters.user) out.push({ f: { case: "userFilter", value: { userId: id(filters.user) } } });

  return out;
}

function wireKeys(group: TableGroup, keys: ReportKey[]): MessageInitShape<typeof MetricKeysSchema> {
  return isTimeGroup(group)
    ? { k: { case: "days", value: { days: keys } } }
    : { k: { case: "ids", value: { ids: keys.map((k) => BigInt(k)) } } };
}

/**
 * A metric message as a body: every number field by its proto name, as a JS number. An UNSET optional field is left
 * out — that is how a warehouse is told the money is not its to see (a-warehouse-sees-no-seller-money).
 */
function bodyOf(schema: DescMessage, message: unknown): MetricBody {
  const values = message as Record<string, unknown>;
  const out: MetricBody = {};

  for (const field of schema.fields) {
    const value = values[field.localName];
    if (typeof value === "bigint" || typeof value === "number") out[field.name] = Number(value);
  }

  return out;
}

/** One MetricData answer: the headline body, or a body per key. */
function answerOf(schema: DescMessage, data: MetricData): { summary?: MetricBody; items?: Record<ReportKey, MetricBody> } {
  const { m } = data;
  if (m.case === undefined) return {};

  if (m.case.endsWith("Summary")) return { summary: bodyOf(schema, m.value) };

  const items = (m.value as { items: Record<string, unknown> }).items;

  return { items: Object.fromEntries(Object.entries(items).map(([key, value]) => [key, bodyOf(schema, value)])) };
}

/**
 * A served service's client — what the two steps call. One per service; only selling serves metrics so far.
 *
 * ⚠ Looked up at CALL time, never in a module-level table: the Storybook stub imports this module for `sampleService`,
 * and the stub is what `api/clients` is built on, so reading a client while this module loads reads it uninitialised.
 */
function clientOf(def: MetricDef) {
  if (def.service === "selling") return orderAnalyticClient;

  throw new Error(`no client for ${def.service}, which serves ${def.metricId}`);
}

// ── the composer ────────────────────────────────────────────────────────────────────────────────

/**
 * The report for a team. `teamId` is the caller's SCOPE — what every served RPC is authorised in, and what decides
 * whose orders it reads (a-warehouse-reads-the-orders-it-ships).
 */
export async function loadReport(req: ReportRequest, teamId: bigint): Promise<ReportResult> {
  const defs = req.metricIds.map(metricById).filter((d): d is MetricDef => d !== undefined);
  if (defs.length === 0) return EMPTY_REPORT;

  const offset = (req.page - 1) * req.pageSize;

  // STEP 1 — one search, in the service that owns the sorted field. A time group sorted by its period asks no one.
  let keys: ReportKey[];
  let hasNext: boolean;
  const ranker = req.sort.by === "field" ? metricById(req.sort.metricId) : undefined;

  if (req.sort.by === "field" && ranker?.schema) {
    const res = await clientOf(ranker).metricSearch({
      teamId,
      groupBy: PB_GROUP[req.groupBy],
      filters: wireFilters(req.filters),
      sort: { metricId: ranker.metricId, field: req.sort.field, sortType: req.sort.dir === "asc" ? SortType.ASC : SortType.DESC },
      page: { offset, limit: req.pageSize },
    });

    const found = res.keys?.k;
    keys = found?.case === "days" ? found.value.days : found?.case === "ids" ? found.value.ids.map(String) : [];
    hasNext = res.hasNext;
  } else if (req.sort.by === "field" && ranker) {
    ({ keys, hasNext } = sampleService.search(ranker, {
      groupBy: req.groupBy,
      filters: req.filters,
      field: req.sort.field,
      dir: req.sort.dir,
      offset,
      limit: req.pageSize,
    }));
  } else if (isTimeGroup(req.groupBy)) {
    const spine = timeSpine(req.filters.from, req.filters.to, req.groupBy);
    if (req.sort.dir === "desc") spine.reverse();
    keys = spine.slice(offset, offset + req.pageSize);
    hasNext = spine.length > offset + req.pageSize;
  } else {
    keys = [];
    hasNext = false;
  }

  // STEP 2 — every service fills the same keys, under the same filters. A sample answers here; a served service
  // answers every one of its metrics in one call per question (one-call-answers-every-asked-metric).
  const cells: ReportResult["cells"] = {};
  const summary: ReportResult["summary"] = {};

  for (const def of defs.filter((d) => !d.schema)) {
    cells[def.metricId] = sampleService.data(def, req.groupBy, req.filters, keys);
    summary[def.metricId] = sampleService.summary(def, req.filters);
  }

  const byService = new Map<string, MetricDef[]>();
  for (const def of defs.filter((d) => d.schema)) byService.set(def.service, [...(byService.get(def.service) ?? []), def]);

  await Promise.all(
    [...byService.values()].map(async (served) => {
      const client = clientOf(served[0]!);
      const metricIds = served.map((d) => d.metricId);
      const filters = wireFilters(req.filters);

      const [headline, filled] = await Promise.all([
        client.metricData({ teamId, groupBy: PbGroupType.SUMMARY, filters, metricIds }),
        keys.length > 0
          ? client.metricData({ teamId, groupBy: PB_GROUP[req.groupBy], filters, keys: wireKeys(req.groupBy, keys), metricIds })
          : undefined,
      ]);

      served.forEach((def, i) => {
        summary[def.metricId] = answerOf(def.schema!, headline.metricDatas[i]!).summary ?? {};

        const items = filled ? (answerOf(def.schema!, filled.metricDatas[i]!).items ?? {}) : {};
        cells[def.metricId] = Object.fromEntries(keys.map((key) => [key, items[key] ?? {}]));
      });
    }),
  );

  return { keys, hasNext, cells, summary };
}

/**
 * THE COLUMNS A REPORT CAN SHOW — each metric without the fields its headline came back without. A served metric leaves
 * a field UNSET when the reader may not see it (a-warehouse-sees-no-seller-money: "the screen only drops a column that
 * came back unset"), so the column goes rather than reading 0. Before an answer, every field stays.
 */
export function answeredFields(defs: MetricDef[], result: ReportResult): MetricDef[] {
  return defs.map((def) => {
    const headline = result.summary[def.metricId];
    if (headline === undefined) return def;

    return { ...def, fields: def.fields.filter((f) => f.name in headline) };
  });
}
