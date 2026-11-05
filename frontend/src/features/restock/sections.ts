// THE SECTIONS OF A RESTOCK'S PAGE, IN ORDER — the one list the navigation and the page both read, as the product
// page's `sections.ts` is (owner: *"kalau menggunakan yang sesuai dengan produk detail … halaman jadi 1 dan tidak dipisah
// berdasarkan tab, di kiri itu cuma jadi navigasi saja"*, the-restock-detail-is-the-product-pages-shape). The key is also
// the section's DOM id (`restock-section-<key>`), which the nav scrolls to; the icon is the card's and the nav item's.
import type { LucideIcon } from "lucide-react";
import { HandCoins, History, NotebookText, Package, Truck, Wallet } from "lucide-react";

export type RestockSectionKey = "delivery" | "payment" | "courier" | "products" | "note" | "timeline";

export const RESTOCK_SECTIONS: { key: RestockSectionKey; titleKey: string; icon: LucideIcon }[] = [
  { key: "delivery", titleKey: "restock.detail.delivery", icon: Truck },
  { key: "payment", titleKey: "restock.detail.payment", icon: Wallet },
  // Only once accepted — the warehouse enters it at the door; before then there is nothing to owe.
  { key: "courier", titleKey: "restock.detail.section.courier", icon: HandCoins },
  { key: "products", titleKey: "restock.detail.products", icon: Package },
  { key: "note", titleKey: "restock.detail.note", icon: NotebookText },
  { key: "timeline", titleKey: "restock.detail.tab.timeline", icon: History },
];

/** The DOM id a section carries and the nav scrolls to. */
export function restockSectionDomId(key: RestockSectionKey): string {
  return `restock-section-${key}`;
}

/** The section's entry — its icon and its title. */
export function restockSection(key: RestockSectionKey) {
  return RESTOCK_SECTIONS.find((s) => s.key === key)!;
}
