import type { PendingList, PendingPart } from "../../features/pending/registry";

// WHAT THE DISCOVER DETAIL CANNOT DO YET. Its Products tab is invented rows — a product is linked to a store when a
// restock bought there is accepted (restock-accepted-links-the-product-to-its-channel), and that link is not built — and
// every product's Terjual and Siap are invented with it (the-detail-tabs-show-sold-and-ready). The supplier, its team,
// its stores, each store's Terjual and Siap and Gudang terkait are real reads. See `features/pending`.

/** One unwired part of the page. The id is also its i18n key (`suppliers.discover.pending.<id>`). */
export type DiscoverSupplierDetailPendingId = "products" | "sold" | "ready" | "warehouseFilter" | "export";

const PARTS: PendingPart<DiscoverSupplierDetailPendingId>[] = [
  { id: "products", kind: "sample" },
  { id: "sold", kind: "sample" },
  { id: "ready", kind: "sample" },
  // Gudang terkait's pick, as on the manage detail (a-supplier-page-is-scoped-by-its-warehouses) — the chips and the
  // summary are real.
  { id: "warehouseFilter", kind: "dropped" },
  // THE PRODUK TAB'S EXPORT (each-supplier-tab-exports-its-own-table) — its rows are invented, and a spreadsheet cannot
  // carry the ⚠ (one-export-is-the-list-as-a-file's only real data), so its file waits for real rows. The Toko and
  // Statistik tabs export since 2026-11-07 (SupplierChannelExport, SupplierFigureExport) and carry no mark.
  { id: "export", kind: "dropped" },
];

export const DISCOVER_SUPPLIER_DETAIL_PENDING: PendingList<DiscoverSupplierDetailPendingId> = {
  ns: "suppliers.discover",
  parts: PARTS,
};
