import type { PendingList, PendingPart } from "../../features/pending/registry";

// WHAT PRODUCT DISCOVER CANNOT DO YET — see `features/pending` for the four kinds and why a badge's number is its position
// in this list. Every filter the owner asked for is ON the screen (`discover-filters-in-a-side-panel`); the ones nothing
// can answer yet hold their pick and throw it away.

/** One unwired part. The id is also its i18n key (`discover.pending.<id>`). */
export type DiscoverPendingId =
  | "warehouse"
  | "division"
  | "category"
  | "stock"
  | "crossRange"
  | "crossPrice"
  | "cardStock"
  | "divisionBadge"
  | "lockFilter";

const PARTS: PendingPart<DiscoverPendingId>[] = [
  // THE WAREHOUSE (owner: *"gudang di atas"*) — the products held at that warehouse. Stock is inventory_service's and
  // the browse is product_service's (HARD RULE 3), so narrowing a PAGED list by it needs one read that joins the two.
  { id: "warehouse", kind: "dropped" },
  // PRIORITAS · RISET · UMUM (owner: *"aturan di context yang belum ada adalah pembagian produk … tulis saja di
  // unimplemented karena context dan bisnis lain bukan kewenanganku"*) — a division set PER PRODUCT, Prioritas by
  // default. Not in the business context, and nothing stores it.
  { id: "division", kind: "dropped" },
  // THE CATEGORY — ProductDiscover takes no category filter yet (product context_decision: nothing filters by category).
  { id: "category", kind: "dropped" },
  // ONLY WHAT HAS READY STOCK (owner: *"yang difilter adalah yang ready"*) — the same cross-service read as the warehouse.
  { id: "stock", kind: "dropped" },
  // THE CROSS PRICE RANGE — a product's cost is inventory_service's, and another team's is not readable across teams.
  { id: "crossRange", kind: "dropped" },
  // ANOTHER TEAM'S CROSS PRICE on its card (owner: *"secara default yang muncul di sini adalah harga cross"*) — invented
  // from its markup, until a cross-team read of what it costs exists. The caller's OWN products show real figures.
  { id: "crossPrice", kind: "sample" },
  // ANOTHER TEAM'S READY AND ONGOING STOCK on its card (owner: *"di cardnya ada stok ready dan stok ongoing"*) — invented,
  // since OwnerStockByIds answers only for the caller's own goods. The caller's own products show real figures.
  { id: "cardStock", kind: "sample" },
  // THE DIVISION BADGE on a card (owner: *"di card juga ada badge sesuai tipe prioritas, riset dan umum"*) — invented, for
  // the same reason the chips narrow nothing: the division is stored nowhere.
  { id: "divisionBadge", kind: "sample" },
  // TERBUKA · TERKUNCI (owner: *"filter terkunci dan terbuka, terkunci itu yang kena dikunci dan stoknya <= min"*) — the
  // server serves this page every locked product now (a-locked-product-shows-on-discover) but has no lock filter, and
  // whether a minimum has closed one needs its ready stock, which is inventory_service's. Held on screen and thrown away.
  { id: "lockFilter", kind: "dropped" },
];

export const DISCOVER_PENDING: PendingList<DiscoverPendingId> = { ns: "discover", parts: PARTS };
