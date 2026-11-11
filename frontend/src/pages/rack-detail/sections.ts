// THE SECTIONS OF A RACK'S PAGE, IN ORDER — the one list the navigation and the page both read, as the product page's and
// the restock pages' `sections.ts` are (owner: *"iya seperti usulmu, gunakan detail lain sebagai referensi"*,
// a-rack-page-is-one-page-of-sections). The key is also the section's DOM id (`rack-section-<key>`), which the nav scrolls
// to; the icon is the card's and the nav item's.
//
// THREE, NOT THE FIVE TABS (owner: *"produk dan harga sama … riwayat stok dan penempatanpun kelihatan sama"*, then
// *"oke"*): Harga was Produk with two more columns, and Riwayat Penempatan was Riwayat Stok narrowed to put-aways and
// moves — on one page they read twice. What is on the shelf first — what somebody standing at the rack came for — then
// the rack's own record, then what has happened to it. Info is short, so on a wide screen it is a card beside the rest.
import type { LucideIcon } from "lucide-react";
import { FileText, History, Package } from "lucide-react";

export type RackSectionKey = "products" | "info" | "history";

export const RACK_SECTIONS: { key: RackSectionKey; titleKey: string; icon: LucideIcon }[] = [
  { key: "products", titleKey: "racks.detail.tab.products", icon: Package },
  { key: "info", titleKey: "racks.detail.tab.info", icon: FileText },
  { key: "history", titleKey: "racks.detail.tab.history", icon: History },
];

/** Every key, in order — the stable list `useScrollSpy` reads. */
export const RACK_SECTION_KEYS: RackSectionKey[] = RACK_SECTIONS.map((s) => s.key);

/**
 * The sections scrolling may light while Info stands beside them — every one but Info. It is short and sits high, so it
 * would win while the reader is halfway down the shelf; it lights when clicked.
 */
export const RACK_MAIN_SECTIONS: RackSectionKey[] = RACK_SECTION_KEYS.filter((key) => key !== "info");

/** The DOM id a section carries and the nav scrolls to. */
export function rackSectionDomId(key: RackSectionKey): string {
  return `rack-section-${key}`;
}

/** The section's entry — its icon and its title. */
export function rackSection(key: RackSectionKey) {
  return RACK_SECTIONS.find((s) => s.key === key)!;
}
