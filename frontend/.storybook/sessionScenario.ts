import { Role } from "../src/gen/warehouse/role_base/v1/role_pb";

// WHO is standing in front of the screen — set in a story's `beforeEach`, reset in preview.tsx.
//
// The stub's TeamAccessList answers every membership with this role, so a story can show what a team
// member WITHOUT the right sees (a CS on the accounts page: the balances, no buttons). Until this existed
// every signed-in story was a warehouse admin, and a rule like "seeing is team-wide, moving is admin and
// up" (financial_account) had only one side that could be looked at.
//
// ⚠ ITS OWN MODULE, for the reason settlementImportScenario.ts gives: a story imports it, and importing
// from stubTransport.ts would pull the whole stub into `npm run typecheck`.
export const sessionScenario = {
  role: Role.WAREHOUSE_ADMIN as Role,
  /**
   * `null` (the default) = a member of EVERY fixture team. A list = only those teams, plus the root team when
   * `role` is Root or the Administrator — someone who reaches every team without being in it
   * (the-switcher-offers-every-team). That is the only way a story can show a team you are NOT in.
   */
  memberOf: null as bigint[] | null,
};

/** What the last TeamCreate carried, so a story can assert the form sent the Owner it names. */
export const teamCreateScenario = {
  last: undefined as undefined | { name: string; ownerUserId: bigint },
};

export function resetSessionScenario() {
  sessionScenario.role = Role.WAREHOUSE_ADMIN;
  sessionScenario.memberOf = null;
  teamCreateScenario.last = undefined;
}

/** A `beforeEach`: Root or the Administrator, a member of the root team and of `memberOf` only. */
export function asPlatformOnly(role: Role, memberOf: bigint[] = []) {
  return () => {
    sessionScenario.role = role;
    sessionScenario.memberOf = memberOf;
  };
}

/** A `beforeEach` that makes the signed-in person hold `role` in every team. */
export function asRole(role: Role) {
  return () => {
    sessionScenario.role = role;
  };
}
