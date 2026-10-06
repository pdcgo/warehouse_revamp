// The user service as Storybook's stub — docs/business/user/context_decision.md.
//
// It plays the DECIDED rules, which the server now enforces too. Every refusal names its decision, so a story
// fails when a screen offers something the rules forbid.
//
// ⚠ THE RULES ARE WRITTEN HERE IN THEIR OWN TERMS, never imported from src/lib/roles.ts. The screen
// decides what to OFFER from those helpers; this decides what to ACCEPT. Sharing one copy would make
// the two agree by construction, and a wrong helper would pass every story.
//
// WRITEABLE: a role changed in one step shows in the table and in the history in the next. Module state
// survives between stories in one tab — preview.tsx calls `resetUserStub()` in its `beforeEach`.

import { Code, ConnectError } from "@connectrpc/connect";

import { Role } from "../src/gen/warehouse/role_base/v1/role_pb";
import { TeamType } from "../src/gen/warehouse/team/v1/team_pb";
import { TeamMemberLogAction, UserListDataType } from "../src/gen/warehouse/user/v1/user_pb";
import { teams, users as userFixtures } from "./fixtures";
import { sessionScenario } from "./sessionScenario";

// ── The tables ──────────────────────────────────────────────────────────────────────────────────

type StubUser = (typeof userFixtures)[number];

type StubLog = {
  id: bigint;
  teamId: bigint;
  actorUserId: bigint;
  actorAgent: string;
  userId: bigint;
  action: TeamMemberLogAction;
  roleBefore: Role;
  roleAfter: Role;
  isOverride: boolean;
  createdAtUnix: bigint;
};

/** The person in front of the screen — the AuthService stub's identity. */
export const SELF_ID = userFixtures[0]!.id;

/** The root team, as the Users page's all view addresses it (team_id = 0). */
const ROOT_TEAM = 0n;

// Who holds what, per team. The signed-in person is NOT here: they hold `sessionScenario.role` in every
// team, and in the root team only when that role is Root or the Administrator — see `rolesIn`.
const BASE_MEMBERS: [team: bigint, user: bigint, role: Role][] = [
  [11n, 64n, Role.WAREHOUSE_OWNER],
  [11n, 62n, Role.WAREHOUSE_ADMIN],
  [11n, 65n, Role.WAREHOUSE_STAFF],
  [11n, 63n, Role.WAREHOUSE_STAFF],
  [12n, 64n, Role.SELLING_OWNER],
  [12n, 62n, Role.SELLING_ADMIN],
  [12n, 65n, Role.SELLING_CS],
  [12n, 63n, Role.SELLING_CS],
  [ROOT_TEAM, 66n, Role.ROOT],
  [ROOT_TEAM, 67n, Role.ADMINISTRATOR],
];

const DAY = 86_400n;
const NOW = 1_790_000_000n;

// Gudang Pusat's history, oldest first: made by `san`, then grown by its Owner and Admin, then one change
// by a Root who is not in the team — the override every service stamps (an-override-is-stamped-in-every-service).
const BASE_LOG: Omit<StubLog, "id">[] = [
  { teamId: 11n, actorUserId: 0n, actorAgent: "san", userId: 64n, action: TeamMemberLogAction.ADD, roleBefore: Role.UNSPECIFIED, roleAfter: Role.WAREHOUSE_OWNER, isOverride: false, createdAtUnix: NOW - 30n * DAY },
  { teamId: 11n, actorUserId: 64n, actorAgent: "", userId: 62n, action: TeamMemberLogAction.ADD, roleBefore: Role.UNSPECIFIED, roleAfter: Role.WAREHOUSE_STAFF, isOverride: false, createdAtUnix: NOW - 20n * DAY },
  { teamId: 11n, actorUserId: 64n, actorAgent: "", userId: 62n, action: TeamMemberLogAction.CHANGE_ROLE, roleBefore: Role.WAREHOUSE_STAFF, roleAfter: Role.WAREHOUSE_ADMIN, isOverride: false, createdAtUnix: NOW - 12n * DAY },
  { teamId: 11n, actorUserId: 62n, actorAgent: "", userId: 65n, action: TeamMemberLogAction.ADD, roleBefore: Role.UNSPECIFIED, roleAfter: Role.WAREHOUSE_STAFF, isOverride: false, createdAtUnix: NOW - 9n * DAY },
  { teamId: 11n, actorUserId: 62n, actorAgent: "", userId: 63n, action: TeamMemberLogAction.ADD, roleBefore: Role.UNSPECIFIED, roleAfter: Role.WAREHOUSE_STAFF, isOverride: false, createdAtUnix: NOW - 5n * DAY },
  { teamId: 11n, actorUserId: 66n, actorAgent: "", userId: 69n, action: TeamMemberLogAction.REMOVE, roleBefore: Role.WAREHOUSE_STAFF, roleAfter: Role.UNSPECIFIED, isOverride: true, createdAtUnix: NOW - 2n * DAY },
];

let people: StubUser[] = [];
let members = new Map<bigint, Map<bigint, Role>>();
let log: StubLog[] = [];
let nextUserId = 100n;
let nextLogId = 1n;
let clock = NOW;

export function resetUserStub() {
  people = userFixtures.map((u) => ({ ...u }));

  members = new Map();
  for (const [team, user, role] of BASE_MEMBERS) {
    if (!members.has(team)) members.set(team, new Map());
    members.get(team)!.set(user, role);
  }

  nextLogId = 1n;
  log = BASE_LOG.map((e) => ({ ...e, id: nextLogId++ }));
  nextUserId = 100n;
  clock = NOW;
}

resetUserStub();

// ── The rules, in their own terms ───────────────────────────────────────────────────────────────

const RANK: Partial<Record<Role, number>> = {
  [Role.ROOT]: 100,
  [Role.ADMINISTRATOR]: 90,
  [Role.SELLING_OWNER]: 30,
  [Role.WAREHOUSE_OWNER]: 30,
  [Role.ADMIN_OWNER]: 30,
  [Role.SELLING_ADMIN]: 20,
  [Role.WAREHOUSE_ADMIN]: 20,
  [Role.ADMIN_ADMINISTRATOR]: 20,
  [Role.SELLING_CS]: 10,
  [Role.WAREHOUSE_STAFF]: 10,
};

const rank = (r: Role | undefined) => (r === undefined ? 0 : (RANK[r] ?? 0));
const isPlatform = (r: Role | undefined) => r === Role.ROOT || r === Role.ADMINISTRATOR;

function teamTypeOf(teamId: bigint): TeamType | undefined {
  return teamId === ROOT_TEAM ? TeamType.ROOT : teams.find((t) => t.id === teamId)?.type;
}

/** Each member's role in `teamId`, the signed-in person included. */
function rolesIn(teamId: bigint): Map<bigint, Role> {
  const out = new Map(members.get(teamId) ?? []);
  const caller = sessionScenario.role;

  if (teamId !== ROOT_TEAM || isPlatform(caller)) {
    out.set(SELF_ID, caller);
  }

  return out;
}

// the-admin-team-admin-alone-does-not-manage-members — every Owner, the warehouse and selling Admins,
// Root and the Administrator. The admin team's Admin has its own role now, so the team type is not needed.
function managesMembers(caller: Role, _teamType: TeamType | undefined): boolean {
  if (isPlatform(caller)) return true;

  return (
    caller === Role.SELLING_OWNER ||
    caller === Role.SELLING_ADMIN ||
    caller === Role.WAREHOUSE_OWNER ||
    caller === Role.WAREHOUSE_ADMIN ||
    caller === Role.ADMIN_OWNER
  );
}

function refuse(code: Code, decision: string, what: string): never {
  throw new ConnectError(`${what} (${decision})`, code);
}

// May `caller` move someone holding `target` to `next` (undefined = remove them)?
function checkMemberWrite(teamId: bigint, userId: bigint, next: Role | undefined) {
  const caller = sessionScenario.role;
  const target = rolesIn(teamId).get(userId);

  if (!managesMembers(caller, teamTypeOf(teamId))) {
    refuse(Code.PermissionDenied, "only-member-managers-open-the-search", "you do not manage this team's members");
  }
  if (userId === SELF_ID) {
    refuse(Code.PermissionDenied, "change-role-only-below-your-own", "nobody changes their own membership");
  }
  if (next === Role.ROOT) {
    refuse(Code.PermissionDenied, "root-is-granted-only-through-san", "Root is never given from the screen");
  }
  if (target === Role.ROOT) {
    refuse(Code.PermissionDenied, "root-can-be-several", "a Root's membership is changed through san only");
  }

  if (caller === Role.ROOT) return;

  if (caller === Role.ADMINISTRATOR) {
    if (target === Role.ADMINISTRATOR || next === Role.ADMINISTRATOR) {
      refuse(Code.PermissionDenied, "root-grants-the-administrator", "only Root gives or takes the Administrator");
    }
    return;
  }

  if (rank(target) >= rank(caller) || (next !== undefined && rank(next) >= rank(caller))) {
    refuse(Code.PermissionDenied, "change-role-only-below-your-own", "only a role below your own");
  }
}

// only-root-and-the-administrator-suspend — refused by the target's ROOT-TEAM role, never by its id.
function checkAccountWrite(userId: bigint) {
  const caller = sessionScenario.role;
  const target = rolesIn(ROOT_TEAM).get(userId);

  if (userId === SELF_ID) {
    refuse(Code.PermissionDenied, "only-root-and-the-administrator-suspend", "nobody suspends themselves");
  }
  if (caller === Role.ROOT && target !== Role.ROOT) return;
  if (caller === Role.ADMINISTRATOR && !isPlatform(target)) return;

  refuse(Code.PermissionDenied, "only-root-and-the-administrator-suspend", "you may not suspend this account");
}

function record(teamId: bigint, userId: bigint, action: TeamMemberLogAction, before: Role, after: Role) {
  clock += 60n;
  log.push({
    id: nextLogId++,
    teamId,
    actorUserId: SELF_ID,
    actorAgent: "",
    userId,
    action,
    roleBefore: before,
    roleAfter: after,
    // Root and the Administrator act in a team they are not a member of (an-override-is-stamped-in-every-service).
    isOverride: isPlatform(sessionScenario.role),
    createdAtUnix: clock,
  });
}

// ── The search ──────────────────────────────────────────────────────────────────────────────────

// A phone matches however it is written: 0812…, +62 812…, 62-812… are one number (Q20d) — the server's
// user_phone_key: the digits, a leading 0 read as Indonesia's 62.
const normalisePhone = (p: string) => {
  const digits = p.replace(/\D/g, "");

  return digits.startsWith("0") ? "62" + digits.slice(1) : digits;
};

// The one stored form of a phone (a-phone-is-saved-in-international-form), refused when it is not a phone
// (a-phone-has-8-to-15-digits, a-phone-starts-with-0-or-a-country-code) — in the stub's own terms.
function storedPhone(typed: string): string {
  const t = typed.trim();
  if (t === "") return "";

  if (!/^\+?[0-9 ().-]+$/.test(t)) {
    refuse(Code.InvalidArgument, "a-phone-has-8-to-15-digits", "a phone is digits, with spaces, dashes, dots or brackets, and a + only at the start");
  }

  const d = t.replace(/\D/g, "");
  if (d.length < 8 || d.length > 15) refuse(Code.InvalidArgument, "a-phone-has-8-to-15-digits", "a phone has 8 to 15 digits");

  let out = "";
  if (t.startsWith("+") && !d.startsWith("0")) out = "+" + d;
  else if (!t.startsWith("+") && d.startsWith("0")) out = "+62" + d.slice(1);
  else if (!t.startsWith("+") && d.startsWith("62")) out = "+" + d;
  else refuse(Code.InvalidArgument, "a-phone-starts-with-0-or-a-country-code", "start with 0, or with + and the country code");

  if (out.length - 1 > 15) refuse(Code.InvalidArgument, "a-phone-has-8-to-15-digits", "a phone has 8 to 15 digits with its country code");

  return out;
}

// a-phone-or-email-belongs-to-one-account — on another account than `self`; the phone is checked first, as on the server.
function refuseTaken(phone: string, email: string, self?: bigint) {
  const others = people.filter((u) => u.id !== self);

  if (phone !== "" && others.some((u) => u.phoneNumber !== "" && normalisePhone(u.phoneNumber) === normalisePhone(phone))) {
    refuse(Code.AlreadyExists, "a-phone-or-email-belongs-to-one-account", "that phone number is already another account's — add that person instead");
  }
  if (email !== "" && others.some((u) => u.email.toLowerCase() === email.toLowerCase())) {
    refuse(Code.AlreadyExists, "a-phone-or-email-belongs-to-one-account", "that email is already another account's — add that person instead");
  }
}

const contains = (q: string, ...fields: string[]) => fields.some((f) => f.toLowerCase().includes(q));

// What anyone signed in may read of a person: no email, no phone. Suspension is on it, for a who filter's badge.
function publicOf(u: StubUser) {
  return {
    id: u.id,
    username: u.username,
    name: u.name,
    avatarUrl: u.avatarUrl,
    isSuspended: u.isSuspended,
  };
}

// a-result-shows-the-phones-last-four-digits — the search alone adds them, and not when four digits are the whole number.
function lastFour(phone: string) {
  const digits = phone.replace(/\D/g, "");

  return digits.length > 4 ? digits.slice(-4) : "";
}

function paged<T>(rows: T[], page: { page?: bigint; limit?: bigint } | undefined) {
  const limit = Number(page?.limit ?? 20n) || 20;
  const current = Number(page?.page ?? 1n) || 1;

  return {
    window: rows.slice((current - 1) * limit, current * limit),
    pageInfo: { currentPage: current, totalPage: Math.max(1, Math.ceil(rows.length / limit)), totalItems: BigInt(rows.length) },
  };
}

// ── The service ─────────────────────────────────────────────────────────────────────────────────

type ListReq = {
  teamId: bigint;
  filter?: { q?: string };
  dataRequest: UserListDataType[];
  page?: { page?: bigint; limit?: bigint };
};

export const userStub = {
  // A team's members; at team 0, everyone — with each one's role in the scoped team when asked for
  // the MEMBERSHIP slice, which is what lets a row say who may act on whom.
  userList: (req: ListReq) => {
    const roles = rolesIn(req.teamId);
    const q = (req.filter?.q ?? "").trim().toLowerCase();

    const rows = people.filter(
      (u) => (req.teamId === ROOT_TEAM || roles.has(u.id)) && contains(q, u.name, u.username, u.email),
    );
    const { window, pageInfo } = paged(rows, req.page);
    const types = req.dataRequest.length > 0 ? req.dataRequest : [UserListDataType.USER];

    const items = [];
    if (types.includes(UserListDataType.USER)) {
      items.push({ d: { case: "user" as const, value: { mapData: Object.fromEntries(window.map((u) => [u.id.toString(), u])) } } });
    }
    if (types.includes(UserListDataType.MEMBERSHIP)) {
      const mapData = Object.fromEntries(
        window.filter((u) => roles.has(u.id)).map((u) => [u.id.toString(), { role: roles.get(u.id)!, alias: "" }]),
      );
      items.push({ d: { case: "membership" as const, value: { mapData } } });
    }

    return { items, ids: window.map((u) => u.id), pageInfo };
  },

  userByIDs: (req: { filter?: { ids?: bigint[] } }) => {
    const items: Record<string, { items: { d: { case: "publicUser"; value: { mapData: Record<string, ReturnType<typeof publicOf>> } } }[] }> = {};

    for (const id of req.filter?.ids ?? []) {
      const u = people.find((p) => p.id === id);
      if (!u) continue; // an unknown id is ABSENT — never a null row

      items[id.toString()] = { items: [{ d: { case: "publicUser", value: { mapData: { [id.toString()]: publicOf(u) } } } }] };
    }

    return { items };
  },

  // The Add Member popup's search, and Create Team's Owner picker at team 0 (the root team): managers only, exact
  // for an Owner or an Admin, broad for Root and the Administrator, suspended accounts left out, and who is already
  // in the team said.
  searchUser: (req: { q: string; limit: number; teamId: bigint }) => {
    const q = req.q.trim().toLowerCase();
    const limit = req.limit || 10;

    const caller = sessionScenario.role;
    const allowed = req.teamId === ROOT_TEAM ? isPlatform(caller) : managesMembers(caller, teamTypeOf(req.teamId));
    if (!allowed) {
      refuse(Code.PermissionDenied, "only-member-managers-open-the-search", "you do not manage this team's members");
    }

    const broad = isPlatform(caller);
    const found = people
      .filter((u) => !u.isSuspended) // a-suspended-user-is-never-picked
      .filter((u) =>
        broad
          ? contains(q, u.name, u.username)
          : u.username === q || u.email.toLowerCase() === q || (u.phoneNumber !== "" && normalisePhone(u.phoneNumber) === normalisePhone(q)),
      )
      .slice(0, limit);

    const roles = req.teamId === ROOT_TEAM ? new Map<bigint, Role>() : rolesIn(req.teamId);
    const rolesInTeam = Object.fromEntries(found.filter((u) => roles.has(u.id)).map((u) => [u.id.toString(), roles.get(u.id)!]));

    return { users: found.map((u) => ({ ...publicOf(u), phoneLast4: lastFour(u.phoneNumber) })), rolesInTeam };
  },

  teamUserUpdate: (req: {
    teamId: bigint;
    action: { case: "add"; value: { userId: bigint; role: Role } } | { case: "remove"; value: { userId: bigint } } | { case: undefined };
  }) => {
    const { teamId, action } = req;
    if (action.case === undefined) refuse(Code.InvalidArgument, "an-existing-member-gets-change-role", "no action");

    const before = rolesIn(teamId).get(action.value.userId);

    if (action.case === "add") {
      checkMemberWrite(teamId, action.value.userId, action.value.role);
      if (!members.has(teamId)) members.set(teamId, new Map());
      members.get(teamId)!.set(action.value.userId, action.value.role);

      // Every change is a row (every-role-change-is-logged); re-giving the same role changes nothing.
      if (before !== action.value.role) {
        record(
          teamId,
          action.value.userId,
          before === undefined ? TeamMemberLogAction.ADD : TeamMemberLogAction.CHANGE_ROLE,
          before ?? Role.UNSPECIFIED,
          action.value.role,
        );
      }
    } else {
      checkMemberWrite(teamId, action.value.userId, undefined);
      members.get(teamId)?.delete(action.value.userId);
      record(teamId, action.value.userId, TeamMemberLogAction.REMOVE, before ?? Role.UNSPECIFIED, Role.UNSPECIFIED);
    }

    return {};
  },

  createUser: (req: {
    teamId: bigint;
    username: string;
    password: string;
    name: string;
    email: string;
    phoneNumber: string;
    role: Role;
  }) => {
    if (people.some((u) => u.username === req.username)) {
      refuse(Code.AlreadyExists, "the-username-is-editable", `the username ${req.username} is taken`);
    }
    const phone = storedPhone(req.phoneNumber);
    refuseTaken(phone, req.email);

    const id = nextUserId++;
    checkMemberWrite(req.teamId, id, req.role);

    const user = {
      id,
      username: req.username,
      name: req.name,
      email: req.email,
      phoneNumber: phone,
      isSuspended: false,
      avatarUrl: "",
    };
    people.push(user);
    if (!members.has(req.teamId)) members.set(req.teamId, new Map());
    members.get(req.teamId)!.set(id, req.role);
    record(req.teamId, id, TeamMemberLogAction.ADD, Role.UNSPECIFIED, req.role);

    return { user };
  },

  updateUser: (req: { userId: bigint; username?: string; name?: string; email?: string; phoneNumber?: string }) => {
    const u = people.find((p) => p.id === req.userId);
    if (!u) refuse(Code.NotFound, "a-user-is-never-deleted", "no such user");

    if (req.username !== undefined && req.username !== u.username) {
      // the-username-is-editable — a taken one is refused
      if (people.some((p) => p.username === req.username)) {
        refuse(Code.AlreadyExists, "the-username-is-editable", `the username ${req.username} is taken`);
      }
      u.username = req.username;
    }
    const phone = req.phoneNumber !== undefined ? storedPhone(req.phoneNumber) : undefined;
    refuseTaken(phone ?? "", req.email ?? "", u.id);

    if (req.name !== undefined) u.name = req.name;
    if (req.email !== undefined) u.email = req.email;
    if (phone !== undefined) u.phoneNumber = phone;

    return { user: u };
  },

  updateProfile: (req: { name?: string; email?: string; phoneNumber?: string }) => userStub.updateUser({ ...req, userId: SELF_ID }),

  suspendUser: (req: { userId: bigint; suspended: boolean }) => {
    checkAccountWrite(req.userId);
    const u = people.find((p) => p.id === req.userId);
    if (u) u.isSuspended = req.suspended;

    return {};
  },

  // erase-keeps-the-row: a suspended account's personal data blanked, the row and the id kept.
  userErase: (req: { userId: bigint }) => {
    checkAccountWrite(req.userId);
    const u = people.find((p) => p.id === req.userId);
    if (!u) refuse(Code.NotFound, "erase-keeps-the-row", "no such user");
    if (!u.isSuspended) refuse(Code.FailedPrecondition, "erase-keeps-the-row", "suspend the account first");

    Object.assign(u, { username: `erased${u.id}`, name: "", email: "", phoneNumber: "", avatarUrl: "" });

    return {};
  },

  adminResetPassword: () => ({}),

  teamMemberLogList: (req: { teamId: bigint; page?: { page?: bigint; limit?: bigint } }) => {
    const rows = log.filter((e) => e.teamId === req.teamId).reverse(); // newest first
    const { window, pageInfo } = paged(rows, req.page);

    return {
      items: [{ d: { case: "entry" as const, value: { mapData: Object.fromEntries(window.map((e) => [e.id.toString(), e])) } } }],
      ids: window.map((e) => e.id),
      pageInfo,
    };
  },
};
