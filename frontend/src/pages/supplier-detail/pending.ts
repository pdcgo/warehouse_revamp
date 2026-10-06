import type { PendingList, PendingPart } from "../../features/pending/registry";

// WHAT THE SUPPLIER PAGE CANNOT DO YET — the CRUD prototype of docs/business/supplier.
//
// The screens are built to the decided shape and talk to the OLD server through the translation step in
// features/suppliers/adapt.ts. Most of the difference is invisible — a code is made up, an old offline shop
// reads as Other — but one thing typed here is genuinely lost: the old channel has no description. See
// `features/pending` for the four kinds.

/** One unwired part of the page. The id is also its i18n key (`supplierChannel.pending.<id>`). */
export type SupplierDetailPendingId = "channelDescription";

const PARTS: PendingPart<SupplierDetailPendingId>[] = [
  // the-supplier-lists-only-its-online-stores gives a channel a description; warehouse.inventory.v1 has no
  // field for it, so it is typed and thrown away until supplier_service lands.
  { id: "channelDescription", kind: "dropped" },
];

export const SUPPLIER_DETAIL_PENDING: PendingList<SupplierDetailPendingId> = {
  ns: "supplierChannel",
  parts: PARTS,
};
