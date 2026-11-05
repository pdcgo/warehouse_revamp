import type { ServiceImpl } from "@connectrpc/connect";

import { type TableGroup, INVENTORY_LOST_METRIC, isTimeGroup } from "../src/features/analytic/catalogue";
import { type MetricBody, type ReportFilters, sampleService } from "../src/features/analytic/provider";
import { SAMPLE_SELLER } from "../src/features/analytic/sample";
import { type FilterItem, GroupType, SortType } from "../src/gen/warehouse/analytic_base/v1/analytic_pb";
import type { InventoryAnalyticService } from "../src/gen/warehouse/inventory/v1/inventory_analytic_pb";

// LOST STOCK, as inventory_service serves it — answered over the stub transport from the analytic sample's lost facts
// (Toko Melati's stock lost in Gudang Pusat 11 and Gudang Cabang 14), through the provider's own `sampleService`, so a
// story drives the real wire path and the numbers cannot disagree with the sample.
//
// THE READER, as the server scopes it (a-warehouse-sees-its-lost-amount): the warehouse that held the stock reads its own
// losses, the seller owning it its own — both with the amount; the root team every one; any other team nothing.

const ROOT_TEAM = 1n;

/** The warehouses the sample's stock was lost in. */
const LOST_WAREHOUSES = new Set(["11", "14"]);

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

/**
 * The request's filters, narrowed to the reader: a warehouse to its own, the seller to its own. `undefined` when the
 * reader holds none of it — or names another's — so it reads nothing.
 */
function scopedFilters(teamId: bigint, items: FilterItem[]): ReportFilters | undefined {
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

  if (teamId === ROOT_TEAM) return out;

  const reader = String(teamId);

  if (LOST_WAREHOUSES.has(reader)) {
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

function messageOf(body: MetricBody): Record<string, unknown> {
  return { lostCount: BigInt(Math.round(body.lost_count ?? 0)), lostAmount: body.lost_amount ?? 0 };
}

export const inventoryAnalyticService: Partial<ServiceImpl<typeof InventoryAnalyticService>> = {
  metricSearch: (req) => {
    inventoryLostCalls.push({ rpc: "metricSearch", teamId: req.teamId, filters: req.filters });
    const groupBy = GROUP[req.groupBy]!;
    const filters = scopedFilters(req.teamId, req.filters);
    const { keys, hasNext } = filters
      ? sampleService.search(INVENTORY_LOST_METRIC, {
          groupBy,
          filters,
          field: req.sort?.field ?? "",
          dir: req.sort?.sortType === SortType.ASC ? "asc" : "desc",
          offset: req.page?.offset ?? 0,
          limit: req.page?.limit ?? 20,
        })
      : { keys: [] as string[], hasNext: false };

    return {
      keys: isTimeGroup(groupBy)
        ? { k: { case: "days", value: { days: keys } } }
        : { k: { case: "ids", value: { ids: keys.map((k) => BigInt(k)) } } },
      hasNext,
    };
  },

  metricData: (req) => {
    inventoryLostCalls.push({ rpc: "metricData", teamId: req.teamId, filters: req.filters });
    const filters = scopedFilters(req.teamId, req.filters);
    const def = INVENTORY_LOST_METRIC;

    return {
      // The report is written in the loss's own transaction — as of the read.
      asOfUnix: BigInt(Math.floor(Date.now() / 1000)),
      metricDatas: req.metricIds.map(() => {
        if (req.groupBy === GroupType.SUMMARY) {
          return { m: { case: "lostSummary", value: messageOf(filters ? sampleService.summary(def, filters) : {}) } };
        }

        const groupBy = GROUP[req.groupBy]!;
        const keys =
          req.keys?.k.case === "days" ? req.keys.k.value.days : req.keys?.k.case === "ids" ? req.keys.k.value.ids.map(String) : [];
        const bodies = filters ? sampleService.data(def, groupBy, filters, keys) : {};

        return {
          m: {
            case: isTimeGroup(groupBy) ? "lostByDay" : "lostById",
            value: { items: Object.fromEntries(keys.map((key) => [key, messageOf(bodies[key] ?? {})])) },
          },
        };
      }),
    } as never;
  },
};
