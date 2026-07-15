import type { LucideIcon } from "lucide-react";
import { Boxes, Building2, CircleUser, FolderTree, House, Package, Settings, Store, Truck, Users } from "lucide-react";
import { Role } from "../gen/warehouse/role_base/v1/role_pb";
import { TeamType } from "../gen/warehouse/team/v1/team_pb";
import { canManageUsers, isTeamManager } from "../lib/roles";

export interface MenuItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

const HOME: MenuItem = { to: "/", label: "Home", icon: House };
const TEAMS: MenuItem = { to: "/teams", label: "Teams", icon: Building2 };
const CATEGORIES: MenuItem = { to: "/categories", label: "Categories", icon: FolderTree };
const SHIPPING: MenuItem = { to: "/shipping", label: "Shipping", icon: Truck };
const PRODUCTS: MenuItem = { to: "/products", label: "Products", icon: Package };
const SHOPS: MenuItem = { to: "/shops", label: "Shops", icon: Store };
const INVENTORY: MenuItem = { to: "/inventory", label: "Inventory", icon: Boxes };
const USERS: MenuItem = { to: "/users", label: "Users", icon: Users };
const SETTINGS: MenuItem = { to: "/settings", label: "Settings", icon: Settings };
const PROFILE: MenuItem = { to: "/profile", label: "Profile", icon: CircleUser };

// menuFor picks the navigation for the CURRENT TEAM'S TYPE and the caller's role in it.
//
// ⚠ THIS IS UX, NOT SECURITY. Hiding a menu item hides nothing: the RPC behind it is still
// reachable, and the only thing that actually stops the call is the server's access interceptor.
// Never move a check from the backend into here.
export function menuFor(teamType: TeamType | undefined, role: Role | undefined): MenuItem[] {
  const menu: MenuItem[] = [HOME];

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

  // Products are a warehouse/selling team's own catalogue — the two team types that actually
  // hold stock. Root/admin teams have no products of their own.
  if (teamType === TeamType.WAREHOUSE || teamType === TeamType.SELLING) {
    menu.push(PRODUCTS);
  }

  // Shops are a SELLING team's marketplace storefronts (#66) — a selling-only concept.
  if (teamType === TeamType.SELLING) {
    menu.push(SHOPS);
  }

  // Inventory is warehouse stock — the current team IS the warehouse for its staff.
  if (teamType === TeamType.WAREHOUSE) {
    menu.push(INVENTORY);
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
