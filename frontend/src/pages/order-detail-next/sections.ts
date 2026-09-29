// THE SECTIONS OF THE ORDER DETAIL, IN ORDER — the one list the navigation and the page both read.
//
// ⚠ ONE LIST, TWO READERS. The nav on the left draws an item per entry and the page renders a section
// per entry; if each kept its own list, a section added to the page would be missing from the nav (or
// the reverse) and nothing would fail. Here it cannot drift, because there is nothing to keep in step.
//
// The key is also the section's DOM id (`order-section-<key>`), which is what the nav scrolls to.
//
// ⚠ THE ICON LIVES HERE TOO, for the same reason: the card and its nav item show the SAME icon, so
// "same picture = same place" holds, and a card's icon cannot quietly differ from the one beside its name
// in the nav.
import type { LucideIcon } from "lucide-react";
import { FileText, History, MapPin, Package, StickyNote, Truck, Wallet } from "lucide-react";

export type SectionKey = "info" | "notes" | "items" | "timeline" | "shipping" | "recipient" | "withdrawal";

// ⚠ `navKey` IS A SHORT LABEL, `titleKey` THE CARD'S FULL ONE. "Withdrawal dan penyesuaian" is right
// above a card and too long in a 13rem column, where it wrapped onto two lines and made that one item
// taller than its neighbours.
export const SECTIONS: { key: SectionKey; titleKey: string; navKey: string; icon: LucideIcon }[] = [
  { key: "info", titleKey: "orderDetail.info.title", navKey: "orderDetail.nav.info", icon: FileText },
  { key: "notes", titleKey: "orderDetail.notes.title", navKey: "orderDetail.nav.notes", icon: StickyNote },
  { key: "items", titleKey: "orderDetail.items.title", navKey: "orderDetail.nav.items", icon: Package },
  { key: "timeline", titleKey: "orderDetail.timeline.title", navKey: "orderDetail.nav.timeline", icon: History },
  { key: "shipping", titleKey: "orderDetail.shipping.title", navKey: "orderDetail.nav.shipping", icon: Truck },
  { key: "recipient", titleKey: "orderDetail.recipient.title", navKey: "orderDetail.nav.recipient", icon: MapPin },
  { key: "withdrawal", titleKey: "orderDetail.withdrawal.title", navKey: "orderDetail.nav.withdrawal", icon: Wallet },
];

/** The DOM id a section carries and the nav scrolls to. */
export function sectionDomId(key: SectionKey): string {
  return `order-section-${key}`;
}

/** The icon a section shows in its card header and its nav item. */
export function sectionIcon(key: SectionKey): LucideIcon {
  return SECTIONS.find((s) => s.key === key)!.icon;
}
