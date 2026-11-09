// Query-boundary adapters for the inventory.proto core list / by-ids RPCs (guideline migration).
//
// Each list RPC now returns `items` (a oneof slice carrying map<id, entity>) plus a sorted `ids`
// array; each by-ids RPC returns `items` as map<outer_id, ResponseList>. The helpers here rebuild
// the ordered row arrays the screens already expect, so pages and components stay unchanged — the
// shape change lives entirely at this boundary.

import {
  WarehouseStockListDataType,
  StockHistoryDataType,
  BatchListDataType,
  BatchPlacementListDataType,
  CostLayerListDataType,
  PlacementListDataType,
  StockCostDataType,
  ProductPlacesDataType,
} from "../../gen/warehouse/inventory/v1/inventory_pb";
import type {
  WarehouseProductSearchItem,
  WarehouseStockListResponse,
  StockLevel,
  StockHistoryResponse,
  StockMovement,
  BatchListResponse,
  StockBatch,
  BatchPlacementListResponse,
  BatchShelf,
  CostLayerListResponse,
  CostLayer,
  PlacementListResponse,
  ProductPlacement,
  StockCostResponse,
  StockCostLine,
  ProductPlacesResponse,
  ProductPlace,
} from "../../gen/warehouse/inventory/v1/inventory_pb";

// ── List RPCs: rebuild the ordered rows from (items, ids) ────────────────────────────────────────

/**
 * One row of the Stock screen (the-stock-screen-lists-what-the-warehouse-has-held): a product with a batch in this
 * warehouse — any team's, archived ones flagged — and its units on hand here. A product the stock slice does not name
 * reads 0: it is held, and has nothing on a shelf.
 */
export interface WarehouseStockRow {
  product: WarehouseProductSearchItem;
  onHand: bigint;
}

export const warehouseStockListRowData = () => [WarehouseStockListDataType.PRODUCT, WarehouseStockListDataType.STOCK];
export function warehouseStockFromList(res: WarehouseStockListResponse): WarehouseStockRow[] {
  let products: { [k: string]: WarehouseProductSearchItem } = {};
  let stock: { [k: string]: StockLevel } = {};
  for (const it of res.items) {
    if (it.d.case === "product") products = it.d.value.mapData;
    if (it.d.case === "stock") stock = it.d.value.mapData;
  }

  return res.ids.flatMap((id) => {
    const product = products[id.toString()];
    return product ? [{ product, onHand: stock[id.toString()]?.onHand ?? 0n }] : [];
  });
}

export const stockHistoryRowData = () => [StockHistoryDataType.MOVEMENT];
export function movementsFromList(res: StockHistoryResponse): StockMovement[] {
  let m: { [k: string]: StockMovement } = {};
  for (const it of res.items) if (it.d.case === "movement") m = it.d.value.mapData;
  return res.ids.map((id) => m[id.toString()]).filter(Boolean);
}

export const batchListRowData = () => [BatchListDataType.BATCH];
export function batchesFromList(res: BatchListResponse): StockBatch[] {
  let m: { [k: string]: StockBatch } = {};
  for (const it of res.items) if (it.d.case === "batch") m = it.d.value.mapData;
  return res.ids.map((id) => m[id.toString()]).filter(Boolean);
}

export const batchPlacementRowData = () => [BatchPlacementListDataType.SHELF];
export function shelvesFromList(res: BatchPlacementListResponse): BatchShelf[] {
  let m: { [k: string]: BatchShelf } = {};
  for (const it of res.items) if (it.d.case === "shelf") m = it.d.value.mapData;
  return res.ids.map((id) => m[id.toString()]).filter(Boolean);
}

export const costLayerRowData = () => [CostLayerListDataType.LAYER];
export function layersFromList(res: CostLayerListResponse): CostLayer[] {
  let m: { [k: string]: CostLayer } = {};
  for (const it of res.items) if (it.d.case === "layer") m = it.d.value.mapData;
  return res.ids.map((id) => m[id.toString()]).filter(Boolean);
}

export const placementListRowData = () => [PlacementListDataType.PLACEMENT];
export function placementsFromList(res: PlacementListResponse): ProductPlacement[] {
  let m: { [k: string]: ProductPlacement } = {};
  for (const it of res.items) if (it.d.case === "placement") m = it.d.value.mapData;
  return res.ids.map((id) => m[id.toString()]).filter(Boolean);
}

// ── By-ids RPCs: flatten map<outer_id, ResponseList> to a flat array ─────────────────────────────

export const stockCostRowData = () => [StockCostDataType.COST];
export function stockCostLines(res: StockCostResponse): StockCostLine[] {
  const out: StockCostLine[] = [];
  for (const [id, list] of Object.entries(res.items)) {
    for (const it of list.items) {
      if (it.d.case === "cost") {
        const line = it.d.value.mapData[id];
        if (line) out.push(line);
      }
    }
  }
  return out;
}

export const productPlacesRowData = () => [ProductPlacesDataType.PLACE];
export function productPlacesFlat(res: ProductPlacesResponse): ProductPlace[] {
  const out: ProductPlace[] = [];
  for (const list of Object.values(res.items)) {
    for (const it of list.items) {
      if (it.d.case === "place") {
        for (const p of Object.values(it.d.value.mapData)) out.push(p);
      }
    }
  }
  // The unplaced pile first, then shelves by label (#151 pick-walk order) — derived from rack_code,
  // since the by-ids map carries no order of its own.
  out.sort((a, b) => {
    const au = a.rackId === 0n;
    const bu = b.rackId === 0n;
    if (au !== bu) return au ? -1 : 1;
    return a.rackCode < b.rackCode ? -1 : a.rackCode > b.rackCode ? 1 : 0;
  });
  return out;
}
