// What a supplier tab's Export ASKED the stub (each-supplier-tab-exports-its-own-table) — a story reads it to prove the
// file is asked with the tab's own filter. Kept here, not in supplierStub.ts, so a story never imports the stub
// (tsconfig includes only src). Reset with the stub's tables (resetSupplierStub).

import type { FilterItem, GroupType, MetricSort } from "../src/gen/warehouse/analytic_base/v1/analytic_pb";
import type { Marketplace } from "../src/gen/warehouse/marketplace/v1/marketplace_pb";

export interface StoreExportCall {
  teamId: bigint;
  supplierId: bigint;
  q: string;
  channelType: Marketplace;
  /** The page's Gudang terkait chip; 0n = every warehouse. */
  warehouseId: bigint;
  /** The stores the file holds. */
  rows: number;
}

export interface FigureExportCall {
  teamId: bigint;
  groupBy: GroupType;
  filters: FilterItem[];
}

/** The Produk tab's Export — the list's own filter, and the rows the file holds. */
export interface ProductExportCall {
  teamId: bigint;
  supplierId: bigint;
  q: string;
  productTeamId: bigint;
  storeId: bigint;
  noStore: boolean;
  /** The page's Gudang terkait chip; 0n = every warehouse. */
  warehouseId: bigint;
  rows: number;
}

/** The Supplier Report's Export (a-report-export-is-the-whole-view-as-a-file) — its filters and its order. */
export interface ReportExportCall {
  teamId: bigint;
  filters: FilterItem[];
  sort: MetricSort | undefined;
  /** The suppliers the file holds. */
  rows: number;
}

export const supplierExportScenario = {
  stores: [] as StoreExportCall[],
  products: [] as ProductExportCall[],
  figures: [] as FigureExportCall[],
  reports: [] as ReportExportCall[],
};

export function resetSupplierExportScenario() {
  supplierExportScenario.stores = [];
  supplierExportScenario.products = [];
  supplierExportScenario.figures = [];
  supplierExportScenario.reports = [];
}
