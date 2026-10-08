import type { PendingList, PendingPart } from "../../features/pending/registry";

// WHAT THE DISCOVER DETAIL CANNOT DO YET. One thing: its Products tab is invented rows — a product is linked to a
// store when a restock bought there is accepted (restock-accepted-links-the-product-to-its-channel), and restock lines
// name no store yet. The supplier, its team, its stores and its figures are real reads. See `features/pending`.

/** One unwired part of the page. The id is also its i18n key (`suppliers.discover.pending.<id>`). */
export type DiscoverSupplierDetailPendingId = "products";

const PARTS: PendingPart<DiscoverSupplierDetailPendingId>[] = [
  { id: "products", kind: "sample" },
];

export const DISCOVER_SUPPLIER_DETAIL_PENDING: PendingList<DiscoverSupplierDetailPendingId> = {
  ns: "suppliers.discover",
  parts: PARTS,
};
