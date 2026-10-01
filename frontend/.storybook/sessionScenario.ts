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
};

export function resetSessionScenario() {
  sessionScenario.role = Role.WAREHOUSE_ADMIN;
}

/** A `beforeEach` that makes the signed-in person hold `role` in every team. */
export function asRole(role: Role) {
  return () => {
    sessionScenario.role = role;
  };
}
