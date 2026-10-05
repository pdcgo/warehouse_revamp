import { Role } from "../gen/warehouse/role_base/v1/role_pb";
import { TeamType } from "../gen/warehouse/team/v1/team_pb";

export const ROLE_LABEL: Record<number, string> = {
  [Role.UNSPECIFIED]: "-",
  [Role.ROOT]: "Root",
  // Never the bare word: `administrator` and the admin team's `admin_administrator` are one word apart
  // and worlds apart in power (the-two-administrators-have-distinct-labels).
  [Role.ADMINISTRATOR]: "System Administrator",
  [Role.SELLING_OWNER]: "Team Owner",
  [Role.SELLING_ADMIN]: "Team Admin",
  [Role.SELLING_CS]: "Customer Service",
  [Role.WAREHOUSE_OWNER]: "Warehouse Owner",
  [Role.WAREHOUSE_STAFF]: "Warehouse Staff",
  [Role.WAREHOUSE_ADMIN]: "Warehouse Admin",
  [Role.SYSTEM]: "System",
  // The admin team has roles of its own (the-admin-team-roles-are-added-first), and its Admin is never
  // the bare word either.
  [Role.ADMIN_OWNER]: "Admin Team Owner",
  [Role.ADMIN_ADMINISTRATOR]: "Admin Team Admin",
};

// A role's label. Every role now belongs to one team type, so the label no longer needs the team: the
// admin team stopped borrowing the selling pair (the-admin-team-roles-are-added-first). The parameter
// stays so callers keep passing the team where they know it.
export function roleLabel(role: Role | number | undefined, _teamType?: TeamType): string {
  return ROLE_LABEL[role ?? Role.UNSPECIFIED] ?? "Unknown";
}

// rolesFor lists the roles a team of this type HAS (every-role-has-a-code-name), highest first.
//
// It is the team's set, not what anybody may give — that is grantableRoles, below. ROOT and ADMIN
// exist only in the root team, the super-admin scope; offering them in a warehouse-team picker would
// just be a button that always errors.
export function rolesFor(teamType: TeamType | undefined): Role[] {
  switch (teamType) {
    case TeamType.WAREHOUSE:
      return [Role.WAREHOUSE_OWNER, Role.WAREHOUSE_ADMIN, Role.WAREHOUSE_STAFF];

    case TeamType.SELLING:
      return [Role.SELLING_OWNER, Role.SELLING_ADMIN, Role.SELLING_CS];

    case TeamType.ADMIN:
      return [Role.ADMIN_OWNER, Role.ADMIN_ADMINISTRATOR];

    case TeamType.ROOT:
      return [Role.ROOT, Role.ADMINISTRATOR];

    default:
      return [Role.SELLING_OWNER, Role.SELLING_ADMIN];
  }
}

// ── Who may do what to whom (docs/business/user/context_decision.md) ────────────────────────────
//
// ⚠ ALL OF IT IS UX ONLY, like every helper in this file: it decides what a screen OFFERS. The access
// interceptor and the handlers are the boundary. Until the user decisions are built the server does
// NOT check a caller's rank against the person's, so these functions are the prototype of that check.

/** How high a role stands. Inside a team: Owner > Admin > the floor role. Root and the Administrator
 *  stand above every team. */
export function roleRank(role: Role | undefined): number {
  switch (role) {
    case Role.ROOT:
      return 100;
    case Role.ADMINISTRATOR:
      return 90;
    case Role.SELLING_OWNER:
    case Role.WAREHOUSE_OWNER:
    case Role.ADMIN_OWNER:
      return 30;
    case Role.SELLING_ADMIN:
    case Role.WAREHOUSE_ADMIN:
    case Role.ADMIN_ADMINISTRATOR:
      return 20;
    case Role.SELLING_CS:
    case Role.WAREHOUSE_STAFF:
      return 10;
    default:
      return 0;
  }
}

/** Whether `role` manages the members of a team of `teamType`
 *  (the-admin-team-admin-alone-does-not-manage-members): every Owner, the warehouse and selling Admins,
 *  Root and the Administrator — not the admin team's Admin. */
export function managesMembers(role: Role | undefined, _teamType: TeamType | undefined): boolean {
  switch (role) {
    case Role.ROOT:
    case Role.ADMINISTRATOR:
    case Role.SELLING_OWNER:
    case Role.SELLING_ADMIN:
    case Role.WAREHOUSE_OWNER:
    case Role.WAREHOUSE_ADMIN:
    case Role.ADMIN_OWNER:
      return true;
    // The admin team's Admin reads the members and changes none of them. Its own role says so now,
    // so the team type is no longer needed to tell it from the selling Admin.
    case Role.ADMIN_ADMINISTRATOR:
    default:
      return false;
  }
}

/** The roles `caller` may give in a team of `teamType`:
 *  never Root (root-is-granted-only-through-san), the Administrator only by Root
 *  (root-grants-the-administrator), and otherwise only below your own (an-owner-never-makes-another-owner,
 *  no-admin-makes-another-admin). */
export function grantableRoles(teamType: TeamType | undefined, caller: Role | undefined): Role[] {
  const roles = rolesFor(teamType).filter((r) => r !== Role.ROOT);

  if (caller === Role.ROOT) return roles;
  if (caller === Role.ADMINISTRATOR) return roles.filter((r) => r !== Role.ADMINISTRATOR);
  if (!managesMembers(caller, teamType)) return [];

  return roles.filter((r) => roleRank(r) < roleRank(caller));
}

/** The role a create or add form starts on: the LOWEST on offer — the one a newcomer most often gets,
 *  and the least harm if left as is. Except in the root team, where every role on offer is a platform
 *  role: making someone the System Administrator is never a default, so the form starts empty. */
export function defaultGrant(teamType: TeamType | undefined, offered: Role[]): Role {
  if (teamType === TeamType.ROOT) return Role.UNSPECIFIED;

  return offered[offered.length - 1] ?? Role.UNSPECIFIED;
}

/** Whether `caller` may change the role of, or remove, a member holding `target`
 *  (change-role-only-below-your-own, removing-a-member-drops-their-shop-access). Nobody touches
 *  their own membership. */
export function canManageMember(args: {
  caller: Role | undefined;
  teamType: TeamType | undefined;
  target: Role | undefined;
  isSelf: boolean;
}): boolean {
  const { caller, teamType, target, isSelf } = args;

  if (isSelf) return false;
  if (target === Role.ROOT) return false;
  if (caller === Role.ROOT) return true;
  if (caller === Role.ADMINISTRATOR) return target !== Role.ADMINISTRATOR;
  if (!managesMembers(caller, teamType)) return false;

  return roleRank(target) < roleRank(caller);
}

/** Whether `caller` may suspend (or unsuspend) an account whose ROOT-TEAM role is `target`
 *  (only-root-and-the-administrator-suspend): Root suspends anyone but a Root; the Administrator
 *  anyone below Administrator; nobody suspends themselves. A team's Owner or Admin suspends nobody. */
export function canSuspendUser(args: { caller: Role | undefined; target: Role | undefined; isSelf: boolean }): boolean {
  const { caller, target, isSelf } = args;

  if (isSelf) return false;
  if (caller === Role.ROOT) return target !== Role.ROOT;
  if (caller === Role.ADMINISTRATOR) return target !== Role.ROOT && target !== Role.ADMINISTRATOR;

  return false;
}

/** Erasing is for a FORMER user — an account already suspended — by those who may suspend it
 *  (erase-keeps-the-row). */
export function canEraseUser(args: {
  caller: Role | undefined;
  target: Role | undefined;
  isSelf: boolean;
  suspended: boolean;
}): boolean {
  return args.suspended && canSuspendUser(args);
}

// canManageUsers mirrors the backend policy on CreateUser / TeamUserUpdate. (UserList also admits the
// admin team's Admin, who reads the members and manages none.)
//
// ⚠ THIS IS UX ONLY. Hiding a button hides nothing — the RPC is still reachable, and the access
// interceptor is the only real boundary. Never move a check from the backend into here.
export function canManageUsers(role: Role | undefined): boolean {
  switch (role) {
    case Role.ROOT:
    case Role.ADMINISTRATOR:
    case Role.SELLING_OWNER:
    case Role.SELLING_ADMIN:
    case Role.WAREHOUSE_OWNER:
    case Role.WAREHOUSE_ADMIN:
    case Role.ADMIN_OWNER:
      return true;

    default:
      return false;
  }
}

// isTeamManager mirrors the backend policy on TeamUpdate (change a team's name/picture): every team
// type's OWNER and ADMIN, plus global root/admin.
//
// ⚠ THIS IS UX ONLY. Hiding a control hides nothing — the RPC is still reachable, and the access
// interceptor is the only real boundary. Never move a check from the backend into here.
export function isTeamManager(role: Role | undefined): boolean {
  switch (role) {
    case Role.ROOT:
    case Role.ADMINISTRATOR:
    case Role.SELLING_OWNER:
    case Role.SELLING_ADMIN:
    case Role.WAREHOUSE_OWNER:
    case Role.WAREHOUSE_ADMIN:
    case Role.ADMIN_OWNER:
    case Role.ADMIN_ADMINISTRATOR:
      return true;

    default:
      return false;
  }
}

// canImportSettlement mirrors the policy on both settlement imports and their file list — the
// settlement write set, CS and up, since every imported row posts under the uploader's token
// (cs-and-up-import-daily).
//
// ⚠ THIS IS UX ONLY. Hiding the menu entry hides nothing — the RPC is still reachable, and the access
// interceptor is the only real boundary. Never move a check from the backend into here.
export function canImportSettlement(role: Role | undefined): boolean {
  switch (role) {
    case Role.ROOT:
    case Role.ADMINISTRATOR:
    case Role.SELLING_OWNER:
    case Role.SELLING_ADMIN:
    case Role.SELLING_CS:
      return true;

    default:
      return false;
  }
}

// canMoveAccountMoney mirrors the policy on every financial-account WRITE — create, edit, archive,
// transfer, capital, reconcile, the shop and operational links: admin and up, team or warehouse
// (seeing-is-team-wide-moving-is-admin-and-up). Seeing the accounts and their balances is every member.
//
// ⚠ THIS IS UX ONLY. Hiding a button hides nothing — the RPC is still reachable, and the access
// interceptor is the only real boundary. Never move a check from the backend into here.
export function canMoveAccountMoney(role: Role | undefined): boolean {
  // NOT isTeamManager: the admin team's roles edit their team and hold no money policy
  // (admin-team-roles-manage-only-their-team).
  return isTeamManager(role) && role !== Role.ADMIN_OWNER && role !== Role.ADMIN_ADMINISTRATOR;
}

// isGlobalAdmin: only root/admin may act outside a team (list all users, delete, suspend).
export function isGlobalAdmin(role: Role | undefined): boolean {
  return role === Role.ROOT || role === Role.ADMINISTRATOR;
}
