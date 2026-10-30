// A REPORT'S STATE IS ITS URL (the-report-lives-in-the-url): the metrics, the group, the filters, the sort, the page and
// the view (the-table-and-the-graph-are-tabs). *Open in new tab* opens the same report — that is the compare view, for
// now (compare-in-another-tab-for-now) — a refresh keeps it, and a link can be sent. A link carries the REPORT, never any
// access: whoever opens it sees only what their role and team allow.
//
//   ?g=shop&m=metrics/orders/created,metrics/settlement&r=30d&shop=13&s=metrics/orders/created:created_count:desc&p=2&n=20&v=graph
//
// Read forgivingly: a malformed value is ignored and the report opens without it — never an error page. A metric the
// link names that no longer exists, or cannot be read by the link's group, is dropped.

import type { DateRange } from "../../components/datetime/DateRangePicker";
import { TABLE_GROUPS, type TableGroup, isTimeGroup, metricById } from "./catalogue";
import type { ReportSort } from "./provider";

export interface ReportState {
  groupBy: TableGroup;
  metricIds: string[];
  range: DateRange;
  shop: string;
  product: string;
  supplier: string;
  /** The seller, the warehouse and the user a metric books a fact to (the-team-group-is-the-seller). "" = every. */
  team: string;
  warehouse: string;
  user: string;
  /** null → the default sort for the group and the metrics (`defaultSort`). */
  sort: ReportSort | null;
  page: number;
  pageSize: number;
  view: ReportView;
}

/** How the rows are drawn — one at a time, the table by default (the-table-and-the-graph-are-tabs). */
export type ReportView = "table" | "graph";

export const DEFAULT_RANGE: DateRange = { kind: "relative", days: 30 };
export const PAGE_SIZES = [10, 20, 50];

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^\d+$/;

function parseRange(raw: string | null): DateRange {
  if (!raw) return DEFAULT_RANGE;

  const days = /^(\d{1,3})d$/.exec(raw);
  if (days) return { kind: "relative", days: Number(days[1]) };

  const [from, to] = raw.split("..");
  if (from && to && DAY.test(from) && DAY.test(to) && from <= to) return { kind: "absolute", from, to };

  return DEFAULT_RANGE;
}

function formatRange(range: DateRange): string {
  return range.kind === "relative" ? `${range.days}d` : `${range.from}..${range.to}`;
}

function parseSort(raw: string | null, groupBy: TableGroup, metricIds: string[]): ReportSort | null {
  if (!raw) return null;

  const [a, b, c] = raw.split(":");
  if (a === "key" && (b === "asc" || b === "desc")) return isTimeGroup(groupBy) ? { by: "key", dir: b } : null;
  if (!a || !b || (c !== "asc" && c !== "desc") || !metricIds.includes(a)) return null;

  const field = metricById(a)?.fields.find((f) => f.name === b && f.canSort);

  return field ? { by: "field", metricId: a, field: field.name, dir: c } : null;
}

function formatSort(sort: ReportSort): string {
  return sort.by === "key" ? `key:${sort.dir}` : `${sort.metricId}:${sort.field}:${sort.dir}`;
}

export function parseReportState(params: URLSearchParams): ReportState {
  const g = params.get("g");
  const groupBy: TableGroup = TABLE_GROUPS.includes(g as TableGroup) ? (g as TableGroup) : "shop";

  // Unknown, repeated, or not readable by this group → dropped.
  const metricIds = [...new Set((params.get("m") ?? "").split(",").filter(Boolean))].filter((id) =>
    metricById(id)?.supportedGroupBy.includes(groupBy),
  );

  const idOf = (name: string) => {
    const raw = params.get(name);
    return raw && ID.test(raw) ? raw : "";
  };

  const page = Number(params.get("p"));
  const size = Number(params.get("n"));

  return {
    groupBy,
    metricIds,
    range: parseRange(params.get("r")),
    shop: idOf("shop"),
    product: idOf("product"),
    supplier: idOf("supplier"),
    team: idOf("team"),
    warehouse: idOf("warehouse"),
    user: idOf("user"),
    sort: parseSort(params.get("s"), groupBy, metricIds),
    page: Number.isInteger(page) && page >= 1 ? page : 1,
    pageSize: PAGE_SIZES.includes(size) ? size : 20,
    view: params.get("v") === "graph" ? "graph" : "table",
  };
}

export function formatReportState(state: ReportState): URLSearchParams {
  const params = new URLSearchParams();
  params.set("g", state.groupBy);
  if (state.metricIds.length > 0) params.set("m", state.metricIds.join(","));
  params.set("r", formatRange(state.range));
  if (state.shop) params.set("shop", state.shop);
  if (state.product) params.set("product", state.product);
  if (state.supplier) params.set("supplier", state.supplier);
  if (state.team) params.set("team", state.team);
  if (state.warehouse) params.set("warehouse", state.warehouse);
  if (state.user) params.set("user", state.user);
  if (state.sort) params.set("s", formatSort(state.sort));
  if (state.page > 1) params.set("p", String(state.page));
  if (state.pageSize !== 20) params.set("n", String(state.pageSize));
  if (state.view !== "table") params.set("v", state.view);

  return params;
}

/**
 * The sort a table falls back to: a time group reads newest first; an id group ranks by the first selected metric's first
 * sortable field, largest first. Unspecified reads DESC (the-key-breaks-every-tie).
 */
export function defaultSort(groupBy: TableGroup, metricIds: string[]): ReportSort | null {
  if (isTimeGroup(groupBy)) return { by: "key", dir: "desc" };

  for (const id of metricIds) {
    const field = metricById(id)?.fields.find((f) => f.canSort);
    if (field) return { by: "field", metricId: id, field: field.name, dir: "desc" };
  }

  return null;
}
