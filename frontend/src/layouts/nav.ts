import type { LucideIcon } from "lucide-react";
import {
  Boxes, Building2, CircleUser, ClipboardList, Compass, Factory, FileClock, FolderTree, Grid3x3, House, Layers, MapPin, Package, Handshake, Receipt, Scale, Settings, ShoppingCart, Store, TrendingUp, Truck, Users } from "lucide-react";
import { Role } from "../gen/warehouse/role_base/v1/role_pb";
import { TeamType } from "../gen/warehouse/team/v1/team_pb";
import { canManageUsers, isTeamManager } from "../lib/roles";

export interface MenuItem {
  to: string;
  // An i18n key (see src/i18n/locales) — the renderer translates it with t() (#97).
  label: string;
  icon: LucideIcon;
}

// A MenuGroup is a labelled section with child links — an expandable sub-menu in the sidebar (#95).
export interface MenuGroup {
  label: string;
  icon: LucideIcon;
  children: MenuItem[];
}

export type MenuEntry = MenuItem | MenuGroup;

export function isMenuGroup(entry: MenuEntry): entry is MenuGroup {
  return "children" in entry;
}

const HOME: MenuItem = { to: "/", label: "nav.home", icon: House };
const TEAMS: MenuItem = { to: "/teams", label: "nav.teams", icon: Building2 };
const CATEGORIES: MenuItem = { to: "/categories", label: "nav.categories", icon: FolderTree };
const SHIPPING: MenuItem = { to: "/shipping", label: "nav.shipping", icon: Truck };
const PRODUCTS: MenuItem = { to: "/products", label: "nav.products", icon: Package };
const SHOPS: MenuItem = { to: "/shops", label: "nav.shops", icon: Store };
const ORDERS: MenuItem = { to: "/orders", label: "nav.orders", icon: ShoppingCart };
// Drafts sit BESIDE Orders, never inside it (#195) — a draft was never an order, and the menu says
// so the same way the schema and the route do.
const ORDER_DRAFTS: MenuItem = { to: "/order-drafts", label: "nav.orderDrafts", icon: FileClock };
const INVENTORY: MenuItem = { to: "/inventory", label: "nav.inventory", icon: Boxes };
const REVENUE: MenuItem = { to: "/revenue", label: "nav.revenue", icon: TrendingUp };
const EXPENSES: MenuItem = { to: "/expenses", label: "nav.expenses", icon: Receipt };
const PROFIT: MenuItem = { to: "/profit", label: "nav.profit", icon: Scale };
// The ledger of what teams owe each other (#185). A TOP-LEVEL section rather than a child of the
// selling team's money group, because a WAREHOUSE team has no money section at all today and this is
// where its income actually lives.
const SETTLEMENT: MenuItem = { to: "/liability", label: "nav.settlement", icon: Handshake };
const USERS: MenuItem = { to: "/users", label: "nav.users", icon: Users };
const SETTINGS: MenuItem = { to: "/settings", label: "nav.settings", icon: Settings };
const PROFILE: MenuItem = { to: "/profile", label: "nav.profile", icon: CircleUser };

// A selling team's Products is a sub-menu (#106): "My Product" (the team's own catalogue) and
// "Discover Product" (products across ALL teams, to order from). A warehouse team keeps the flat
// Products item.
const PRODUCTS_GROUP: MenuGroup = {
  label: "nav.products",
  icon: Package,
  children: [
    { to: "/products", label: "nav.myProduct", icon: Package },
    { to: "/products/discover", label: "nav.discoverProduct", icon: Compass },
  ],
};

// Inventories is a sub-menu (#95).
//
// "Restock" is ONE entry (#122): there used to be a Restock that was really the stock list (a
// leftover of the superseded "pick a warehouse and receive there" design) plus a separate Restock
// Requests. They were the same job, so Restock is now the request flow itself, and it reads
// differently depending on who you are: a SELLING team creates requests, a WAREHOUSE team accepts
// them. The on-hand list survives under the name it actually deserves — "Stock".
//
// "Placements" is a stub until the warehouse core / locations are designed (plan.md §1).
//
// The group is BUILT PER TEAM TYPE rather than being a fixed const, because the children are not
// common to both: "Racks" (#129) and "Picking" (#151) are a warehouse's own, while "Supplier" and
// "Placements" are the requesting side's — a supplier belongs to the SELLING team that raises the
// restock, not the warehouse that fulfils it. Only "Restock" and "Stock" are shared.
function inventoriesFor(teamType: TeamType | undefined): MenuGroup {
  const children: MenuItem[] = [
    { to: "/inventories/restock", label: "nav.restock", icon: ClipboardList },
  ];

  // Supplier and Placements are dropped from the WAREHOUSE menu (#212): a warehouse does not own the
  // suppliers a selling team orders from, and Placements is a stub that only ever belonged to the
  // stock-locating side. They stay for a selling team.
  if (teamType === TeamType.SELLING) {
    children.push({ to: "/inventories/placements", label: "nav.placements", icon: MapPin });
    children.push({ to: "/inventories/suppliers", label: "nav.supplier", icon: Factory });
  }

  // Racks are the WAREHOUSE's own registry of its shelves — warehouse teams only (#129).
  if (teamType === TeamType.WAREHOUSE) {
    children.push({ to: "/inventories/racks", label: "nav.racks", icon: Grid3x3 });
  }

  // Batches — the deliveries of stock as cost layers (#209), a warehouse's own view of its inventory.
  if (teamType === TeamType.WAREHOUSE) {
    children.push({ to: "/inventories/batches", label: "nav.batches", icon: Layers });
  }

  return { label: "nav.inventories", icon: Boxes, children };
}

// menuFor picks the navigation for the CURRENT TEAM'S TYPE and the caller's role in it.
//
// ⚠ THIS IS UX, NOT SECURITY. Hiding a menu item hides nothing: the RPC behind it is still
// reachable, and the only thing that actually stops the call is the server's access interceptor.
// Never move a check from the backend into here.
export function menuFor(teamType: TeamType | undefined, role: Role | undefined): MenuEntry[] {
  const menu: MenuEntry[] = [HOME];

  if (teamType === TeamType.ROOT || teamType === TeamType.ADMIN) {
    // Teams is the single home for every team type — warehouses are the Warehouses TAB here (#59).
    menu.push(TEAMS);
    // Categories are one GLOBAL taxonomy, curated by root/admin — same gate as Teams.
    menu.push(CATEGORIES);
    // Shipping channels are one GLOBAL courier catalogue, curated by root/admin — same gate.
    menu.push(SHIPPING);
    // Stock lives at warehouses; root/admin oversee every warehouse's inventory (they pick one).
    menu.push(INVENTORY);
  }

  // A warehouse team gets a flat Products list; a selling team gets the Products sub-menu — My
  // Product + Discover Product (#106). Root/admin teams have no products of their own.
  if (teamType === TeamType.WAREHOUSE) {
    menu.push(PRODUCTS);
  }
  if (teamType === TeamType.SELLING) {
    menu.push(PRODUCTS_GROUP);
  }

  // Shops and orders are SELLING-team concepts (#66/#68).
  if (teamType === TeamType.SELLING) {
    menu.push(SHOPS);
    menu.push(ORDERS);
    menu.push(ORDER_DRAFTS);

    // Revenue is the MANAGER's view of those same orders (#78). Customer service places orders but
    // has no business reading the margin on them — which is exactly how RevenueList is scoped on the
    // server too, so this hides a link that would genuinely be refused.
    //
    // Costs (#170) sit beside it under the same gate: they are the two halves of one question, and
    // CostList is scoped to the same roles for the same reason — a person taking orders has no
    // business seeing the payroll number.
    if (isTeamManager(role)) {
      menu.push(REVENUE);
      menu.push(EXPENSES);
      // Profit is those two subtracted (#172) — the same gate, necessarily: it is made ENTIRELY of
      // the numbers on the other two screens, so anyone who may not read them may not read this.
      menu.push(PROFIT);
    }
  }

  // Liability is BACK OFFICE, and it is offered to both team types that can be a counterparty: a
  // selling team owes its warehouse, a warehouse is owed by the teams it fulfils for. isTeamManager
  // is exactly the role set the RPCs are policed on — staff and customer service never chase debt.
  if (
    (teamType === TeamType.SELLING || teamType === TeamType.WAREHOUSE) &&
    isTeamManager(role)
  ) {
    menu.push(SETTLEMENT);
  }

  // Inventories sub-menu — restock + placements — for the two team types that work with stock (#95).
  // Its children depend on the team type: a warehouse also gets Racks (#129).
  if (teamType === TeamType.WAREHOUSE || teamType === TeamType.SELLING) {
    menu.push(inventoriesFor(teamType));
  }

  // Users is offered to anyone who could plausibly manage a team's membership. The backend
  // decides for real.
  if (canManageUsers(role)) {
    menu.push(USERS);
  }

  // Team settings — the current team's picture and name (issues #43/#44). Same managers who may
  // edit the team; the backend's TeamUpdate policy is the real gate.
  if (isTeamManager(role)) {
    menu.push(SETTINGS);
  }

  menu.push(PROFILE);

  return menu;
}
