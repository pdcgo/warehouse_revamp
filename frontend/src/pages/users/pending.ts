import type { PendingList, PendingPart } from "../../features/pending/registry";

// WHAT THE USERS SCREEN CANNOT DO YET — the user decisions' prototype (docs/business/user/context_decision.md).
//
// The screen is built to the decisions and wired to the real server, which has not been changed yet:
// every new part below is answered by the Storybook stub and by nothing in the running app. The list
// shrinks as the backend lands. See `features/pending` for the four kinds, and for why a badge's
// number is its position here.

/** One unwired part of the screen. The id is also its i18n key (`users.pending.<id>`). */
export type UsersPendingId = "erase" | "memberLog";

const PARTS: PendingPart<UsersPendingId>[] = [
  // UserErase answers "not built yet".
  { id: "erase", kind: "dropped" },
  // TeamMemberLogList answers "not built yet" — there is no log table.
  { id: "memberLog", kind: "missing" },
];

export const USERS_PENDING: PendingList<UsersPendingId> = { ns: "users", parts: PARTS };
