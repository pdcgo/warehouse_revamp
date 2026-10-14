import type { PendingList, PendingPart } from "../../features/pending/registry";

// WHAT THE SUPPLIER PAGE CANNOT DO YET. The Products tab stands on invented rows — it needs a store on each restock
// line (the-supplier-comes-from-the-restock-until-lines-name-a-store) — and every store's and product's Terjual and
// Siap are invented with it (the-detail-tabs-show-sold-and-ready). The supplier and its stores are real —
// supplier_service holds every field the page shows (the-crud-prototype-is-accepted). See `features/pending` for the
// four kinds.

/** One unwired part of the page. The id is also its i18n key (`supplierChannel.pending.<id>`). */
export type SupplierDetailPendingId = "products" | "sold" | "ready" | "warehouses" | "warehouseFilter" | "sales" | "export";

const PARTS: PendingPart<SupplierDetailPendingId>[] = [
  // supplier-detail-has-channels-and-products-tabs: the Products tab is SAMPLE rows — a product is linked to a
  // store when a restock bought there is accepted (restock-accepted-links-the-product-to-its-channel), and that
  // is not built yet, so there is nothing real to show.
  { id: "products", kind: "sample" },
  // A store's and a product's Terjual (all time, with the last order) and Siap (with the last restock) — summed over
  // what was bought at the store, which nothing records yet.
  { id: "sold", kind: "sample" },
  { id: "ready", kind: "sample" },
  // GUDANG TERKAIT (a-supplier-page-is-scoped-by-its-warehouses) — the warehouses its restocks were received at, and how
  // many, are invented; and a chip picked is held and thrown away, since no tab can narrow by a warehouse yet.
  { id: "warehouses", kind: "sample" },
  { id: "warehouseFilter", kind: "dropped" },
  // PENJUALAN beside Direstok on the Statistik tab (sales-sit-beside-restocked) — invented from the same row's restock.
  { id: "sales", kind: "sample" },
  // EACH TAB'S EXPORT (each-supplier-tab-exports-its-own-table) — nothing builds a file yet; the button holds the
  // action's place, as the Supplier Report's does.
  { id: "export", kind: "dropped" },
];

export const SUPPLIER_DETAIL_PENDING: PendingList<SupplierDetailPendingId> = {
  ns: "supplierChannel",
  parts: PARTS,
};
