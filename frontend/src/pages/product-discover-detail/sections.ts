// THE SECTIONS OF THE DISCOVER DETAIL, IN ORDER — the one list the navigation and the page both read, as the product's
// own page's `sections.ts` is (the-discover-detail-is-the-product-page). The key is also the section's DOM id
// (`discover-section-<key>`), which is what the nav scrolls to; the icon is the card's and the nav item's both.
//
// The owner's page's, less Batch — the owner's record of deliveries — and less Penjualan Tim Lain: the lock is the badge
// beside the name (the-lock-is-the-title-badge). Produk Turunan beside Info (owner: *"produk turunan juga ditampilkan"*,
// the-discover-detail-shows-no-markup); Per Gudang the owner's page's warehouse card
// WITHOUT Harga Modal, Pemasok one of its tabs as there (the-discover-detail-has-the-warehouse-zone) — and above it, where
// the owner's page has Batch, HARGA PER GUDANG: every warehouse's ready stock and cross price, never lensed.
import type { LucideIcon } from "lucide-react";
import { Coins, FileText, GitBranch, Warehouse } from "lucide-react";

export type DiscoverSectionKey = "info" | "derived" | "price" | "warehouse";

// `navKey` is the short label for the 13rem column, `titleKey` the card's full one — the owner's page's own where it is
// the same card.
export const DISCOVER_SECTIONS: { key: DiscoverSectionKey; titleKey: string; navKey: string; icon: LucideIcon }[] = [
  { key: "info", titleKey: "products.detail.section.info", navKey: "products.detail.nav.info", icon: FileText },
  { key: "derived", titleKey: "products.detail.section.derived", navKey: "products.detail.nav.derived", icon: GitBranch },
  { key: "price", titleKey: "discoverDetail.priceHeading", navKey: "discoverDetail.priceNav", icon: Coins },
  { key: "warehouse", titleKey: "products.detail.section.warehouse", navKey: "products.detail.nav.warehouse", icon: Warehouse },
];

/** Every key, in order — the stable list `useScrollSpy` reads. */
export const DISCOVER_SECTION_KEYS: DiscoverSectionKey[] = DISCOVER_SECTIONS.map((s) => s.key);

/** The sections scrolling may light while the side column is beside them — every one but the side cards. */
export const DISCOVER_MAIN_SECTIONS: DiscoverSectionKey[] = ["info", "price", "warehouse"];

/**
 * The tabs of the warehouse card — the owner's page's (the-warehouse-zone-is-tabs) WITHOUT Harga Modal, the owner's cost
 * layers (owner: *"dengan tanpa harga modal"*). Its replacement is not a tab: each warehouse's ready stock and cross price
 * is the Harga per Gudang section ABOVE the card (owner: *"harganya tidak masuk section per gudang ini, tapi di
 * atasnya"*). Overview first; only the open one is mounted, so only its rows are read.
 */
export type DiscoverWarehouseTab = "overview" | "suppliers" | "daily" | "history";
export const DISCOVER_WAREHOUSE_TABS: DiscoverWarehouseTab[] = ["overview", "suppliers", "daily", "history"];

/** The DOM id a section carries and the nav scrolls to. */
export function discoverSectionDomId(key: DiscoverSectionKey): string {
  return `discover-section-${key}`;
}

/** The section's entry — its icon and its two labels. */
export function discoverSection(key: DiscoverSectionKey) {
  return DISCOVER_SECTIONS.find((s) => s.key === key)!;
}
