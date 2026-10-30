import { type DescMessage, getOption } from "@bufbuild/protobuf";

import {
  FieldStatType,
  FilterType as PbFilterType,
  GroupType as PbGroupType,
  field_stat_type,
  metric,
  metric_sort,
} from "../../gen/warehouse/analytic_base/v1/analytic_pb";
import {
  OrderCancelMetricSchema,
  OrderCreatedMetricSchema,
  OrderLostCreatedMetricSchema,
  OrderReturnArrivedMetricSchema,
  OrderReturnCreatedMetricSchema,
} from "../../gen/warehouse/selling/v1/order_analytic_pb";
import {
  SettlementMetricSchema,
  SettlementTypeMetricSchema,
} from "../../gen/warehouse/settlement/v1/settlement_analytic_pb";

// THE METRIC CATALOGUE. A metric a service SERVES is read off its generated descriptor with `getOption` — its id, its
// filters, its groups, its fields' kinds and which can sort — so the screen states nothing the proto already does: the
// five order metrics (order_statistic_metric.md) and the two settlement metrics (settlement-serves-its-headline-and-its-
// breakdown). The rest are still a TypeScript MIRROR of the decided proto options, backed by samples, until their
// services ship (HARD RULE 6 — the screen was built first).
//
// Every entry obeys the decisions in rpc_provide_decision.md:
//   a metric is ONE measure and names the groups it can be read by   the-table-picks-one-group
//   every metric lists `summary`                                     every-metric-has-a-summary
//   a metric id is a name, never a route                             a-metric-id-is-a-name-not-a-route
//   a sortable field is sorted by its proto name                     a-sort-field-is-its-proto-name

/** GroupType — the table's grouping (the-table-picks-one-group). `summary` is the headline's, never a table's. */
export type GroupType =
  | "summary"
  | "daily"
  | "weekly"
  | "monthly"
  | "yearly"
  | "product"
  | "shop"
  | "supplier"
  | "team"
  | "warehouse"
  | "user";

/** A group a TABLE can be read by — every GroupType but the headline's. */
export type TableGroup = Exclude<GroupType, "summary">;

export type TimeGroup = "daily" | "weekly" | "monthly" | "yearly";

/**
 * The groups this screen offers, ids before time. `team` is the SELLER and `warehouse` the warehouse that ships
 * (the-team-group-is-the-seller); `user` is whoever each metric books a fact to.
 */
export const TABLE_GROUPS: TableGroup[] = [
  "shop",
  "team",
  "warehouse",
  "user",
  "product",
  "supplier",
  "daily",
  "weekly",
  "monthly",
  "yearly",
];

/** The id groups — a row is an entity, named by a lookup. */
export type IdGroup = "shop" | "team" | "warehouse" | "user" | "product" | "supplier";

export function isTimeGroup(group: GroupType): group is TimeGroup {
  return group === "daily" || group === "weekly" || group === "monthly" || group === "yearly";
}

/** FilterType — what a metric can be narrowed by. Paging is not a filter (a-page-is-not-a-filter). */
export type FilterType = "dateRange" | "shop" | "product" | "supplier" | "team" | "warehouse" | "user";

/** Every filter, in the order the bar shows them. */
export const FILTER_TYPES: FilterType[] = ["dateRange", "shop", "team", "warehouse", "user", "product", "supplier"];

/**
 * How a figure reads: a count, money that moved, money at a moment (a-position-is-its-own-stat-type), or a rate — 0 to 1,
 * shown as a percentage. The proto's FieldStatType, one for one: QTY, CURRENCY, POSITION, RATIO.
 */
export type FieldKind = "count" | "money" | "position" | "ratio";

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
  /** The generated message, when a service SERVES the metric — the provider asks that service. Absent: a sample. */
  schema?: DescMessage;
}

const FILTER_OF: Partial<Record<PbFilterType, FilterType>> = {
  [PbFilterType.DATE_RANGE]: "dateRange",
  [PbFilterType.PRODUCT]: "product",
  [PbFilterType.TEAM]: "team",
  [PbFilterType.SHOP]: "shop",
  [PbFilterType.SUPPLIER]: "supplier",
  [PbFilterType.WAREHOUSE]: "warehouse",
  [PbFilterType.USER]: "user",
};

const GROUP_OF: Partial<Record<PbGroupType, GroupType>> = {
  [PbGroupType.SUMMARY]: "summary",
  [PbGroupType.DAILY]: "daily",
  [PbGroupType.WEEKLY]: "weekly",
  [PbGroupType.MONTHLY]: "monthly",
  [PbGroupType.YEARLY]: "yearly",
  [PbGroupType.PRODUCT]: "product",
  [PbGroupType.SHOP]: "shop",
  [PbGroupType.SUPPLIER]: "supplier",
  [PbGroupType.TEAM]: "team",
  [PbGroupType.USER]: "user",
  [PbGroupType.WAREHOUSE]: "warehouse",
};

const known = <T,>(values: (T | undefined)[]): T[] => values.filter((v): v is T => v !== undefined);

/** A field's stat type as this screen reads it. */
function kindOf(statType: FieldStatType): FieldKind {
  if (statType === FieldStatType.CURRENCY) return "money";
  if (statType === FieldStatType.POSITION) return "position";
  if (statType === FieldStatType.RATIO) return "ratio";

  return "count";
}

/**
 * A served metric, read off its message: the `metric` option names it, its filters and its groups; each number field's
 * `field_stat_type` says whether it is a count or money, and `metric_sort` whether a table may sort by it
 * (a-field-declares-its-stat-type). The label key and the menu category are the screen's own.
 */
function servedMetric(schema: DescMessage, labelKey: string, service: string, category: MetricCategory): MetricDef {
  const option = getOption(schema, metric);

  return {
    metricId: option.metricId,
    labelKey,
    service,
    category,
    supportedFilters: known(option.supportedFilters.map((f) => FILTER_OF[f])),
    requiredFilters: known(option.requiredFilters.map((f) => FILTER_OF[f])),
    supportedGroupBy: known(option.supportedGroupBy.map((g) => GROUP_OF[g])),
    fields: schema.fields
      .filter((f) => getOption(f, field_stat_type) !== FieldStatType.UNSPECIFIED)
      .map((f) => ({
        name: f.name,
        kind: kindOf(getOption(f, field_stat_type)),
        canSort: getOption(f, metric_sort).canSort,
      })),
    schema,
  };
}

/** The five order metrics, served by selling_service (order_statistic_metric.md). */
export const ORDER_METRICS: MetricDef[] = [
  servedMetric(OrderCreatedMetricSchema, "ordersCreated", "selling", "order"),
  servedMetric(OrderCancelMetricSchema, "ordersCancelled", "selling", "order"),
  servedMetric(OrderReturnCreatedMetricSchema, "ordersReturnCreated", "selling", "order"),
  servedMetric(OrderReturnArrivedMetricSchema, "ordersReturnArrived", "selling", "order"),
  servedMetric(OrderLostCreatedMetricSchema, "ordersLostCreated", "selling", "order"),
];

/**
 * The two settlement metrics, served by settlement_service: the headline a person reads first, and the ten types that
 * make up its `received` (settlement-serves-its-headline-and-its-breakdown).
 */
export const SETTLEMENT_METRICS: MetricDef[] = [
  servedMetric(SettlementMetricSchema, "settlement", "settlement", "settlement"),
  servedMetric(SettlementTypeMetricSchema, "settlementTypes", "settlement", "settlement"),
];

const TIME: GroupType[] = ["daily", "weekly", "monthly", "yearly"];

export const METRICS: MetricDef[] = [
  ...ORDER_METRICS,
  ...SETTLEMENT_METRICS,
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
  return FILTER_TYPES.filter((f) => defs.every((d) => d.supportedFilters.includes(f)));
}
