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
