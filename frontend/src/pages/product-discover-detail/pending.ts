import type { PendingList, PendingPart } from "../../features/pending/registry";

// WHAT THE DISCOVER DETAIL CANNOT SHOW YET — another team's product, read by a selling team deciding
// whether to sell it.
//
// The record and the shelf figures are real: ProductByIds names the product whoever owns it, and
// StockAvailability counts what each warehouse holds. What is not real is the two answers a borrower
// actually came for — how many of those units are THEIRS to take, and what each one will cost them —
// because both rest on rules docs/business/product has not settled. See `features/pending` for the
// four kinds.

/** One unwired part of the page. The id is also its i18n key (`discoverDetail.pending.<id>`). */
export type DiscoverDetailPendingId = "canTake" | "unitCost" | "gallery" | "suppliers";

const PARTS: PendingPart<DiscoverDetailPendingId>[] = [
  // Shelf minus the owner's reserve. The reserve is real (Product.reserved_stock) but its rule is not:
  // whether it binds only OTHER teams' orders, and whether the test is `stock < reserve` or
  // `stock − requested < reserve`, is open in docs/business/product/context_clarify.md (point 5).
  { id: "canTake", kind: "derived" },
  // COGS on a cross line is `UnitPrice + UnitPrice × markup`. The markup is on the wire; the unit price
  // is not shown, because who may SEE another team's unit price is still Awaiting in the same clarify —
  // and the fee gives the owner's cost away by arithmetic.
  { id: "unitCost", kind: "missing" },
  // A by-ids row carries the cover and not the image list; the list comes from ProductDetail, which
  // answers only the owning team.
  { id: "gallery", kind: "missing" },
  // Which supplier stores list it — supplier_channel_products read backwards. That table waits on an accepted
  // restock linking the product to its store (restock-accepted-links-the-product-to-its-channel), so the LINKS are
  // invented — picked from the real suppliers Discover Suppliers reads (sampleSuppliers.ts).
  { id: "suppliers", kind: "sample" },
];

export const DISCOVER_DETAIL_PENDING: PendingList<DiscoverDetailPendingId> = {
  ns: "discoverDetail",
  parts: PARTS,
};
