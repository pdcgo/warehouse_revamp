import type { PendingList, PendingPart } from "../../features/pending/registry";

// WHAT THE DISCOVER DETAIL CANNOT SHOW YET — another team's product, read by a selling team deciding
// whether to sell it.
//
// The record and the shelf figures are real: ProductByIds names the product whoever owns it, and
// StockAvailability counts what each warehouse holds. What is not real is what the Discover card already
// shows invented — the division, the cross price, what is on its way — and how many of the shelf's units
// are THEIRS to take. See `features/pending` for the four kinds. In the order they appear down the page.

/** One unwired part of the page. The id is also its i18n key (`discoverDetail.pending.<id>`). */
export type DiscoverDetailPendingId =
  | "division"
  | "gallery"
  | "ongoing"
  | "crossPrice"
  | "derived"
  | "suppliers"
  | "daily"
  | "history";

const PARTS: PendingPart<DiscoverDetailPendingId>[] = [
  // PRIORITAS · RISET, beside the name — the card's badge (discover-opens-on-priority): set per product, stored nowhere,
  // so the same invented one the card shows (`sampleDivision`).
  { id: "division", kind: "sample" },
  // A by-ids row carries the cover and not the image list; the list comes from ProductDetail, which
  // answers only the owning team.
  { id: "gallery", kind: "missing" },
  // ANOTHER TEAM'S STOCK ON ITS WAY — OwnerStockByIds answers only for the caller's own goods, so the card's invented
  // figure (`sampleStock`). The ready figure above it is real: the shelves, summed.
  { id: "ongoing", kind: "sample" },
  // ANOTHER TEAM'S CROSS PRICE — the card's (`discoverPriceOf`): an invented cost with the product's REAL markup over it,
  // until a cross-team read of what a product costs exists. Who may SEE that cost is still open in
  // docs/business/product/context_clarify.md. The SAME mark on Per Gudang's price column: each warehouse's price is that
  // invented range shared out among the warehouses holding it (`sampleWarehouseCross`). The caller's OWN products show
  // real figures, in Info and per warehouse.
  { id: "crossPrice", kind: "sample" },
  // PRODUK TURUNAN — the owner's page's section and its rows (`sampleDerived`): the link a return to another team makes
  // between two products is recorded nowhere yet.
  { id: "derived", kind: "sample" },
  // PEMASOK, a tab of Per Gudang — the owner's page's rows (features/products/supplierSample.ts): the suppliers, their
  // stores and the stores' links are real; that THIS product was bought at THAT store waits on an accepted restock
  // linking them (restock-accepted-links-the-product-to-its-channel), and the deliveries and units on the batches being
  // grouped per supplier.
  { id: "suppliers", kind: "sample" },
  // KELUAR MASUK HARIAN, a tab of Per Gudang — the owner's page's sample: nothing sums the movements per day.
  { id: "daily", kind: "sample" },
  // RIWAYAT STOK of ANOTHER team's product — every team may read it (owner: *"riwayat stok boleh dibaca semua orang"*,
  // stock-history-is-everyones), but OwnerStockHistory answers only the owning team, so the rows are invented
  // (historySample.ts): each warehouse's story ending at its real shelf. Real on the team's own product.
  { id: "history", kind: "sample" },
];

export const DISCOVER_DETAIL_PENDING: PendingList<DiscoverDetailPendingId> = {
  ns: "discoverDetail",
  parts: PARTS,
};
