import type { PendingList, PendingPart } from "../../features/pending/registry";

// WHAT DISCOVER SUPPLIERS CANNOT DO YET. One thing, and it is the whole page: no server answers a supplier
// search ACROSS teams — today's SupplierList answers the caller's own team only — so every row is invented
// (features/suppliers/discover.ts) until supplier_service builds the read. See `features/pending`.

/** One unwired part of the page. The id is also its i18n key (`suppliers.discover.pending.<id>`). */
export type DiscoverSuppliersPendingId = "suppliers";

const PARTS: PendingPart<DiscoverSuppliersPendingId>[] = [{ id: "suppliers", kind: "sample" }];

export const DISCOVER_SUPPLIERS_PENDING: PendingList<DiscoverSuppliersPendingId> = {
  ns: "suppliers.discover",
  parts: PARTS,
};
