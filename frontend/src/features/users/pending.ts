import type { PendingList, PendingPart } from "../pending/registry";

// WHAT THE ADD MEMBER POPUP CANNOT DO YET — the user decisions' prototype
// (docs/business/user/context_decision.md#a-member-is-found-in-a-search-popup).
//
// The popup is built to the decisions and calls the real SearchUser, which has not been changed: it
// still ignores the team, matches part of a name for everyone, and says nothing about who is already
// in the team. The Storybook stub answers the way the decisions say. See `features/pending`.

/** One unwired part of the popup. The id is also its i18n key (`users.addMember.pending.<id>`). */
export type AddMemberPendingId = "exactSearch" | "phoneLast4" | "alreadyMember" | "duplicateRefusal";

const PARTS: PendingPart<AddMemberPendingId>[] = [
  // An Owner or Admin should find only an exact username, phone or email
  // (managers-search-by-exact-username-phone-or-email). The server still matches any two letters.
  { id: "exactSearch", kind: "derived" },
  // The last four digits that tell two Anis apart (a-result-shows-the-phones-last-four-digits).
  { id: "phoneLast4", kind: "missing" },
  // Who already holds a role here (an-existing-member-gets-change-role). Without it every result reads
  // as a newcomer, and Add silently overwrites a member's role.
  { id: "alreadyMember", kind: "missing" },
  // A phone already on another account is not refused yet (a-phone-or-email-belongs-to-one-account).
  { id: "duplicateRefusal", kind: "derived" },
];

export const ADD_MEMBER_PENDING: PendingList<AddMemberPendingId> = { ns: "users.addMember", parts: PARTS };
