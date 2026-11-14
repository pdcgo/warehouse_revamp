// A SUPPLIER'S GOODS as Storybook's stub — InventoryService.SupplierGoods (features/suppliers/goods.ts). The server sums
// the batches minted with a supplier's id; here the same sums come from a few fixed LOTS, one per (supplier, store,
// warehouse), so a supplier's figure is its stores' total and its warehouses' total, as on the server. Every team reads
// the same figures (every-selling-team-sees-every-teams-figures). Dated relative to now, so "yesterday" stays yesterday.
import { create } from "@bufbuild/protobuf";
import type { SupplierFigureBand } from "../src/gen/warehouse/supplier/v1/supplier_pb";
import {
  type SupplierGoodsRequest,
  SupplierGoodsGroup,
  SupplierGoodsResponseSchema,
  SupplierGoodsSchema,
} from "../src/gen/warehouse/inventory/v1/inventory_pb";

export interface GoodsLot {
  supplierId: bigint;
  storeId: bigint;
  warehouseId: bigint;
  sold: number;
  orders: number;
  /** Days ago; null = never. */
  lastOrderDaysAgo: number | null;
  ready: number;
  restocks: number;
  lastRestockDaysAgo: number | null;
}

const lot = (
  supplierId: number,
  storeId: number,
  warehouseId: number,
  sold: number,
  orders: number,
  lastOrderDaysAgo: number | null,
  ready: number,
  restocks: number,
  lastRestockDaysAgo: number | null,
): GoodsLot => ({
  supplierId: BigInt(supplierId),
  storeId: BigInt(storeId),
  warehouseId: BigInt(warehouseId),
  sold,
  orders,
  lastOrderDaysAgo,
  ready,
  restocks,
  lastRestockDaysAgo,
});

// PT Sumber Makmur (31): 1.507 sold on 98 orders, 151 ready from 12 restocks — Gudang Pusat (11) and Gudang Cabang (14).
// Its store 313 holds goods it has not sold yet. PT Banyak Toko (35) and UD Makmur Jaya (34) sell well; Linen House
// (37) was bought from at a stall (no store). Every other supplier has no goods — a dash.
export const GOODS_LOTS: GoodsLot[] = [
  lot(31, 311, 11, 1204, 77, 1, 86, 9, 5),
  lot(31, 312, 14, 303, 21, 3, 25, 2, 12),
  lot(31, 313, 11, 0, 0, null, 40, 1, 20),
  lot(35, 351, 11, 4135, 260, 2, 155, 14, 8),
  lot(34, 341, 14, 2579, 180, 1, 803, 6, 18),
  lot(36, 371, 14, 640, 52, 1, 90, 4, 6),
  lot(37, 0, 11, 60, 5, 4, 12, 1, 30),
];

const DAY = 86_400;
const at = (daysAgo: number | null) => (daysAgo === null ? 0n : BigInt(Math.floor(Date.now() / 1000) - daysAgo * DAY));

/** What each SupplierGoods call asked — a story asserts the page asked once, for the suppliers on screen. */
export const supplierGoodsCalls: { teamId: bigint; supplierIds: bigint[]; group: SupplierGoodsGroup }[] = [];

/** The bands and the warehouse each SupplierList call carried — a story asserts the pick reached the server's question. */
export const supplierListBandCalls: {
  sold?: { min: bigint; max: bigint };
  ready?: { min: bigint; max: bigint };
  warehouseId: bigint;
}[] = [];

export function resetSupplierGoodsStub() {
  supplierGoodsCalls.length = 0;
  supplierListBandCalls.length = 0;
}

const bandOf = (band: SupplierFigureBand | undefined) => (band ? { min: band.min, max: band.max } : undefined);

export function recordSupplierListBands(
  sold: SupplierFigureBand | undefined,
  ready: SupplierFigureBand | undefined,
  warehouseId: bigint = 0n,
) {
  supplierListBandCalls.push({ sold: bandOf(sold), ready: bandOf(ready), warehouseId });
}

/**
 * SupplierList's Gudang filter (the-warehouse-filters-before-the-team): a supplier with a lot at the warehouse — exactly
 * the warehouses SupplierGoods by WAREHOUSE answers for it, its Gudang terkait chips. 0n = any warehouse.
 */
export function receivedAt(supplierId: bigint, warehouseId: bigint): boolean {
  return warehouseId === 0n || GOODS_LOTS.some((l) => l.supplierId === supplierId && l.warehouseId === warehouseId);
}

/** A supplier's all-time Terjual and Siap — its lots summed, every team's; 0 for a supplier with no goods. */
export function goodsTotalsOf(supplierId: bigint): { sold: number; ready: number } {
  let sold = 0;
  let ready = 0;
  for (const l of GOODS_LOTS) {
    if (l.supplierId !== supplierId) continue;
    sold += l.sold;
    ready += l.ready;
  }

  return { sold, ready };
}

/** SupplierList's band rule: `min` inclusive, `max` exclusive, `max` 0 open-ended; no band keeps everyone. */
export function inBand(value: number, band: SupplierFigureBand | undefined): boolean {
  if (!band) return true;

  return value >= Number(band.min) && (band.max === 0n || value < Number(band.max));
}

export function supplierGoods(req: SupplierGoodsRequest) {
  supplierGoodsCalls.push({ teamId: req.teamId, supplierIds: [...req.supplierIds], group: req.group });

  const wanted = new Set(req.supplierIds.map((id) => id.toString()));
  const keyOf = (l: GoodsLot) =>
    req.group === SupplierGoodsGroup.STORE ? l.storeId : req.group === SupplierGoodsGroup.WAREHOUSE ? l.warehouseId : 0n;

  const rows = new Map<string, ReturnType<typeof create<typeof SupplierGoodsSchema>>>();
  for (const l of GOODS_LOTS) {
    if (!wanted.has(l.supplierId.toString())) continue;

    const k = keyOf(l);
    const id = `${l.supplierId}:${k}`;
    let row = rows.get(id);
    if (!row) {
      row = create(SupplierGoodsSchema, {
        supplierId: l.supplierId,
        storeId: req.group === SupplierGoodsGroup.STORE ? k : 0n,
        warehouseId: req.group === SupplierGoodsGroup.WAREHOUSE ? k : 0n,
      });
      rows.set(id, row);
    }

    row.soldUnits += BigInt(l.sold);
    row.orders += BigInt(l.orders);
    row.readyUnits += BigInt(l.ready);
    row.restocks += BigInt(l.restocks);
    const lastOrder = at(l.lastOrderDaysAgo);
    if (lastOrder > row.lastOrderUnix) row.lastOrderUnix = lastOrder;
    const lastRestock = at(l.lastRestockDaysAgo);
    if (lastRestock > row.lastRestockUnix) row.lastRestockUnix = lastRestock;
  }

  return create(SupplierGoodsResponseSchema, { rows: [...rows.values()] });
}
