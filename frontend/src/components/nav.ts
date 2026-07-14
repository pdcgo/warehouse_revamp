import type { LucideIcon } from "lucide-react";
import { Building2, CircleUser, House, Users } from "lucide-react";
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
const USERS: MenuItem = { to: "/users", label: "Users", icon: Users };
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
  }

  // Users is offered to anyone who could plausibly manage a team's membership. The backend
  // decides for real.
  if (canManageUsers(role)) {
    menu.push(USERS);
  }

  menu.push(PROFILE);

  return menu;
}
