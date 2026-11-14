import type { ProductLockFilter } from "../src/gen/warehouse/product/v1/product_pb";

// THE PRODUCT LIST'S REQUESTS, as the stub received them. The lock and the stock's age are the SERVER's filters
// (lock-and-stock-age-filter-ahead-of-the-contract), applied before its count and page — so a story asserts the screen
// SENT them, not only that the rows narrowed. Its own module, beside productScenario, so a story imports it without
// pulling the whole stub transport into the app's type check (and productStub can import it without a cycle). Reset per
// story by productStub's resetProductStub, from preview.tsx.
export interface ProductListCall {
  teamId: bigint;
  q: string;
  lock: ProductLockFilter;
  stockAgeMinDays: number;
  stockWarehouseId: bigint;
  /** The page size asked — the headline's count asks for 1 row, the table for a page. */
  limit: number;
}

export const productListCalls: ProductListCall[] = [];

// DISCOVER'S REQUESTS — the grid's ProductDiscover (its Kunci is the server's filter, discover-filters-by-lock) and the
// cards' DiscoverStockByIds (one call per page, every id on it). Reset with the list's.
export interface ProductDiscoverCall {
  lock: ProductLockFilter;
  includeLocked: boolean;
  limit: number;
  /** Gudang, Kategori, Stok siap and Harga cross as sent — 0n / undefined when not picked. */
  warehouseId: bigint;
  categoryId: bigint;
  ready?: { min: bigint; max?: bigint };
  crossPrice?: { min: number; max?: number };
}

export interface DiscoverStockCall {
  productIds: bigint[];
  warehouseId: bigint;
}

export const productDiscoverCalls: ProductDiscoverCall[] = [];
export const discoverStockCalls: DiscoverStockCall[] = [];

export function resetProductListCalls() {
  productListCalls.length = 0;
  productDiscoverCalls.length = 0;
  discoverStockCalls.length = 0;
}
