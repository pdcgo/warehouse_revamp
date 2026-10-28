// THE METRIC PROVIDER — the two steps of docs/business/analytic/rpc_provide.md, in plain TypeScript with no React, so an
// export or a later screen can reuse it (rpc_provide_clarify.md#the-two-steps):
//
//   1. ONE MetricSearch, in the service that owns the sorted field — it returns the ranked keys and whether another
//      page follows. A time group sorted by date needs no search: the provider lists the days itself.
//   2. MetricData in EVERY service that owns a selected metric, with the same keys and the same filters — the filters
//      scope the numbers, never the keys (the-fill-step-scopes-its-numbers-by-the-filters).
//   And the headline: the same metrics read with group SUMMARY and no keys (the-headline-is-the-metric-grouped-by-summary).
//
// ⚠ THE "SERVICES" BELOW ARE SAMPLES (sample.ts). The day each metric's service ships MetricSearch / MetricData, its
// sample backend is replaced by the RPC client — the two steps here do not change.

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
}

/** A metric's figures for one key — every field, zero when nothing happened. */
export type MetricBody = Record<string, number>;

/**
 * A key is a string here — a shop id ("13") or a bucket's first day ("2026-10-01"). The contract carries an `IDList` of
 * uint64 or a `DayList` of strings (the-key-lives-in-the-map); the mirror keeps one shape until it is wired.
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

/** STEP 1 in the ranking service — only keys it HAS figures for; ranked; the key DESC on a tie; limit + 1. */
function metricSearch(
  def: MetricDef,
  req: { groupBy: TableGroup; filters: ReportFilters; field: string; dir: SortDirection; page: number; pageSize: number },
): { keys: ReportKey[]; hasNext: boolean } {
  const rows = [...rollUp(def, req.groupBy, req.filters).entries()];
  const sign = req.dir === "desc" ? -1 : 1;
  rows.sort(([ka, a], [kb, b]) => sign * ((a[req.field] ?? 0) - (b[req.field] ?? 0)) || -compareKeys(ka, kb, req.groupBy));

  const offset = (req.page - 1) * req.pageSize;
  const taken = rows.slice(offset, offset + req.pageSize + 1);

  return { keys: taken.slice(0, req.pageSize).map(([key]) => key), hasNext: taken.length > req.pageSize };
}

/** STEP 2 in one service — every asked key, an all-zero body where nothing happened. */
function metricData(def: MetricDef, groupBy: TableGroup, filters: ReportFilters, keys: ReportKey[]): Record<ReportKey, MetricBody> {
  const rolled = rollUp(def, groupBy, filters);

  return Object.fromEntries(keys.map((key) => [key, rolled.get(key) ?? emptyBody(def)]));
}

// ── the composer ────────────────────────────────────────────────────────────────────────────────

export function loadReport(req: ReportRequest): ReportResult {
  const defs = req.metricIds.map(metricById).filter((d): d is MetricDef => d !== undefined);
  if (defs.length === 0) return { keys: [], hasNext: false, cells: {}, summary: {} };

  // STEP 1 — one search, in the service that owns the sorted field. A time group sorted by its period asks no one.
  let keys: ReportKey[];
  let hasNext: boolean;
  const ranker = req.sort.by === "field" ? metricById(req.sort.metricId) : undefined;

  if (req.sort.by === "field" && ranker) {
    ({ keys, hasNext } = metricSearch(ranker, {
      groupBy: req.groupBy,
      filters: req.filters,
      field: req.sort.field,
      dir: req.sort.dir,
      page: req.page,
      pageSize: req.pageSize,
    }));
  } else if (isTimeGroup(req.groupBy)) {
    const spine = timeSpine(req.filters.from, req.filters.to, req.groupBy);
    if (req.sort.dir === "desc") spine.reverse();
    const offset = (req.page - 1) * req.pageSize;
    keys = spine.slice(offset, offset + req.pageSize);
    hasNext = spine.length > offset + req.pageSize;
  } else {
    keys = [];
    hasNext = false;
  }

  // STEP 2 — every service fills the same keys, under the same filters.
  const cells: ReportResult["cells"] = {};
  const summary: ReportResult["summary"] = {};
  for (const def of defs) {
    cells[def.metricId] = metricData(def, req.groupBy, req.filters, keys);
    // THE HEADLINE — the same metric, group SUMMARY, no keys: equal to the rows by construction.
    summary[def.metricId] = rollUp(def, "summary", req.filters).get("") ?? emptyBody(def);
  }

  return { keys, hasNext, cells, summary };
}
