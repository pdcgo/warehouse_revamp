// THE SECTIONS OF A BATCH'S PAGE, IN ORDER — the one list the navigation and the page both read, as the rack page's, the
// product page's and the restock pages' `sections.ts` are (owner: *"inisiasi bacth detail"*,
// a-batch-page-is-one-page-of-sections). The key is also the section's DOM id (`batch-section-<key>`), which the nav
// scrolls to; the icon is the card's and the nav item's.
//
// Where the batch was put WHEN IT WAS ACCEPTED first — fixed at the accept, never where it sits now: a rack counts per
// product, not per batch (a-batch-shows-the-racks-it-was-put-on) — then what has happened to it, then the batch's own
// record. The put-away is its own section, not Riwayat's first rows: the owner, *"riwayat itu beda konteks"*.
//
// INFO IS THE LOWEST, SO IT IS LAST (owner: *"secara prioritas info batch paling rendah, jadi kalau di layar kecil dia
// paling bawah"*, info-batch-comes-last) — on a narrow screen under Riwayat, and last in the nav. On a wide one it is the
// card beside the rest, as a rack's is.
import type { LucideIcon } from "lucide-react";
import { FileText, History, Warehouse } from "lucide-react";

export type BatchSectionKey = "placements" | "info" | "history";

export const BATCH_SECTIONS: { key: BatchSectionKey; titleKey: string; icon: LucideIcon }[] = [
  { key: "placements", titleKey: "batchDetail.tabPlacements", icon: Warehouse },
  { key: "history", titleKey: "batchDetail.tabHistory", icon: History },
  { key: "info", titleKey: "batchDetail.tabInfo", icon: FileText },
];

/** Every key, in order — the stable list `useScrollSpy` reads. */
export const BATCH_SECTION_KEYS: BatchSectionKey[] = BATCH_SECTIONS.map((s) => s.key);

/**
 * The sections scrolling may light while Info stands beside them — every one but Info. It is short and sits high, so it
 * would win while the reader is halfway down the racks; it lights when clicked.
 */
export const BATCH_MAIN_SECTIONS: BatchSectionKey[] = BATCH_SECTION_KEYS.filter((key) => key !== "info");

/** The DOM id a section carries and the nav scrolls to. */
export function batchSectionDomId(key: BatchSectionKey): string {
  return `batch-section-${key}`;
}

/** The section's entry — its icon and its title. */
export function batchSection(key: BatchSectionKey) {
  return BATCH_SECTIONS.find((s) => s.key === key)!;
}
