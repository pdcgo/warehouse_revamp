import type { PendingList, PendingPart } from "../../features/pending/registry";

// WHAT THE TEAMS SCREENS CANNOT DO YET — the user decisions' second prototype
// (docs/business/user/context_decision.md#the-switcher-ships-with-the-create-team-form).
//
// The Create Team form names the new team's Owner, but the server has not been changed: TeamCreate still
// makes the person who pressed Create the Owner and ignores the one named. See `features/pending`.

/** One unwired part. The id is also its i18n key (`teams.pending.<id>`). */
export type TeamsPendingId = "owner";

const PARTS: PendingPart<TeamsPendingId>[] = [
  // the-create-team-form-names-the-first-owner — the named person is sent and thrown away.
  { id: "owner", kind: "dropped" },
];

export const TEAMS_PENDING: PendingList<TeamsPendingId> = { ns: "teams", parts: PARTS };
