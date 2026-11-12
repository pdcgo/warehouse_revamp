import { type DescMessage, ScalarType } from "@bufbuild/protobuf";
import { Code, ConnectError, type ServiceImpl } from "@connectrpc/connect";

import { INVENTORY_LOST_METRIC, INVENTORY_METRICS, type TableGroup, isTimeGroup } from "../src/features/analytic/catalogue";
import { type MetricBody, type ReportFilters, sampleService } from "../src/features/analytic/provider";
import { SAMPLE_SELLER } from "../src/features/analytic/sample";
import { type FilterItem, GroupType, type MetricKeys, SortType } from "../src/gen/warehouse/analytic_base/v1/analytic_pb";
import type { InventoryAnalyticService } from "../src/gen/warehouse/inventory/v1/inventory_analytic_pb";
import { hiddenFromWarehouse, inventoryMetricSample, isInventoryMetric } from "./inventoryMetricsFixtures";

// INVENTORY'S FIVE METRICS, as inventory_service serves them — answered over the stub transport, so a story drives the
// real wire path:
//   · LOST STOCK from the analytic sample's lost facts (Toko Melati's stock lost in Gudang Pusat 11 and Gudang Cabang 14),
//     through the provider's own `sampleService`, so the numbers cannot disagree with the sample;
//   · RESTOCK, TRANSFER, RETURNED STOCK and READY STOCK from inventoryMetricsFixtures.ts (one simulation of the same
//     seller's stock in the same two warehouses), read as the server reads them: positions at their edge, a warehouse
//     given units only on the first three — their values UNSET — and refused a sort by one.
// One MetricData answers every asked metric, in the asked order (one-call-answers-every-asked-metric).
//
// THE READER, as the server scopes it (a-warehouse-sees-its-lost-amount): the warehouse that held the stock reads its own,
// the seller owning it its own; the root team every one; any other team nothing.

const ROOT_TEAM = 1n;

/** The sample's warehouses — Lost stock was lost in both, and a reader that is one of them is a WAREHOUSE caller. */
const SAMPLE_WAREHOUSES = new Set(["11", "14"]);

const GROUP: Partial<Record<GroupType, TableGroup>> = {
  [GroupType.DAILY]: "daily",
  [GroupType.WEEKLY]: "weekly",
  [GroupType.MONTHLY]: "monthly",
  [GroupType.YEARLY]: "yearly",
  [GroupType.PRODUCT]: "product",
  [GroupType.SUPPLIER]: "supplier",
  [GroupType.TEAM]: "team",
  [GroupType.WAREHOUSE]: "warehouse",
};

const LOST = INVENTORY_LOST_METRIC.metricId;

/** Each metric's message and the prefix of its oneof cases — `lost` → lostById / lostByDay / lostSummary. */
const ONEOF: Record<string, { prefix: string; schema: DescMessage }> = {
  [LOST]: { prefix: "lost", schema: INVENTORY_LOST_METRIC.schema! },
  ...Object.fromEntries(
    INVENTORY_METRICS.map((def) => [def.metricId, { prefix: def.metricId.split("/").pop()!, schema: def.schema! }]),
  ),
};

/** The request's filters as the provider's shape. */
function filtersOf(items: FilterItem[]): ReportFilters {
  const out: ReportFilters = { from: "", to: "" };

  for (const { f } of items) {
    if (f.case === "dateRangeFilter") {
      out.from = f.value.dateMin;
      out.to = f.value.dateMax;
    }
    if (f.case === "productFilter") out.product = String(f.value.productId);
    if (f.case === "supplierFilter") out.supplier = String(f.value.supplierId);
    if (f.case === "teamFilter") out.team = String(f.value.teamId);
    if (f.case === "warehouseFilter") out.warehouse = String(f.value.warehouseId);
  }

  return out;
}

/**
 * Lost stock's filters, narrowed to the reader: a warehouse to its own, the seller to its own. `undefined` when the
 * reader holds none of it — or names another's — so it reads nothing.
 */
function scopedFilters(teamId: bigint, items: FilterItem[]): ReportFilters | undefined {
  const out = filtersOf(items);

  if (teamId === ROOT_TEAM) return out;

  const reader = String(teamId);

  if (SAMPLE_WAREHOUSES.has(reader)) {
    if (out.warehouse !== undefined && out.warehouse !== reader) return undefined;

    return { ...out, warehouse: reader };
  }

  if (reader === SAMPLE_SELLER) {
    if (out.team !== undefined && out.team !== reader) return undefined;

    return { ...out, team: reader };
  }

  return undefined;
}

/**
 * EVERY Lost stock request, as sent — the rpc, the reading team and its filters — so a story can assert the composer's
 * filter reached the wire (the analytic product and supplier filters). A story empties it from its `beforeEach`.
 */
export const inventoryLostCalls: { rpc: "metricSearch" | "metricData"; teamId: bigint; filters: FilterItem[] }[] = [];

/**
 * EVERY request for the four (Restock, Transfer, Returned stock, Ready stock) — the rpc, the reading team, the group, the
 * metrics asked and the ranking field — so a story can assert what reached the wire (a warehouse never asks to rank by a
 * value). A story empties it from its `beforeEach`.
 */
export const inventoryMetricCalls: {
  rpc: "metricSearch" | "metricData";
  teamId: bigint;
  groupBy: GroupType;
  metricIds: string[];
  sortField?: string;
}[] = [];

/**
 * HOW LONG THE SERVICE TAKES, in ms — 0 by default. A story that must see the screen WHILE the next answer loads (the
 * last rows kept behind the overlay, #43) sets it, and puts it back to 0 in its cleanup.
 */
export const inventoryAnalyticLatency = { ms: 0 };

const settle = () =>
  inventoryAnalyticLatency.ms > 0 ? new Promise<void>((done) => setTimeout(done, inventoryAnalyticLatency.ms)) : Promise.resolve();

/** A body as the metric's message: counts as int64, money as double, and a field the body leaves out UNSET. */
function messageOf(schema: DescMessage, body: MetricBody): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of schema.fields) {
    const value = body[field.name];
    if (value === undefined) continue;
    out[field.localName] = field.fieldKind === "scalar" && field.scalar === ScalarType.INT64 ? BigInt(Math.round(value)) : value;
  }

  return out;
}

const keysOf = (keys: MetricKeys | undefined): string[] =>
  keys?.k.case === "days" ? keys.k.value.days : keys?.k.case === "ids" ? keys.k.value.ids.map(String) : [];

export const inventoryAnalyticService: Partial<ServiceImpl<typeof InventoryAnalyticService>> = {
  metricSearch: async (req) => {
    await settle();
    const metricId = req.sort?.metricId ?? LOST;
    const groupBy = GROUP[req.groupBy]!;
    const field = req.sort?.field ?? "";
    const dir = req.sort?.sortType === SortType.ASC ? "asc" : "desc";
    const page = { offset: req.page?.offset ?? 0, limit: req.page?.limit ?? 20 };

    let found: { keys: string[]; hasNext: boolean };

    if (isInventoryMetric(metricId)) {
      inventoryMetricCalls.push({ rpc: "metricSearch", teamId: req.teamId, groupBy: req.groupBy, metricIds: [metricId], sortField: field });
      const reader = String(req.teamId);
      // A warehouse is not given the goods' value, so it cannot rank by it (the server's InvalidArgument).
      if (SAMPLE_WAREHOUSES.has(reader) && hiddenFromWarehouse(metricId, field)) {
        throw new ConnectError(`a warehouse reads ${metricId} without the goods' value — ${field} cannot be sorted by`, Code.InvalidArgument);
      }
      found = inventoryMetricSample.search(metricId, { groupBy, filters: filtersOf(req.filters), field, dir, ...page, reader });
    } else {
      inventoryLostCalls.push({ rpc: "metricSearch", teamId: req.teamId, filters: req.filters });
      const filters = scopedFilters(req.teamId, req.filters);
      found = filters ? sampleService.search(INVENTORY_LOST_METRIC, { groupBy, filters, field, dir, ...page }) : { keys: [], hasNext: false };
    }

    return {
      keys: isTimeGroup(groupBy)
        ? { k: { case: "days", value: { days: found.keys } } }
        : { k: { case: "ids", value: { ids: found.keys.map((k) => BigInt(k)) } } },
      hasNext: found.hasNext,
    };
  },

  metricData: async (req) => {
    await settle();
    if (req.metricIds.includes(LOST)) inventoryLostCalls.push({ rpc: "metricData", teamId: req.teamId, filters: req.filters });
    const four = req.metricIds.filter(isInventoryMetric);
    if (four.length > 0) inventoryMetricCalls.push({ rpc: "metricData", teamId: req.teamId, groupBy: req.groupBy, metricIds: four });

    const groupBy = req.groupBy === GroupType.SUMMARY ? undefined : GROUP[req.groupBy]!;
    const keys = keysOf(req.keys);
    const reader = String(req.teamId);
    const lostFilters = scopedFilters(req.teamId, req.filters);

    const bodyOf = (metricId: string): MetricBody =>
      isInventoryMetric(metricId)
        ? inventoryMetricSample.summary(metricId, filtersOf(req.filters), reader)
        : lostFilters
          ? sampleService.summary(INVENTORY_LOST_METRIC, lostFilters)
          : {};
    const bodiesOf = (metricId: string, group: TableGroup): Record<string, MetricBody> =>
      isInventoryMetric(metricId)
        ? inventoryMetricSample.data(metricId, group, filtersOf(req.filters), keys, reader)
        : lostFilters
          ? sampleService.data(INVENTORY_LOST_METRIC, group, lostFilters, keys)
          : {};

    return {
      // Every report is written in its stock change's own transaction — as of the read.
      asOfUnix: BigInt(Math.floor(Date.now() / 1000)),
      metricDatas: req.metricIds.map((metricId) => {
        const { prefix, schema } = ONEOF[metricId] ?? ONEOF[LOST]!;

        if (groupBy === undefined) return { m: { case: `${prefix}Summary`, value: messageOf(schema, bodyOf(metricId)) } };

        const bodies = bodiesOf(metricId, groupBy);

        return {
          m: {
            case: `${prefix}${isTimeGroup(groupBy) ? "ByDay" : "ById"}`,
            value: { items: Object.fromEntries(keys.map((key) => [key, messageOf(schema, bodies[key] ?? {})])) },
          },
        };
      }),
    } as never;
  },
};
