import type { PendingList, PendingPart } from "../../features/pending/registry";

// WHAT THE DISCOVER DETAIL CANNOT DO YET. Two things, both invented rows: the supplier itself — no server reads
// another team's supplier with its channels yet, so it comes from the discover sample
// (features/suppliers/discover.ts) — and its products, which wait on the channel-product linking
// (linking-products-is-deferred). See `features/pending`.

/** One unwired part of the page. The id is also its i18n key (`suppliers.discover.pending.<id>`). */
export type DiscoverSupplierDetailPendingId = "supplier" | "products";

const PARTS: PendingPart<DiscoverSupplierDetailPendingId>[] = [
  { id: "supplier", kind: "sample" },
  { id: "products", kind: "sample" },
];

export const DISCOVER_SUPPLIER_DETAIL_PENDING: PendingList<DiscoverSupplierDetailPendingId> = {
  ns: "suppliers.discover",
  parts: PARTS,
};
