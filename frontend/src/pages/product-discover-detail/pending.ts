import type { PendingList, PendingPart } from "../../features/pending/registry";

// WHAT THE DISCOVER DETAIL CANNOT SHOW YET — another team's product, read by a selling team deciding
// whether to sell it.
//
// The record and the shelf figures are real: ProductByIds names the product whoever owns it, StockAvailability counts
// what each warehouse holds, and DiscoverStockByIds — the card's own read — says what is on its way and the cross price,
// in every warehouse and in each (2026-11-14; the `ongoing` and `crossPrice` samples are gone). The gallery is the by-ids
// IMAGES slice and another team's Riwayat Stok is DiscoverStockHistory (2026-11-16; the `gallery` and `history` marks are
// gone), Pemasok is ProductSupplierGoods and Keluar Masuk Harian is ProductDailyMoves (2026-11-21; the `suppliers` and
// `daily` marks are gone). What is not real is the division the card also invents and the section below. See
// `features/pending` for the kinds. In the order they appear down the page.

/** One unwired part of the page. The id is also its i18n key (`discoverDetail.pending.<id>`). */
export type DiscoverDetailPendingId = "division" | "derived";

const PARTS: PendingPart<DiscoverDetailPendingId>[] = [
  // PRIORITAS · RISET, beside the name — the card's badge (discover-opens-on-priority): set per product, stored nowhere,
  // so the same invented one the card shows (`sampleDivision`).
  { id: "division", kind: "sample" },
  // PRODUK TURUNAN — the owner's page's section and its rows (`sampleDerived`): the link a return to another team makes
  // between two products is recorded nowhere yet.
  { id: "derived", kind: "sample" },
];

export const DISCOVER_DETAIL_PENDING: PendingList<DiscoverDetailPendingId> = {
  ns: "discoverDetail",
  parts: PARTS,
};
