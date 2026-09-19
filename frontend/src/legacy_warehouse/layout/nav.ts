import type { ElementType } from "react";
import {
  TabletSmartphone,
  Boxes,
  ClipboardList,
  Download,
  EggOff,
  FileText,
  Gauge,
  LogIn,
  LogOut,
  Settings,
  Users,
  Wallet,
  History,
  BarChart3,
} from "lucide-react";

// ── THE FLOOR MENU ──────────────────────────────────────────────────────────────────────────────
//
// Three groups, and the grouping is the interesting part: it is by WHO IS ASKING, not by data type.
//
//   Movement  — the picker and the packer. What is coming in, what is going out, today.
//   Stock     — whoever is answering "where is it / what is wrong with it".
//   Elsewhere — the supervisor: money, insight, people, settings.
//
// A menu grouped by entity ("Orders / Products / Users") would scatter the picker's three screens
// across all three groups. Here the person who only ever needs Movement never scrolls past it.
export interface FloorNavItem {
  key: string;
  name: string;
  icon: ElementType;
  href: string;
  // A count of things needing attention. Rendered as a badge, capped — see SideLink.
  badge?: number;
  // Marks a screen that is a rewrite of the one above it, running side by side with the original
  // while it is proved out. See the note on `outbound` below.
  experimental?: boolean;
  // Which roles may see it at all. An item the caller cannot use is not greyed out, it is absent —
  // see WarehouseSidebar.
  roles?: string[];
}

export interface FloorNavGroup {
  key: string;
  name: string;
  items: FloorNavItem[];
}

export const FLOOR_NAV: FloorNavGroup[] = [
  {
    key: "movement",
    name: "Movement",
    items: [
      { key: "dashboard", name: "Dashboard", icon: Gauge, href: "/" },
      { key: "inbound", name: "Inbound", icon: LogIn, href: "/inbound" },
      { key: "outbound", name: "Outbound", icon: LogOut, href: "/outbound" },
      // ⚠ TWO ENTRIES, SAME NAME, ONE MARKED EXP.
      //
      // The floor app ships the old outbound screen and its rewrite AT THE SAME TIME, both in the
      // menu, both named "Outbound". That is a deliberate and defensible thing to do here: outbound
      // is the screen that stops the warehouse if it is wrong, so the rewrite runs beside the
      // original until the floor trusts it rather than replacing it on a release.
      //
      // The cost is that two menu items share a name and are told apart only by a three-letter tag,
      // which is a real hazard when the reader is in a hurry. Better would be naming what is
      // different about it — the rewrite is scan-first, so "Outbound (scan)" says something the tag
      // does not. Recorded, not changed: this is a reference.
      { key: "outbound-exp", name: "Outbound", icon: LogOut, href: "/outbound-experimental", experimental: true },
      { key: "invoices", name: "Invoices", icon: FileText, href: "/invoices" },
    ],
  },
  {
    key: "stock",
    name: "Stock",
    items: [
      { key: "inventory", name: "Inventory centre", icon: Boxes, href: "/inventory" },
      { key: "problem-items", name: "Problem items", icon: EggOff, href: "/problem-inventories" },
      {
        key: "broken-inventory",
        name: "Problem items",
        icon: EggOff,
        href: "/problem-inventories-experimental",
        experimental: true,
      },
      { key: "daily-stock", name: "Daily stock history", icon: History, href: "/daily-stock-history" },
    ],
  },
  {
    key: "elsewhere",
    name: "Elsewhere",
    items: [
      { key: "cashbook", name: "Cash book", icon: Wallet, href: "/cashbook" },
      { key: "insight", name: "Warehouse insight", icon: BarChart3, href: "/warehouse-insight" },
      // ⚠ ROLE-GATED, AND ABSENT RATHER THAN DISABLED for anyone else. A greyed-out item that can
      // never be enabled is a permanent invitation to click something that will refuse — and on a
      // floor tablet shared between shifts, it is also a hint about what somebody else can do.
      { key: "team-members", name: "Team members", icon: Users, href: "/team-members", roles: ["owner", "admin"] },
      { key: "downloads", name: "Warehouse apps", icon: TabletSmartphone, href: "/downloads" },
      { key: "settings", name: "Settings", icon: Settings, href: "/settings" },
    ],
  },
];

// Screens reachable but not in the menu. Worth listing rather than leaving implicit: three of them
// are full-screen and mount OUTSIDE the shell (there is no sidebar to navigate back from), and one
// is a placeholder that two menu-less routes both land on.
export const OFF_MENU: FloorNavItem[] = [
  { key: "track-before-send", name: "Track before send", icon: ClipboardList, href: "/track-before-send" },
  { key: "print-barcode", name: "Print barcodes", icon: Download, href: "/print-barcode" },
  { key: "print-receipt", name: "Print receipts", icon: Download, href: "/print-receipt" },
];

// Longest-prefix match, with "/" special-cased to exact. Same rule as the live app's `nav.ts` —
// without the special case, the dashboard at "/" is "current" on every screen in the app.
export function isCurrent(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function visibleGroups(roles: string[]): FloorNavGroup[] {
  return FLOOR_NAV.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.roles || item.roles.some((r) => roles.includes(r))),
  })).filter((group) => group.items.length > 0);
}
