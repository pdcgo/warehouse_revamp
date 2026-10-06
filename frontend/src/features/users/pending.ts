import type { PendingList, PendingPart } from "../pending/registry";

// WHAT THE ADD MEMBER POPUP CANNOT DO YET — the user decisions' prototype
// (docs/business/user/context_decision.md#a-member-is-found-in-a-search-popup).
//
// The search is built (only-member-managers-open-the-search, managers-search-by-exact-username-phone-or-email,
// a-result-shows-the-phones-last-four-digits, an-existing-member-gets-change-role). What is left is the refusal of
// a phone already on another account, which waits on how numbers are stored (user Q31). See `features/pending`.

/** One unwired part of the popup. The id is also its i18n key (`users.addMember.pending.<id>`). */
export type AddMemberPendingId = "duplicateRefusal";

const PARTS: PendingPart<AddMemberPendingId>[] = [
  // A phone already on another account is not refused yet (a-phone-or-email-belongs-to-one-account).
  { id: "duplicateRefusal", kind: "derived" },
];

export const ADD_MEMBER_PENDING: PendingList<AddMemberPendingId> = { ns: "users.addMember", parts: PARTS };
