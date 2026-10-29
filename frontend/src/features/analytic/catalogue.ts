// THE METRIC CATALOGUE — a TypeScript MIRROR of the decided proto options, until `warehouse/analytic_base/v1` exists
// (docs/business/analytic/rpc_provide_clarify.md#the-contract). When the proto lands, the provider reads these same
// facts off the generated descriptors with `getOption` and this list goes: the screen is built first and the contract
// is derived from it (HARD RULE 6), so for now the screen states what it needs here.
//
// Every entry obeys the decisions in rpc_provide_decision.md:
//   a metric is ONE measure and names the groups it can be read by   the-table-picks-one-group
//   every metric lists `summary`                                     every-metric-has-a-summary
//   a metric id is a name, never a route                             a-metric-id-is-a-name-not-a-route
//   a sortable field is sorted by its proto name                     a-sort-field-is-its-proto-name

/** GroupType — the table's grouping (the-table-picks-one-group). `summary` is the headline's, never a table's. */
export type GroupType = "summary" | "daily" | "weekly" | "monthly" | "yearly" | "product" | "shop" | "supplier" | "team" | "user";

/** A group a TABLE can be read by — every GroupType but the headline's. */
export type TableGroup = Exclude<GroupType, "summary">;

export type TimeGroup = "daily" | "weekly" | "monthly" | "yearly";

/** The groups this screen offers, ids before time. `team` and `user` exist in the contract; no sample metric has them. */
export const TABLE_GROUPS: TableGroup[] = ["shop", "product", "supplier", "daily", "weekly", "monthly", "yearly"];

export function isTimeGroup(group: GroupType): group is TimeGroup {
  return group === "daily" || group === "weekly" || group === "monthly" || group === "yearly";
}

/** FilterType — what a metric can be narrowed by. Paging is not a filter (a-page-is-not-a-filter). */
export type FilterType = "dateRange" | "shop" | "product" | "supplier";

export type FieldKind = "count" | "money";

export interface MetricField {
  /** The proto field name — also what a sort names (a-sort-field-is-its-proto-name). */
  name: string;
  kind: FieldKind;
  canSort: boolean;
}

/** The menu's categories — the owner's tree in rpc_provide.md §Metric That Exist in Analytic (the-picker-follows-the-metric-tree). */
export type MetricCategory = "order" | "settlement" | "inventory" | "expense";

export const METRIC_CATEGORIES: MetricCategory[] = ["order", "settlement", "inventory", "expense"];

export interface MetricDef {
  metricId: string;
  /** The i18n key under `analytic.metric`. */
  labelKey: string;
  /** Which service answers it. Later: the proto file that declares the metric, never the id's path. */
  service: string;
  category: MetricCategory;
  supportedFilters: FilterType[];
  requiredFilters: FilterType[];
  supportedGroupBy: GroupType[];
  fields: MetricField[];
}

const TIME: GroupType[] = ["daily", "weekly", "monthly", "yearly"];

export const METRICS: MetricDef[] = [
  {
    metricId: "metrics/orders",
    labelKey: "orders",
    service: "selling",
    category: "order",
    supportedFilters: ["dateRange", "shop", "product"],
    requiredFilters: ["dateRange"],
    supportedGroupBy: ["summary", ...TIME, "shop", "product"],
    fields: [
      { name: "order_count", kind: "count", canSort: true },
      { name: "order_total", kind: "money", canSort: true },
    ],
  },
  {
    metricId: "metrics/settlement",
    labelKey: "settlement",
    service: "settlement",
    category: "settlement",
    supportedFilters: ["dateRange", "shop"],
    requiredFilters: ["dateRange"],
    supportedGroupBy: ["summary", ...TIME, "shop"],
    fields: [
      { name: "settlement_amount", kind: "money", canSort: true },
      { name: "profit", kind: "money", canSort: true },
    ],
  },
  {
    metricId: "metrics/inventory/lost",
    labelKey: "stockLost",
    service: "inventory",
    category: "inventory",
    // Stock is lost in the warehouse — it has no shop.
    supportedFilters: ["dateRange", "product", "supplier"],
    requiredFilters: ["dateRange"],
    supportedGroupBy: ["summary", ...TIME, "product", "supplier"],
    fields: [
      { name: "lost_count", kind: "count", canSort: true },
      { name: "lost_amount", kind: "money", canSort: true },
    ],
  },
  {
    metricId: "metrics/ads",
    labelKey: "ads",
    service: "ads",
    category: "expense",
    supportedFilters: ["dateRange", "shop"],
    requiredFilters: ["dateRange"],
    supportedGroupBy: ["summary", ...TIME, "shop"],
    fields: [{ name: "ads_spend", kind: "money", canSort: true }],
  },
  {
    metricId: "metrics/expenses",
    labelKey: "expenses",
    service: "expense",
    category: "expense",
    // A team's expense is booked to the team, not to a shop or a product.
    supportedFilters: ["dateRange"],
    requiredFilters: ["dateRange"],
    supportedGroupBy: ["summary", ...TIME],
    fields: [{ name: "expense_total", kind: "money", canSort: true }],
  },
];

export function metricById(metricId: string): MetricDef | undefined {
  return METRICS.find((m) => m.metricId === metricId);
}

/** A metric id as a test id — `metrics/inventory/lost` → `metrics-inventory-lost`. */
export function metricSlug(metricId: string): string {
  return metricId.replaceAll("/", "-");
}

/**
 * The filters the table may show — those EVERY selected metric supports (a-new-metric-removes-the-filters-it-cannot-use).
 * The date range is required by all of them, so it is always there.
 */
export function sharedFilters(defs: MetricDef[]): FilterType[] {
  const all: FilterType[] = ["dateRange", "shop", "product", "supplier"];

  return all.filter((f) => defs.every((d) => d.supportedFilters.includes(f)));
}
