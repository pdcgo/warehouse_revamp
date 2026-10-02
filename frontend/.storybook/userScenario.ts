// What a story can make the stub user service say — set in a story's `beforeEach`, cleared by
// `resetUserStub` in preview.tsx.
//
// ⚠ ITS OWN MODULE, for the reason settlementImportScenario.ts gives: a story imports these switches,
// and importing them from the stub would pull the whole stub into `npm run typecheck`.
export const userScenario = {
  // TeamMemberLogList answers Unimplemented — what the running app says until the log table exists.
  memberLogNotBuilt: false,
};

export function resetUserScenario() {
  userScenario.memberLogNotBuilt = false;
}

/** A `beforeEach` that makes the membership history answer "not built yet", as the real server does. */
export function memberLogNotBuilt() {
  userScenario.memberLogNotBuilt = true;
}
