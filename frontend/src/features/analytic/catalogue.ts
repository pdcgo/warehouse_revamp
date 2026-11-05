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
  WarehouseFeeMetricSchema,
} from "../../gen/warehouse/selling/v1/order_analytic_pb";
import {
  SettlementMetricSchema,
  SettlementTypeMetricSchema,
} from "../../gen/warehouse/settlement/v1/settlement_analytic_pb";
import {
  AccountChangeMetricSchema,
  AccountChangeTypeMetricSchema,
} from "../../gen/warehouse/financial_account/v1/financial_account_analytic_pb";
import { InventoryLostMetricSchema } from "../../gen/warehouse/inventory/v1/inventory_analytic_pb";

// THE METRIC CATALOGUE. A metric a service SERVES is read off its generated descriptor with `getOption` — its id, its
// filters, its groups, its fields' kinds and which can sort — so the screen states nothing the proto already does: the
// five order metrics (order_statistic_metric.md), Warehouse Fee (the-warehouse-fee-prototype-is-accepted), the two
// settlement metrics (settlement-serves-its-headline-and-its-breakdown), the two Finance metrics and Lost stock. The rest
// are still a TypeScript MIRROR of the decided proto options, backed by samples, until their
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
  | "user"
  // The financial-account groups (the-group-enum-grows-with-the-reports) — GROUP_TYPE_ACCOUNT / PROVIDER / CHANGE_TYPE.
  | "account"
  | "provider"
  | "change_type";

/** A group a TABLE can be read by — every GroupType but the headline's. */
export type TableGroup = Exclude<GroupType, "summary">;

export type TimeGroup = "daily" | "weekly" | "monthly" | "yearly";

/**
 * The groups this screen offers, ids before time. `team` is the SELLER and `warehouse` the warehouse that ships
 * (the-team-group-is-the-seller); `user` is whoever each metric books a fact to. The financial-account groups
 * (financial-accounts-serve-their-changes-and-their-types) — an account, its provider (keyed by the provider's enum
 * number) and a change type (keyed by its enum number) — follow the other id groups.
 */
export const TABLE_GROUPS: TableGroup[] = [
  "shop",
  "team",
  "warehouse",
  "user",
  "product",
  "supplier",
  "account",
  "provider",
  "change_type",
  "daily",
  "weekly",
  "monthly",
  "yearly",
];

/**
 * ⚠ PROTOTYPE groups — offered only while a story shows the prototypes. Empty since the Finance groups went live
 * (2026-11-05); the mechanism stays for the next prototype.
 */
export const PROTOTYPE_GROUPS: TableGroup[] = [];

/** The id groups — a row is an entity, named by a lookup. */
export type IdGroup = "shop" | "team" | "warehouse" | "user" | "product" | "supplier" | "account" | "provider" | "change_type";

export function isTimeGroup(group: GroupType): group is TimeGroup {
  return group === "daily" || group === "weekly" || group === "monthly" || group === "yearly";
}

/** FilterType — what a metric can be narrowed by. Paging is not a filter (a-page-is-not-a-filter). */
export type FilterType = "dateRange" | "shop" | "product" | "supplier" | "team" | "warehouse" | "user" | "account";

/** Every filter, in the order the bar shows them. `account` is one or several of the team's own accounts. */
export const FILTER_TYPES: FilterType[] = ["dateRange", "account", "shop", "team", "warehouse", "user", "product", "supplier"];

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
export type MetricCategory = "order" | "settlement" | "inventory" | "expense" | "finance";

/** Finance is last (analytic-gains-a-finance-category, the-finance-prototype-is-accepted). */
export const METRIC_CATEGORIES: MetricCategory[] = ["order", "settlement", "inventory", "expense", "finance"];

/** ⚠ PROTOTYPE categories — shown only while a story shows the prototypes. Empty since Finance went live (2026-11-05). */
export const PROTOTYPE_CATEGORIES: MetricCategory[] = [];

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
  [PbFilterType.ACCOUNT]: "account",
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
  [PbGroupType.ACCOUNT]: "account",
  [PbGroupType.PROVIDER]: "provider",
  [PbGroupType.CHANGE_TYPE]: "change_type",
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

/**
 * WAREHOUSE FEE, served by selling_service beside the order metrics (the-warehouse-fee-prototype-is-accepted): the fee
 * frozen on each order, under Expense — net, each on its own day (a-warehouse-fee-counts-on-its-day-and-a-cancel-takes-it-
 * back-on-its-day), grouped like the order metrics (warehouse-fee-groups-like-the-order-metrics). Seller is the selling
 * team charged, Warehouse the warehouse that charged (the-warehouse-is-its-own-group), and a warehouse reads the amount
 * too (a-warehouse-sees-its-own-fee-amount).
 */
export const WAREHOUSE_FEE_METRIC: MetricDef = servedMetric(WarehouseFeeMetricSchema, "warehouseFee", "selling", "expense");

const TIME: GroupType[] = ["daily", "weekly", "monthly", "yearly"];

/**
 * THE FINANCE METRICS, served by financial_account_service (financial-accounts-serve-their-changes-and-their-types,
 * the-finance-prototype-is-accepted): Account changes — a statement: the opening balance, what moved it (one signed field
 * per change type, money out negative), the net and the closing balance, the two balances POSITIONS
 * (a-position-is-its-own-stat-type) — and Change types, one `amount` per type. Filtered by the date range and the
 * team's own accounts (finance-filters-by-account); every team reads its own (every-team-reads-its-own-finance).
 */
export const FINANCE_METRICS: MetricDef[] = [
  servedMetric(AccountChangeMetricSchema, "financialAccounts", "financial_account", "finance"),
  servedMetric(AccountChangeTypeMetricSchema, "financialAccountTypes", "financial_account", "finance"),
];

/**
 * A financial account's change types as Account changes' fields, in the proto's order — read off the message: every
 * money field but the net, between the two positions. Each index + 1 is the type's `FinancialAccountChangeType` number,
 * which is also its key when a table is grouped by change type. `account_opening` is the type OPENING_BALANCE.
 */
export const CHANGE_TYPE_FIELDS: string[] = FINANCE_METRICS[0]!.fields
  .filter((f) => f.kind === "money" && f.name !== "change")
  .map((f) => f.name);

/**
 * LOST STOCK, served by inventory_service (the-inventory-lost-prototype-is-accepted): the warehouse's custody losses — a
 * count's shortage and a Stock Adjust "lost", at the batch's price (inventory-lost-counts-the-warehouses-custody-losses),
 * gross (inventory-lost-is-gross), by product, supplier, seller (the team owning the stock), warehouse and time, no shop
 * (inventory-lost-groups-and-sits-under-inventory). The warehouse and the owning seller read both fields
 * (a-warehouse-sees-its-lost-amount). It took the place of the "Stock lost" sample of the same id.
 */
export const INVENTORY_LOST_METRIC: MetricDef = servedMetric(InventoryLostMetricSchema, "inventoryLost", "inventory", "inventory");

export const METRICS: MetricDef[] = [
  ...ORDER_METRICS,
  ...SETTLEMENT_METRICS,
  INVENTORY_LOST_METRIC,
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
  WAREHOUSE_FEE_METRIC,
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
  ...FINANCE_METRICS,
];

/**
 * ⚠ PROTOTYPES — metrics drawn for the owner's design accept, in Storybook only. They never reach the live screen: only a
 * story turns them on (`showPrototypeMetrics`), and the live app never calls it. Each goes into METRICS once the owner
 * accepts it and decides what it counts — Warehouse Fee, then Finance's two metrics and Lost stock (all served
 * 2026-11-05). Empty now; the mechanism stays for the next prototype.
 */
export const PROTOTYPE_METRICS: MetricDef[] = [];

let prototypesShown = false;

/** Storybook only — show (or hide again) the PROTOTYPE_METRICS in the picker and the report. */
export function showPrototypeMetrics(on: boolean) {
  prototypesShown = on;
}

/**
 * Every metric the screen offers: the catalogue, and the prototypes while a story shows them — a prototype with a live
 * metric's id takes that metric's place.
 */
export function catalogueMetrics(): MetricDef[] {
  if (!prototypesShown) return METRICS;

  const replacing = new Map(PROTOTYPE_METRICS.map((m) => [m.metricId, m]));
  const live = METRICS.map((m) => replacing.get(m.metricId) ?? m);

  return [...live, ...PROTOTYPE_METRICS.filter((m) => !METRICS.some((l) => l.metricId === m.metricId))];
}

/** The menu's categories — the live four, and Finance while a story shows the prototypes. */
export function metricCategories(): MetricCategory[] {
  return prototypesShown ? [...METRIC_CATEGORIES, ...PROTOTYPE_CATEGORIES] : METRIC_CATEGORIES;
}

/** The groups the table offers — the live ones, and the financial-account groups (before time) while the prototypes show. */
export function tableGroups(): TableGroup[] {
  if (!prototypesShown) return TABLE_GROUPS;

  const firstTime = TABLE_GROUPS.findIndex((g) => isTimeGroup(g));

  return [...TABLE_GROUPS.slice(0, firstTime), ...PROTOTYPE_GROUPS, ...TABLE_GROUPS.slice(firstTime)];
}

export function metricById(metricId: string): MetricDef | undefined {
  return catalogueMetrics().find((m) => m.metricId === metricId);
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
