import type { LucideIcon } from "lucide-react";
import { Building2, CircleUser, Component, FolderTree, House, Package, Users, UsersRound, Warehouse } from "lucide-react";
import { Role } from "../gen/warehouse/role_base/v1/role_pb";
import { TeamType } from "../gen/warehouse/team/v1/team_pb";
import { canManageUsers } from "../lib/roles";

export interface MenuItem {
  to: string;
  label: string;
  icon: LucideIcon;
}

const HOME: MenuItem = { to: "/", label: "Home", icon: House };
const TEAMS: MenuItem = { to: "/teams", label: "Teams", icon: Building2 };
const WAREHOUSES: MenuItem = { to: "/warehouses", label: "Warehouses", icon: Warehouse };
const CATEGORIES: MenuItem = { to: "/categories", label: "Categories", icon: FolderTree };
const PRODUCTS: MenuItem = { to: "/products", label: "Products", icon: Package };
const USERS: MenuItem = { to: "/users", label: "Users", icon: Users };
const ALL_USERS: MenuItem = { to: "/all-users", label: "All Users", icon: UsersRound };
const COMPONENTS: MenuItem = { to: "/components", label: "Components", icon: Component };
const PROFILE: MenuItem = { to: "/profile", label: "Profile", icon: CircleUser };

// menuFor picks the navigation for the CURRENT TEAM'S TYPE and the caller's role in it.
//
// ⚠ THIS IS UX, NOT SECURITY. Hiding a menu item hides nothing: the RPC behind it is still
// reachable, and the only thing that actually stops the call is the server's access interceptor.
// Never move a check from the backend into here.
export function menuFor(teamType: TeamType | undefined, role: Role | undefined): MenuItem[] {
  const menu: MenuItem[] = [HOME];

  if (teamType === TeamType.ROOT || teamType === TeamType.ADMIN) {
    menu.push(TEAMS);
    // A warehouse is a team of type WAREHOUSE — managed by root/admin, same gate as Teams.
    menu.push(WAREHOUSES);
    // Categories are one GLOBAL taxonomy, curated by root/admin — same gate as Teams.
    menu.push(CATEGORIES);
    // Every user across every team — the root management view (issue #40). Root/admin only; the
    // team-scoped "Users" item below stays for team managers.
    menu.push(ALL_USERS);
    // The shared-components gallery is a preview/dev surface — keep it to root/admin.
    menu.push(COMPONENTS);
  }

  // Products are a warehouse/selling team's own catalogue — the two team types that actually
  // hold stock. Root/admin teams have no products of their own.
  if (teamType === TeamType.WAREHOUSE || teamType === TeamType.SELLING) {
    menu.push(PRODUCTS);
  }

  // Users is offered to anyone who could plausibly manage a team's membership. The backend
  // decides for real.
  if (canManageUsers(role)) {
    menu.push(USERS);
  }

  menu.push(PROFILE);

  return menu;
}
