import type { PendingList, PendingPart } from "../../features/pending/registry";

// WHAT THE SUPPLIER PAGE CANNOT DO YET. One thing: the Products tab stands on invented rows — it needs a store on each
// restock line (the-supplier-comes-from-the-restock-until-lines-name-a-store). The supplier, its stores and its figures
// are real — supplier_service holds every field the page shows
// (the-crud-prototype-is-accepted). See `features/pending` for the four kinds.

/** One unwired part of the page. The id is also its i18n key (`supplierChannel.pending.<id>`). */
export type SupplierDetailPendingId = "products";

const PARTS: PendingPart<SupplierDetailPendingId>[] = [
  // supplier-detail-has-channels-and-products-tabs: the Products tab is SAMPLE rows — a product is linked to a
  // store when a restock bought there is accepted (restock-accepted-links-the-product-to-its-channel), and that
  // is not built yet, so there is nothing real to show.
  { id: "products", kind: "sample" },
];

export const SUPPLIER_DETAIL_PENDING: PendingList<SupplierDetailPendingId> = {
  ns: "supplierChannel",
  parts: PARTS,
};
