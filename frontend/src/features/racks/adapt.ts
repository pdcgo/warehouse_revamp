import {
  type Rack,
  RackHistoryDataType,
  type RackHistoryResponseItem,
  RackListDataType,
  type RackListResponseItem,
  type RackStockLine,
  RackStockDataType,
  type RackStockResponseItem,
} from "../../gen/warehouse/inventory/v1/rack_pb";
import type { StockMovement } from "../../gen/warehouse/inventory/v1/inventory_pb";

// RackList / RackStock / RackHistory moved to the guideline shape. The RACK / RACK_STOCK / MOVEMENT
// slices reuse the Rack / RackStockLine / StockMovement messages (rack stock keyed by product_id).

export const rackListRowData = (): RackListDataType[] => [RackListDataType.RACK];
export const rackStockRowData = (): RackStockDataType[] => [RackStockDataType.RACK_STOCK];
export const rackHistoryRowData = (): RackHistoryDataType[] => [RackHistoryDataType.MOVEMENT];

export function racksFromList(items: RackListResponseItem[], ids: bigint[]): Rack[] {
  let m: { [key: string]: Rack } = {};
  for (const it of items) {
    if (it.d.case === "rack") m = it.d.value.mapData;
  }
  return ids.map((id) => m[id.toString()]).filter((r): r is Rack => !!r);
}

export function rackStockFromList(items: RackStockResponseItem[], ids: bigint[]): RackStockLine[] {
  let m: { [key: string]: RackStockLine } = {};
  for (const it of items) {
    if (it.d.case === "rackStock") m = it.d.value.mapData;
  }
  return ids.map((id) => m[id.toString()]).filter((l): l is RackStockLine => !!l);
}

export function rackHistoryFromList(
  items: RackHistoryResponseItem[],
  ids: bigint[],
): StockMovement[] {
  let m: { [key: string]: StockMovement } = {};
  for (const it of items) {
    if (it.d.case === "movement") m = it.d.value.mapData;
  }
  return ids.map((id) => m[id.toString()]).filter((mv): mv is StockMovement => !!mv);
}

// The Racks PAGE asks for each rack's stock count beside the rack itself (a-rack-shows-its-stock-count-for-now); a
// picker keeps to `rackListRowData`, so it never makes the server sum a shelf.
export const rackListPageRowData = (): RackListDataType[] => [RackListDataType.RACK, RackListDataType.STOCK];

// One rack's line in the Racks list: its stock count, and how many different products make it up.
export interface RackTotals {
  stockCount: bigint;
  productCount: number;
}

// rack id → its totals. A rack the slice does not mention holds nothing, which the caller reads as 0 and 0.
export function rackStockTotalsFromList(items: RackListResponseItem[]): Map<string, RackTotals> {
  const out = new Map<string, RackTotals>();
  for (const it of items) {
    if (it.d.case !== "stock") continue;
    for (const [id, total] of Object.entries(it.d.value.mapData)) {
      out.set(id, { stockCount: total.stockCount, productCount: total.productCount });
    }
  }
  return out;
}
