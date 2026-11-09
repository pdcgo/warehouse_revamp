import { useQuery } from "@tanstack/react-query";
import { inventoryClient } from "../../api/clients";
import { key, listQuery } from "../../api/queryClient";
import { SupplierGoodsGroup, type SupplierGoods } from "../../gen/warehouse/inventory/v1/inventory_pb";
import { teamsByIdsQuery } from "../teams/queries";
import type { SupplierFigureValues } from "./figureValues";

// A SUPPLIER'S GOODS, REAL (InventoryService.SupplierGoods) — Terjual with the last order, Siap with the last restock
// (`sales-are-all-time-with-their-last-dates`), per supplier on the supplier list and Discover, per store on the Toko
// tab (`the-detail-tabs-show-sold-and-ready`), and per warehouse under Gudang terkait
// (`the-summary-is-sold-and-ready-with-their-counts`). The figures are EVERY team's goods from the supplier
// (`every-selling-team-sees-every-teams-figures`); `teamId` is only the caller's scope, kept in the key as on every read.
//
// Keyed under `inventory`, so a restock accepted or an order taken refreshes them with the stock screens. A supplier
// (store, warehouse) none of whose goods ever arrived is absent from the answer — the screen draws a dash.

function figuresOf(row: SupplierGoods): SupplierFigureValues {
  return {
    sold: Number(row.soldUnits),
    orders: Number(row.orders),
    lastOrderAt: row.lastOrderUnix,
    ready: Number(row.readyUnits),
    restocks: Number(row.restocks),
    lastRestockAt: row.lastRestockUnix > 0n ? row.lastRestockUnix : undefined,
  };
}

function goodsQuery(teamId: bigint | undefined, supplierIds: bigint[], group: SupplierGoodsGroup) {
  const ids = Array.from(new Set(supplierIds.map((id) => id.toString()))).sort();

  return {
    queryKey: key.inventory(teamId, { supplierGoods: ids.join(","), group }),
    ...listQuery,
    enabled: teamId !== undefined && teamId > 0n && ids.length > 0,
    queryFn: async () =>
      (
        await inventoryClient.supplierGoods({
          teamId: teamId!,
          supplierIds: ids.map((id) => BigInt(id)),
          group,
        })
      ).rows,
  };
}

/** Per supplier, keyed by its id as a string. */
export function useSupplierGoods(teamId: bigint | undefined, supplierIds: bigint[]) {
  const query = useQuery(goodsQuery(teamId, supplierIds, SupplierGoodsGroup.SUPPLIER));
  const figures = new Map<string, SupplierFigureValues>();
  for (const row of query.data ?? []) figures.set(row.supplierId.toString(), figuresOf(row));

  return { ...query, figures };
}

/** One supplier's stores, keyed by the store id as a string. */
export function useSupplierStoreGoods(teamId: bigint | undefined, supplierId: bigint) {
  const query = useQuery(goodsQuery(teamId, supplierId > 0n ? [supplierId] : [], SupplierGoodsGroup.STORE));
  const figures = new Map<string, SupplierFigureValues>();
  for (const row of query.data ?? []) figures.set(row.storeId.toString(), figuresOf(row));

  return { ...query, figures };
}

/** One warehouse this supplier's goods were received at, and what they did there. */
export interface SupplierWarehouse {
  id: bigint;
  name: string;
  /** Units of this supplier's goods sold out of it — all time. */
  sold: number;
  /** The orders those units went out on. */
  orders: number;
  /** Units of this supplier's goods ready on its shelves. */
  ready: number;
  /** Accepted restocks from this supplier received there. */
  restocks: number;
  /** The last of them, unix seconds; 0n = none. */
  lastRestockAt: bigint;
  /** The last order of this supplier's goods out of it, unix seconds; 0n = none. */
  lastOrderAt: bigint;
}

/** What the summary under the chips reads — one warehouse, or every one together. */
export type WarehouseSummary = Omit<SupplierWarehouse, "id" | "name">;

/**
 * Gudang terkait — the warehouses this supplier's goods were received at, the most restocked first
 * (`a-supplier-page-is-scoped-by-its-warehouses`), each named by its team. A warehouse holding goods only by a
 * transfer is listed too, with 0 restocks: its shelves hold this supplier's units.
 */
export function useSupplierWarehouses(teamId: bigint | undefined, supplierId: bigint) {
  const goods = useQuery(goodsQuery(teamId, supplierId > 0n ? [supplierId] : [], SupplierGoodsGroup.WAREHOUSE));
  const ids = (goods.data ?? []).map((row) => row.warehouseId);
  const names = useQuery({ ...teamsByIdsQuery(ids), enabled: ids.length > 0 });

  const warehouses: SupplierWarehouse[] = (goods.data ?? [])
    .map((row) => ({
      id: row.warehouseId,
      name: names.data?.[row.warehouseId.toString()]?.name ?? `#${row.warehouseId}`,
      sold: Number(row.soldUnits),
      orders: Number(row.orders),
      ready: Number(row.readyUnits),
      restocks: Number(row.restocks),
      lastRestockAt: row.lastRestockUnix,
      lastOrderAt: row.lastOrderUnix,
    }))
    .sort((a, b) => b.restocks - a.restocks || (a.id < b.id ? -1 : 1));

  return { ...goods, warehouses };
}

/**
 * The chosen warehouse's figures — or, for 0n, every warehouse's together: the units, orders and restocks summed, the
 * latest dates.
 */
export function warehouseSummary(warehouses: SupplierWarehouse[], warehouseId: bigint): WarehouseSummary | null {
  const scope = warehouseId === 0n ? warehouses : warehouses.filter((w) => w.id === warehouseId);
  if (scope.length === 0) return null;

  const latest = (pick: (w: SupplierWarehouse) => bigint) => scope.map(pick).reduce((a, b) => (a > b ? a : b));
  return {
    sold: scope.reduce((sum, w) => sum + w.sold, 0),
    orders: scope.reduce((sum, w) => sum + w.orders, 0),
    ready: scope.reduce((sum, w) => sum + w.ready, 0),
    restocks: scope.reduce((sum, w) => sum + w.restocks, 0),
    lastRestockAt: latest((w) => w.lastRestockAt),
    lastOrderAt: latest((w) => w.lastOrderAt),
  };
}
