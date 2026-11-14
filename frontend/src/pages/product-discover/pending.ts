import type { PendingList, PendingPart } from "../../features/pending/registry";

// WHAT PRODUCT DISCOVER CANNOT DO YET — see `features/pending` for the four kinds and why a badge's number is its position
// in this list. Every filter the owner asked for is ON the screen (`discover-filters-in-a-side-panel`) and every one
// narrows on the server, except the division chips, which hold their pick and throw it away.

/** One unwired part. The id is also its i18n key (`discover.pending.<id>`). */
export type DiscoverPendingId = "division" | "divisionBadge";

const PARTS: PendingPart<DiscoverPendingId>[] = [
  // PRIORITAS · RISET · UMUM (owner: *"aturan di context yang belum ada adalah pembagian produk … tulis saja di
  // unimplemented karena context dan bisnis lain bukan kewenanganku"*) — a division set PER PRODUCT, Prioritas by
  // default. Not in the business context, and nothing stores it.
  { id: "division", kind: "dropped" },
  // ✅ The cards' cross price and stock (`crossPrice`, `cardStock`) and the Kunci filter (`lockFilter`) are real since
  // 2026-11-14 — DiscoverStockByIds and ProductDiscover's filter.lock — and so are the Gudang, Kategori, Stok siap and
  // Harga cross filters (`warehouse`, `category`, `stock`, `crossRange`): ProductDiscover narrows by each before its count
  // and page. Their marks are gone.
  //
  // THE DIVISION BADGE on a card (owner: *"di card juga ada badge sesuai tipe prioritas, riset dan umum"*) — invented, for
  // the same reason the chips narrow nothing: the division is stored nowhere.
  { id: "divisionBadge", kind: "sample" },
];

export const DISCOVER_PENDING: PendingList<DiscoverPendingId> = { ns: "discover", parts: PARTS };
