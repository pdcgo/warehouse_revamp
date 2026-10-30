import type { PendingList, PendingPart } from "../../features/pending/registry";

// WHAT THE SHOPS LIST CANNOT DO YET — see `features/pending` for the four kinds and why a badge's number is its position
// in this list.

/** One unwired part. The id is also its i18n key (`shops.pending.<id>`). */
export type ShopsPendingId = "marketplaceFilter" | "primaryFilter" | "noPrimaryFilter";

const PARTS: PendingPart<ShopsPendingId>[] = [
  // THE MARKETPLACE (owner: *"oke tambahkan dengan warning, filter mp"*) — held in the URL and thrown away: ShopListFilter
  // has only `q`, and a paged list cannot be narrowed on screen without missing the shops on the other pages.
  { id: "marketplaceFilter", kind: "dropped" },
  // THE PRIMARY CS — a person; held and thrown away the same way, until ShopListFilter carries a `primary_user_id`.
  { id: "primaryFilter", kind: "dropped" },
  // THE SHOPS WITH NO PRIMARY CS — its own tick (owner: *"bedakan belum ada csnya"*); the same, until the contract can
  // ask for a shop whose primary is none.
  { id: "noPrimaryFilter", kind: "dropped" },
];

export const SHOPS_LIST_PENDING: PendingList<ShopsPendingId> = { ns: "shops", parts: PARTS };
