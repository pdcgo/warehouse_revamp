// THE SECTIONS OF A PRODUCT'S PAGE, IN ORDER — the one list the navigation and the page both read, as the order
// detail's own `sections.ts` is (the-product-page-is-one-page-of-sections). The key is also the section's DOM id
// (`product-section-<key>`), which is what the nav scrolls to; the icon is the card's and the nav item's both.
//
// TWO ZONES (the-warehouse-picker-splits-the-page): every section but `warehouse` is the product across every
// warehouse; `warehouse` is the picker and, under it, TABS for what one warehouse holds (the-warehouse-zone-is-tabs) —
// so only the tab being read loads.
import type { LucideIcon } from "lucide-react";
import { FileText, GitBranch, Handshake, Package, Warehouse } from "lucide-react";

// Aktivitas is not a section: its two dates are rows of Info (owner: *"aktivitas masukkan ke info produk"*).
export type ProductSectionKey = "info" | "batch" | "cross" | "derived" | "warehouse";

// `navKey` is the short label for the 13rem column, `titleKey` the card's full one.
export const PRODUCT_SECTIONS: { key: ProductSectionKey; titleKey: string; navKey: string; icon: LucideIcon }[] = [
  { key: "info", titleKey: "products.detail.section.info", navKey: "products.detail.nav.info", icon: FileText },
  { key: "batch", titleKey: "products.detail.section.batch", navKey: "products.detail.nav.batch", icon: Package },
  { key: "cross", titleKey: "products.detail.section.cross", navKey: "products.detail.nav.cross", icon: Handshake },
  { key: "derived", titleKey: "products.detail.section.derived", navKey: "products.detail.nav.derived", icon: GitBranch },
  { key: "warehouse", titleKey: "products.detail.section.warehouse", navKey: "products.detail.nav.warehouse", icon: Warehouse },
];

/** Every key, in order — the stable list `useScrollSpy` reads. */
export const PRODUCT_SECTION_KEYS: ProductSectionKey[] = PRODUCT_SECTIONS.map((s) => s.key);

/**
 * The sections scrolling may light while the side column is beside them — every one but the side cards. The side
 * cards are short and sit high, so they would win while the reader is halfway down the batches; they light when
 * clicked.
 */
export const PRODUCT_MAIN_SECTIONS: ProductSectionKey[] = ["info", "batch", "warehouse"];

/**
 * The tabs of the warehouse zone, Overview first (the-warehouse-zone-is-tabs) — and Pemasok a tab of its own, after
 * Harga Modal (the-suppliers-are-a-tab-of-their-own).
 */
export type WarehouseTab = "overview" | "price" | "suppliers" | "daily" | "history";
export const WAREHOUSE_TABS: WarehouseTab[] = ["overview", "price", "suppliers", "daily", "history"];

/** The DOM id a section carries and the nav scrolls to. */
export function productSectionDomId(key: ProductSectionKey): string {
  return `product-section-${key}`;
}

/** The section's entry — its icon and its two labels. */
export function productSection(key: ProductSectionKey) {
  return PRODUCT_SECTIONS.find((s) => s.key === key)!;
}
