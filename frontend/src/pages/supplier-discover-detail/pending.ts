import type { PendingList, PendingPart } from "../../features/pending/registry";

// WHAT THE DISCOVER DETAIL CANNOT DO YET. Its Products tab is invented rows — a product is linked to a store when a
// restock bought there is accepted (restock-accepted-links-the-product-to-its-channel), and restock lines name no store
// yet — and every store's and product's Terjual and Siap are invented with it (the-detail-tabs-show-sold-and-ready).
// The supplier, its team and its stores are real reads. See `features/pending`.

/** One unwired part of the page. The id is also its i18n key (`suppliers.discover.pending.<id>`). */
export type DiscoverSupplierDetailPendingId = "products" | "sold" | "ready" | "warehouses" | "warehouseFilter" | "sales";

const PARTS: PendingPart<DiscoverSupplierDetailPendingId>[] = [
  { id: "products", kind: "sample" },
  { id: "sold", kind: "sample" },
  { id: "ready", kind: "sample" },
  // Gudang terkait, as on the manage detail (a-supplier-page-is-scoped-by-its-warehouses).
  { id: "warehouses", kind: "sample" },
  { id: "warehouseFilter", kind: "dropped" },
  // Penjualan beside Direstok on the Statistik tab, as on the manage detail (sales-sit-beside-restocked).
  { id: "sales", kind: "sample" },
];

export const DISCOVER_SUPPLIER_DETAIL_PENDING: PendingList<DiscoverSupplierDetailPendingId> = {
  ns: "suppliers.discover",
  parts: PARTS,
};
