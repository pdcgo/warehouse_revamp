import type { PendingList, PendingPart } from "../../features/pending/registry";

// WHAT THE SUPPLIER PAGE CANNOT DO YET. The Products tab stands on invented rows — a product is linked to a store when a
// restock bought there is accepted, and that link is not built — and every product's Terjual and Siap are invented with
// it (the-detail-tabs-show-sold-and-ready). The supplier and its stores are real (the-crud-prototype-is-accepted), and
// since 2026-11-07 so are each STORE's Terjual and Siap and Gudang terkait with its summary
// (InventoryService.SupplierGoods). See `features/pending` for the four kinds.

/** One unwired part of the page. The id is also its i18n key (`supplierChannel.pending.<id>`). */
export type SupplierDetailPendingId = "products" | "sold" | "ready" | "warehouseFilter" | "export";

const PARTS: PendingPart<SupplierDetailPendingId>[] = [
  // supplier-detail-has-channels-and-products-tabs: the Products tab is SAMPLE rows — a product is linked to a
  // store when a restock bought there is accepted (restock-accepted-links-the-product-to-its-channel), and that
  // is not built yet, so there is nothing real to show.
  { id: "products", kind: "sample" },
  // A PRODUCT's Terjual (all time, with the last order) and Siap on the Produk tab — invented with its rows. A store's
  // on the Toko tab are real and unmarked.
  { id: "sold", kind: "sample" },
  { id: "ready", kind: "sample" },
  // GUDANG TERKAIT (a-supplier-page-is-scoped-by-its-warehouses) — the warehouses and their summary are real; a chip
  // picked only switches the summary, since no tab can narrow by a warehouse yet.
  { id: "warehouseFilter", kind: "dropped" },
  // THE PRODUK TAB'S EXPORT (each-supplier-tab-exports-its-own-table) — its rows are invented, and a spreadsheet cannot
  // carry the ⚠ (one-export-is-the-list-as-a-file's only real data), so its file waits for real rows. The Toko and
  // Statistik tabs export since 2026-11-07 (SupplierChannelExport, SupplierFigureExport) and carry no mark.
  { id: "export", kind: "dropped" },
];

export const SUPPLIER_DETAIL_PENDING: PendingList<SupplierDetailPendingId> = {
  ns: "supplierChannel",
  parts: PARTS,
};
