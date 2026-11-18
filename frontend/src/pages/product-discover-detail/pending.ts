import type { PendingList, PendingPart } from "../../features/pending/registry";

// WHAT THE DISCOVER DETAIL CANNOT SHOW YET — another team's product, read by a selling team deciding
// whether to sell it.
//
// The record and the shelf figures are real: ProductByIds names the product whoever owns it, StockAvailability counts
// what each warehouse holds, and DiscoverStockByIds — the card's own read — says what is on its way and the cross price,
// in every warehouse and in each (2026-11-14; the `ongoing` and `crossPrice` samples are gone). The gallery is the by-ids
// IMAGES slice and another team's Riwayat Stok is DiscoverStockHistory (2026-11-16; the `gallery` and `history` marks are
// gone). What is not real is the division the card also invents and the sections below. See `features/pending` for the
// kinds. In the order they appear down the page.

/** One unwired part of the page. The id is also its i18n key (`discoverDetail.pending.<id>`). */
export type DiscoverDetailPendingId = "division" | "derived" | "suppliers" | "daily";

const PARTS: PendingPart<DiscoverDetailPendingId>[] = [
  // PRIORITAS · RISET, beside the name — the card's badge (discover-opens-on-priority): set per product, stored nowhere,
  // so the same invented one the card shows (`sampleDivision`).
  { id: "division", kind: "sample" },
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
];

export const DISCOVER_DETAIL_PENDING: PendingList<DiscoverDetailPendingId> = {
  ns: "discoverDetail",
  parts: PARTS,
};
