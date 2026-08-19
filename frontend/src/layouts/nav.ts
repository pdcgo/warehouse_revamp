import type { LucideIcon } from "lucide-react";
import {
  Boxes, Building2, CalendarRange, CircleUser, ClipboardCheck, ClipboardList, Compass, Factory, FolderTree, Grid3x3, House, Layers, MapPin, Package, Handshake, Receipt, Scale, Settings, ShoppingCart, Store, TrendingUp, Truck, Undo2, Users } from "lucide-react";
import { Role } from "../gen/warehouse/role_base/v1/role_pb";
import { TeamType } from "../gen/warehouse/team/v1/team_pb";
import { canManageUsers, isTeamManager } from "../lib/roles";

export interface MenuItem {
  to: string;
  // An i18n key (see src/i18n/locales) — the renderer translates it with t() (#97).
  label: string;
  icon: LucideIcon;
  // Other route prefixes this item OWNS without linking to. A screen reached from inside a page —
  // Drafts, a tab of Orders — is still that menu item's screen: without this it would light nothing
  // in the sidebar and leave the breadcrumb blank, which reads as having fallen out of the app.
  alsoMatches?: string[];
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

// ── Where am I? ─────────────────────────────────────────────────────────────────────────────────
//
// The route → menu matching lives HERE, beside the menu it matches against, because TWO components
// ask the question: the SIDEBAR lights an item, and the TOP BAR's breadcrumb names it. Two copies of
// a longest-prefix rule is a breadcrumb saying one screen while the sidebar highlights another — and
// that disagreement would be invisible in review, because each half looks right on its own.

// A group's children are routes too, so both answers below are computed over the FLAT list.
export function flattenMenu(menu: MenuEntry[]): MenuItem[] {
  return menu.flatMap((entry) => (isMenuGroup(entry) ? entry.children : [entry]));
}

// A true path-SEGMENT prefix test: "/products" matches "/products" and "/products/123" but NOT
// "/products-x" (a bare startsWith would). "/" only ever matches itself.
function matchesPath(to: string, pathname: string): boolean {
  if (to === "/") {
    return pathname === "/";
  }

  return pathname === to || pathname.startsWith(`${to}/`);
}

// An item matches its own route, and any route it has CLAIMED without linking to (`alsoMatches`).
function matchesItem(item: MenuItem, pathname: string): boolean {
  return (
    matchesPath(item.to, pathname) ||
    (item.alsoMatches?.some((claimed) => matchesPath(claimed, pathname)) ?? false)
  );
}

// THE ACTIVE ROUTE IS THE LONGEST MATCHING PREFIX — so on /products/discover only "Discover Product"
// lights up, not "My Product" too, while a detail route like /products/123 still lights its parent
// "My Product" (#119). One winner, never a whole sub-menu at once.
export function activeRoute(menu: MenuEntry[], pathname: string): string | undefined {
  return flattenMenu(menu)
    .filter((item) => matchesItem(item, pathname))
    .sort((a, b) => b.to.length - a.to.length)[0]?.to;
}

// The active item's label (an i18n key) — what the breadcrumb says you are looking at.
export function activeLabel(menu: MenuEntry[], pathname: string): string {
  const to = activeRoute(menu, pathname);

  return flattenMenu(menu).find((item) => item.to === to)?.label ?? "";
}

// The group the active route lives in, if any — the one the sidebar must open so the highlighted
// item is not hidden inside a shut drawer.
export function owningGroupLabel(menu: MenuEntry[], activeTo: string | undefined): string | undefined {
  const group = menu.find(
    (entry) => isMenuGroup(entry) && entry.children.some((child) => child.to === activeTo),
  );

  return group && isMenuGroup(group) ? group.label : undefined;
}

const HOME: MenuItem = { to: "/", label: "nav.home", icon: House };
const TEAMS: MenuItem = { to: "/teams", label: "nav.teams", icon: Building2 };
const CATEGORIES: MenuItem = { to: "/categories", label: "nav.categories", icon: FolderTree };
const SHIPPING: MenuItem = { to: "/shipping", label: "nav.shipping", icon: Truck };
const PRODUCTS: MenuItem = { to: "/products", label: "nav.products", icon: Package };
const SHOPS: MenuItem = { to: "/shops", label: "nav.shops", icon: Store };
// Orders, and DRAFTS IS INSIDE IT — a tab on that screen rather than a menu item of its own (owner).
//
// It used to sit beside this one, on the argument that a draft was never an order. That is still
// true of the schema and the route, and neither changed; what was wrong was the MENU. Nobody goes
// looking for "drafts" — they go looking for the order they were half-way through, and that search
// starts at Orders. A second top-level item made the sidebar answer a question about our tables.
const ORDERS: MenuItem = {
  to: "/orders",
  label: "nav.orders",
  icon: ShoppingCart,
  // The drafts screen keeps its own route, so Orders has to claim it — otherwise standing on Drafts
  // highlights nothing and the breadcrumb goes blank.
  alsoMatches: ["/order-drafts"],
};

// The WAREHOUSE's Orders — the orders shipping FROM this building (#151), which is the work its crew
// walks, boxes and hands to a courier.
//
// It carries the SAME LABEL as the selling team's Orders above, deliberately: it is the same subject
// read from the other end. `OrderList` is one RPC that matches EITHER side of an order, so a warehouse
// passing its own team id is asking the warehouse's half of the same question — and calling the menu
// item anything else would make the crew learn a second word for the thing in front of them.
//
// A DIFFERENT ROUTE, though, because it is a different screen: /orders is the selling team's list, with
// its shops, its money and its New Order button, none of which a warehouse has. /orders/:orderId stays
// shared — the crew that shipped an order can open it and read what it was.
const WAREHOUSE_ORDERS: MenuItem = {
  to: "/warehouse-orders",
  label: "nav.orders",
  icon: ShoppingCart,
};
const INVENTORY: MenuItem = { to: "/inventory", label: "nav.inventory", icon: Boxes };
const REVENUE: MenuItem = { to: "/revenue", label: "nav.revenue", icon: TrendingUp };
const EXPENSES: MenuItem = { to: "/expenses", label: "nav.expenses", icon: Receipt };
const PROFIT: MenuItem = { to: "/profit", label: "nav.profit", icon: Scale };
// The same money as Revenue, Expenses and Profit — read DAY BY DAY rather than as a month total.
// A separate item rather than a tab on Profit: it answers a different question ("which day did it"),
// it carries its own range control instead of a month picker, and somebody comes looking for it by
// name the moment a month reads wrong.
const STATEMENT: MenuItem = { to: "/statement", label: "nav.statement", icon: CalendarRange };
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
// common to both: "Racks" (#129) is a warehouse's own, while "Supplier" and "Placements" are the
// requesting side's — a supplier belongs to the SELLING team that raises the restock, not the
// warehouse that fulfils it. Only "Restock" and "Stock" are shared.
//
// ⚠ The warehouse's ORDER QUEUE is NOT in here. It was briefly, as "Picking", and that was wrong on
// both counts (owner): the screen is a list of ORDERS, so it says Orders, and orders are not a kind
// of inventory — they are the work that consumes it. It is a TOP-LEVEL item, see menuFor below.
function inventoriesFor(teamType: TeamType | undefined): MenuGroup {
  const children: MenuItem[] = [
    { to: "/inventories/restock", label: "nav.restock", icon: ClipboardList },
  ];

  // Returns sit directly UNDER Restock — a return is a restock's mirror image (#163), goods arriving
  // to be counted, placed, and partly written off. A warehouse's own concern, so warehouse teams only.
  if (teamType === TeamType.WAREHOUSE) {
    children.push({ to: "/inventories/returns", label: "nav.returns", icon: Undo2 });
  }

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

  // Opname — a physical stock count reconciled against the system (stock-take). A warehouse's own job.
  if (teamType === TeamType.WAREHOUSE) {
    children.push({ to: "/inventories/opname", label: "nav.opname", icon: ClipboardCheck });
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
    // Orders sits HIGH and TOP-LEVEL for a warehouse, because it is the day's work rather than a
    // reference screen: the crew opens it first and returns to it after every order. Below Products
    // so the catalogue still reads as the subject and the orders as what is happening to it.
    menu.push(WAREHOUSE_ORDERS);
  }
  if (teamType === TeamType.SELLING) {
    menu.push(PRODUCTS_GROUP);
    // Inventories sits DIRECTLY under Products for a selling team, because for that team the two are
    // one subject read in one sitting: the product list now shows the stock behind each row (ready,
    // ongoing, oldest batch), and every answer to "why is this empty" — the restock, the placement,
    // the supplier — is in this menu. Leaving it below the money section made a person cross the
    // whole sidebar to follow a question they were already asking.
    //
    // A WAREHOUSE keeps it further down (see below): stock is not a footnote to a catalogue there,
    // it is the job, and its Inventories group holds different children.
    menu.push(inventoriesFor(teamType));
  }

  // Shops and orders are SELLING-team concepts (#66/#68).
  if (teamType === TeamType.SELLING) {
    menu.push(SHOPS);
    menu.push(ORDERS);

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
      // The daily statement is those same two numbers, per day — so necessarily the same gate. It is
      // made ENTIRELY of what the three screens above hold, and both its RPCs are policed on exactly
      // this role set, so a looser menu here would offer a link the server refuses.
      menu.push(STATEMENT);
    }
  }

  // A WAREHOUSE gets the daily statement too (owner, 2026-08-14), even though it has none of the three
  // money screens above.
  //
  // It reads a DIFFERENT income column — the handling fees it charged, from settlement_service, because
  // a warehouse has no orders and therefore no margin. Its costs are its own expenses, and those already
  // include the stock it writes off (#211), which is the number a warehouse actually runs on.
  //
  // No Revenue / Expenses / Profit item beside it, deliberately: Revenue would be permanently empty, and
  // Profit is the selling-team subtraction. The statement IS the warehouse's money screen.
  if (teamType === TeamType.WAREHOUSE && isTeamManager(role)) {
    menu.push(STATEMENT);
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

  // Inventories sub-menu — restock, racks, batches, opname — for a WAREHOUSE (#95). A selling team
  // has already had its own (differently populated) Inventories group pushed directly under Products
  // above, which is where that team reads it from.
  if (teamType === TeamType.WAREHOUSE) {
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

// ── The mobile bottom bar ───────────────────────────────────────────────────────────────────────
//
// THREE destinations plus "More", and the three are a DECISION, not the first three menu entries.
// A bottom bar is the only navigation a thumb reaches without a second tap, so it holds the screens
// a person returns to all day — the rest of the menu is one tap away in the More sheet, which is
// where a reference screen (Categories, Shipping, Settings) belongs.
//
// ⚠ IT IS FILTERED AGAINST THE REAL MENU, never listed independently. A tab whose route the current
// team's menu does not contain is a tab offering work this team does not do — and the role gates in
// menuFor are exactly the kind of thing a hand-kept second list stops honouring.
//
// The LABEL is the bar's own, though: a selling team's "/products" is the group child "My Product",
// and a tab that narrow reads as a different screen from the Products the sidebar shows.
function bottomBarCandidates(teamType: TeamType | undefined): MenuItem[] {
  switch (teamType) {
    // A warehouse crew's day: the orders to pack, and the stock arriving to be counted.
    case TeamType.WAREHOUSE:
      return [
        HOME,
        WAREHOUSE_ORDERS,
        { to: "/inventories/restock", label: "nav.restock", icon: ClipboardList },
      ];
    // A selling team's: the orders they are taking, and the catalogue they take them from.
    case TeamType.SELLING:
      return [HOME, ORDERS, PRODUCTS];
    // Root/admin oversee — the teams, and the stock those teams hold.
    case TeamType.ROOT:
    case TeamType.ADMIN:
      return [HOME, TEAMS, INVENTORY];
    default:
      return [HOME];
  }
}

// The bottom bar for the current team — at most three items, every one of them in this team's menu.
export function bottomBarFor(teamType: TeamType | undefined, role: Role | undefined): MenuItem[] {
  const routes = new Set(flattenMenu(menuFor(teamType, role)).map((item) => item.to));

  return bottomBarCandidates(teamType).filter((item) => routes.has(item.to));
}
