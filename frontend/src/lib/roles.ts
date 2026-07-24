import { Role } from "../gen/warehouse/role_base/v1/role_pb";
import { TeamType } from "../gen/warehouse/team/v1/team_pb";

export const ROLE_LABEL: Record<number, string> = {
  [Role.UNSPECIFIED]: "-",
  [Role.ROOT]: "Root",
  [Role.ADMIN]: "Admin",
  [Role.TEAM_OWNER]: "Team Owner",
  [Role.TEAM_ADMIN]: "Team Admin",
  [Role.TEAM_CUSTOMER_SERVICE]: "Customer Service",
  [Role.WAREHOUSE_OWNER]: "Warehouse Owner",
  [Role.WAREHOUSE_STAFF]: "Warehouse Staff",
  [Role.WAREHOUSE_ADMIN]: "Warehouse Admin",
  [Role.SYSTEM]: "System",
};

export function roleLabel(role: Role | number | undefined): string {
  return ROLE_LABEL[role ?? Role.UNSPECIFIED] ?? "Unknown";
}

// rolesFor lists the roles that make sense INSIDE a team of this type.
//
// ROOT and ADMIN are absent on purpose: they are only meaningful in the root team (the
// super-admin scope), and the backend refuses to grant them anywhere else. Offering them in a
// warehouse-team picker would just be a button that always errors.
export function rolesFor(teamType: TeamType | undefined): Role[] {
  switch (teamType) {
    case TeamType.WAREHOUSE:
      return [Role.WAREHOUSE_OWNER, Role.WAREHOUSE_ADMIN, Role.WAREHOUSE_STAFF];

    case TeamType.SELLING:
      return [Role.TEAM_OWNER, Role.TEAM_ADMIN, Role.TEAM_CUSTOMER_SERVICE];

    case TeamType.ADMIN:
    case TeamType.ROOT:
      return [Role.ROOT, Role.ADMIN, Role.TEAM_OWNER, Role.TEAM_ADMIN];

    default:
      return [Role.TEAM_OWNER, Role.TEAM_ADMIN];
  }
}

// canManageUsers mirrors the backend policy on CreateUser / UserList / TeamUserUpdate.
//
// ⚠ THIS IS UX ONLY. Hiding a button hides nothing — the RPC is still reachable, and the access
// interceptor is the only real boundary. Never move a check from the backend into here.
export function canManageUsers(role: Role | undefined): boolean {
  switch (role) {
    case Role.ROOT:
    case Role.ADMIN:
    case Role.TEAM_OWNER:
    case Role.TEAM_ADMIN:
    case Role.WAREHOUSE_OWNER:
    case Role.WAREHOUSE_ADMIN:
      return true;

    default:
      return false;
  }
}

// isTeamManager mirrors the backend policy on TeamUpdate (change a team's name/picture): the team
// and warehouse OWNER/ADMIN roles, plus global root/admin.
//
// ⚠ THIS IS UX ONLY. Hiding a control hides nothing — the RPC is still reachable, and the access
// interceptor is the only real boundary. Never move a check from the backend into here.
export function isTeamManager(role: Role | undefined): boolean {
  switch (role) {
    case Role.ROOT:
    case Role.ADMIN:
    case Role.TEAM_OWNER:
    case Role.TEAM_ADMIN:
    case Role.WAREHOUSE_OWNER:
    case Role.WAREHOUSE_ADMIN:
      return true;

    default:
      return false;
  }
}

// isGlobalAdmin: only root/admin may act outside a team (list all users, delete, suspend).
export function isGlobalAdmin(role: Role | undefined): boolean {
  return role === Role.ROOT || role === Role.ADMIN;
}
