import { ScalarType } from "@bufbuild/protobuf";
import type { ServiceImpl } from "@connectrpc/connect";

import { type MetricDef, type TableGroup, isTimeGroup, metricById } from "../src/features/analytic/catalogue";
import { type MetricBody, type ReportFilters, sampleService } from "../src/features/analytic/provider";
import { type FilterItem, GroupType, SortType } from "../src/gen/warehouse/analytic_base/v1/analytic_pb";
import type { OrderAnalyticService } from "../src/gen/warehouse/selling/v1/order_analytic_pb";

// THE ORDER METRICS, as selling_service serves them — answered over the stub transport from the analytic samples, so a
// story drives the screen's REAL wire path (provider → OrderAnalyticService → the answer) and still reads the numbers
// sample.ts invents. The two steps are the provider's own `sampleService`, so the stub and the samples cannot disagree.
//
// Gudang Pusat (11) is a WAREHOUSE: it gets counts only, every money field unset (a-warehouse-sees-no-seller-money), as
// the server answers it.

const WAREHOUSE_TEAM = 11n;

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

/** The MetricData oneof's prefix per metric — `<prefix>ById`, `<prefix>ByDay`, `<prefix>Summary`. */
const ONEOF: Record<string, string> = {
  "metrics/orders/created": "created",
  "metrics/orders/cancelled": "cancel",
  "metrics/orders/return_created": "returnCreated",
  "metrics/orders/return_arrived": "returnArrived",
  "metrics/orders/lost_created": "lostCreated",
};

function served(metricId: string): MetricDef {
  const def = metricById(metricId);
  if (!def?.schema) throw new Error(`selling does not serve ${metricId}`);

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
    if (f.case === "warehouseFilter") out.warehouse = String(f.value.warehouseId);
    if (f.case === "userFilter") out.user = String(f.value.userId);
  }

  return out;
}

/** A sample body as the metric's message — a double stays a number, an int64 becomes a bigint; a warehouse's money is left out. */
function messageOf(def: MetricDef, body: MetricBody, warehouse: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const field of def.schema!.fields) {
    const kind = def.fields.find((f) => f.name === field.name)?.kind;
    if (warehouse && kind === "money") continue;

    const value = body[field.name] ?? 0;
    out[field.localName] = field.fieldKind === "scalar" && field.scalar === ScalarType.DOUBLE ? value : BigInt(Math.round(value));
  }

  return out;
}

export const orderAnalyticService: Partial<ServiceImpl<typeof OrderAnalyticService>> = {
  metricSearch: (req) => {
    const def = served(req.sort?.metricId ?? "");
    const groupBy = GROUP[req.groupBy]!;
    const { keys, hasNext } = sampleService.search(def, {
      groupBy,
      filters: filtersOf(req.filters),
      field: req.sort?.field ?? "",
      dir: req.sort?.sortType === SortType.ASC ? "asc" : "desc",
      offset: req.page?.offset ?? 0,
      limit: req.page?.limit ?? 20,
    });

    return {
      keys: isTimeGroup(groupBy)
        ? { k: { case: "days", value: { days: keys } } }
        : { k: { case: "ids", value: { ids: keys.map((k) => BigInt(k)) } } },
      hasNext,
    };
  },

  metricData: (req) => {
    const filters = filtersOf(req.filters);
    const warehouse = req.teamId === WAREHOUSE_TEAM;

    return {
      metricDatas: req.metricIds.map((id) => {
        const def = served(id);
        const prefix = ONEOF[id]!;

        if (req.groupBy === GroupType.SUMMARY) {
          return { m: { case: `${prefix}Summary`, value: messageOf(def, sampleService.summary(def, filters), warehouse) } };
        }

        const groupBy = GROUP[req.groupBy]!;
        const keys =
          req.keys?.k.case === "days" ? req.keys.k.value.days : req.keys?.k.case === "ids" ? req.keys.k.value.ids.map(String) : [];
        const bodies = sampleService.data(def, groupBy, filters, keys);

        return {
          m: {
            case: `${prefix}${isTimeGroup(groupBy) ? "ByDay" : "ById"}`,
            value: { items: Object.fromEntries(keys.map((key) => [key, messageOf(def, bodies[key] ?? {}, warehouse)])) },
          },
        };
      }),
    } as never;
  },
};
