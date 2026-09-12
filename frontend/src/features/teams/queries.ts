import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { teamClient } from "../../api/clients";
import { key, listQuery, referenceQuery } from "../../api/queryClient";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { teamListRowData, teamsFromList } from "./adapt";
import { useInvalidateUsers } from "../users/queries";

// The team screens' reads (#176) and writes (#177). Query hooks live beside the screens that use
// them, per the convention in api/queryClient.ts.
//
// ⚠ NO TEAM IN THE KEY — and this is the one domain where that needs saying out loud, because the
// rule in api/queryClient.ts is the opposite. TeamList and TeamDetail are UNSCOPED on the wire
// (`allow_only_authenticated`, no `team_id` field at all): the roster of teams is the same roster
// whichever team the admin happens to be standing in, so there is no second answer for a second
// team to collide with. Passing `undefined` records that as a DECISION — the alternative, threading
// `current.teamId` through, would key the same rows four different ways for one admin who switches
// teams, and cache-miss every switch for no gain.

interface TeamListArgs {
  /** Undefined = every type — the enum's UNSPECIFIED zero, which the server reads as "all". */
  teamType?: TeamType;
  page: number;
  pageSize: number;
  /** For a list that is only fetched in one mode of its screen (the users screen's team filter). */
  enabled?: boolean;
  /**
   * True when the caller is a PICKER FEED or a NAME LOOKUP rather than a list somebody works from —
   * `TeamSelect`'s options, or the restock screens resolving a `From` column's team id to a name.
   *
   * This hook is the one place in the app where both callers exist, which is why the distinction is a
   * flag here instead of a second hook. The rows are identical; what differs is what a stale one
   * costs. On the Teams page it is a record being managed, so it is always fresh (`listQuery`, with
   * the previous page kept on screen while the next loads). In a dropdown it is a LABEL, re-read on
   * every mount and several times per screen, and a team named a minute ago is not a wrong answer —
   * so those callers buy out of always-fresh explicitly (`referenceQuery`).
   */
  reference?: boolean;
}

export function useTeams({ teamType, page, pageSize, enabled = true, reference = false }: TeamListArgs) {
  const type = teamType ?? TeamType.UNSPECIFIED;

  return useQuery({
    queryKey: key.teams(undefined, { teamType: type, page, pageSize }),
    ...(reference ? referenceQuery : listQuery),
    enabled,
    queryFn: async () => {
      const res = await teamClient.teamList({
        filter: { teamType: type },
        dataRequest: teamListRowData(),
        page: { page, limit: pageSize },
      });

      return {
        teams: teamsFromList(res.items, res.ids),
        totalItems: Number(res.pageInfo?.totalItems ?? 0n),
      };
    },
  });
}

// WHICH TEAMS CARRY THE PRIORITY-PRODUCT FEATURE — the ids, and nothing else.
//
// Root grants the feature to a TEAM, and it makes that team's whole catalogue priority (owner). The
// product picker's *Priority Product* tab is built from these ids: it asks team_service who is
// priority, then narrows a ProductDiscover by the answer. product_service is never told what the list
// MEANS — which is what lets the flag live in exactly one service without a cross-service join
// (HARD RULE 3).
//
// `referenceQuery`, not `listQuery`: this is read to LABEL a browse, several times per screen, and a
// team granted the feature a minute ago is not a wrong answer. A stale stock count would be; a stale
// capability list is not.
//
// ONE LARGE PAGE rather than a pager. The set is small by construction — the feature is for "a few
// selling teams" — and the caller needs the WHOLE list to build a filter, not a window of it: half
// the ids would silently produce a Priority tab missing teams and an Other tab showing them.
export function usePriorityTeamIds() {
  return useQuery({
    queryKey: key.teams(undefined, { priority: true }),
    ...referenceQuery,
    queryFn: async () => {
      const res = await teamClient.teamList({
        filter: { priorityProductOnly: true },
        dataRequest: teamListRowData(),
        page: { page: 1, limit: PRIORITY_TEAM_LIMIT },
      });

      return res.ids;
    },
  });
}

// PageFilter.limit is validated 1..200, and `ProductDiscover.owner_team_ids` accepts at most 200 —
// the two ceilings agree, which is not a coincidence: this list is fed straight into that field.
const PRIORITY_TEAM_LIMIT = 200;

// One team — the detail page's read, and the contact/bank dialog's.
//
// Both go through THIS hook rather than each fetching for itself, because TeamDetail is the only
// RPC that returns `info`: the dialog and the page are two views of one record, and a write from
// either must move both. `enabled` is what lets the dialog stay cheap — it does not read until it
// is opened, exactly as the old effect did.
export function useTeamDetail({ teamId, enabled = true }: { teamId: bigint; enabled?: boolean }) {
  return useQuery({
    queryKey: key.teams(undefined, { teamId: teamId.toString() }),
    enabled: enabled && teamId > 0n,
    queryFn: async () => {
      const res = await teamClient.teamDetail({ teamId });

      return res.team ?? null;
    },
  });
}

// Deliberately BROAD — the whole `teams` domain, every list, filter and detail at once.
//
// A rename shows in the tab the row is on AND in every other tab that lists it AND on the detail
// page; a create or a delete shifts every page after it. "Invalidate exactly the affected key"
// would be a calculation, and a calculation is something that can be wrong. The domain holds a
// handful of cached lists, not thousands.
export function useInvalidateTeams() {
  const client = useQueryClient();

  return () => client.invalidateQueries({ queryKey: ["teams"] });
}

// ── Writes (#177) ───────────────────────────────────────────────────────────────────────────────
//
// A mutation DECLARES WHAT IT INVALIDATES, here, beside the query it makes stale. The hook owns the
// CACHE; the component owns the UX (the toast, closing the dialog, showing the error). That split is
// why a dialog no longer needs a handle on its parent's fetching, and why the same dialog opened
// from a second place refreshes just as much as from the first.
//
// `onSuccess` RETURNS the invalidation promise on purpose — TanStack then awaits it, so the mutation
// is not "settled" until the list behind the dialog has refetched. Dropping the `return` makes the
// dialog close a beat before the row appears, which reads as a write that did not land.
//
// ── Teams and users are ENTANGLED, so most of these invalidate BOTH domains ──
//
// A membership is a fact about a team AND about a person, and the two are cached separately:
// `["teams"]` holds TeamList/TeamDetail, `["users"]` holds UserList (a team's members) and UserTeams
// (a person's teams). UserTeams carries the team's NAME and TYPE, resolved from team_service — so a
// team write is not confined to the teams cache the way it looks.
//
// What that does NOT reach is the team SWITCHER: TeamContext holds memberships in its own state, not
// in this cache, so no invalidation here can move it. That gap is #178 and is deliberately left
// alone rather than patched around from in here.

// Create is its own hook rather than sharing one with update (the `useSaveExpense` shape), because
// these are not one form re-opened: a new team is born with a TYPE and a CODE, both immutable
// afterwards, so the edit form is a strictly smaller thing than the create form. Folding them
// together would mean an optional `type`/`teamCode` that is meaningless on half the calls.
export function useCreateTeam() {
  const invalidateTeams = useInvalidateTeams();
  const invalidateUsers = useInvalidateUsers();

  return useMutation({
    mutationFn: (vars: { type: TeamType; name: string; teamCode: string; description: string }) =>
      teamClient.teamCreate(vars),
    // Users too: TeamCreate makes the CALLER the new team's owner, server-side, so the person who
    // pressed the button has a membership they did not have a moment ago. Their user-detail page
    // lists it.
    onSuccess: () => Promise.all([invalidateTeams(), invalidateUsers()]),
  });
}

// ⚠ EVERY FIELD BUT `teamId` IS OPTIONAL, and that mirrors the contract rather than being lax.
//
// TeamUpdate declares `name`, `description` and `image_url` as proto3 `optional` — "Absent = leave
// alone", stated in team.proto. Requiring them here would force a caller that only wants to RENAME a
// team to supply a description, and supplying `""` is not "leave alone" — it is present-and-empty,
// which CLEARS it. The settings screen renames, and TeamPicture only ever sets an image; neither
// carries the other's fields, and neither should be made to invent them.
export function useUpdateTeam() {
  const invalidateTeams = useInvalidateTeams();
  const invalidateUsers = useInvalidateUsers();

  return useMutation({
    mutationFn: (vars: {
      teamId: bigint;
      name?: string;
      description?: string;
      imageUrl?: string;
    }) => teamClient.teamUpdate(vars),
    // The name is the entangled part: UserTeams returns `team_name` for each of a person's
    // memberships, so a rename that only invalidated `["teams"]` would leave the renamed team
    // showing its old name on the user-detail page.
    onSuccess: () => Promise.all([invalidateTeams(), invalidateUsers()]),
  });
}

export function useDeleteTeam() {
  const invalidateTeams = useInvalidateTeams();
  const invalidateUsers = useInvalidateUsers();

  return useMutation({
    mutationFn: (vars: { teamId: bigint }) => teamClient.teamDelete(vars),
    // Deleting a team takes every membership in it with it — so the team's member list and each
    // former member's team list are both wrong until `["users"]` is refetched.
    onSuccess: () => Promise.all([invalidateTeams(), invalidateUsers()]),
  });
}

// The team's INFO — contact, bank details, and the default warehouse (#145).
//
// Teams ONLY: `info` is carried by TeamDetail and nothing else — no user query returns a bank
// account, so invalidating `["users"]` here would refetch lists that cannot have changed.
//
// ⚠ ALL FIELDS OPTIONAL, and here it is not a nicety — it is the difference between saving a setting
// and destroying somebody's bank details.
//
// team.proto states it outright: "ALL optional — explicit presence. Absent = leave alone. Present =
// write it, including empty." Two screens write this message and they touch DISJOINT fields — the
// contact/bank dialog, and the settings screen's default-warehouse picker. If the vars required the
// bank fields, saving a default warehouse would send four present-and-empty strings and wipe the
// account details of the team that saved it.
//
// The ids stay optional for the mirror-image reason: `present & 0` is how the contract says CLEAR,
// so a caller that means "leave the return warehouse alone" must omit it rather than send 0.
export function useSaveTeamInfo() {
  const invalidate = useInvalidateTeams();

  return useMutation({
    mutationFn: (vars: {
      teamId: bigint;
      contactNumber?: string;
      bankType?: string;
      bankOwnerName?: string;
      bankAccountNumber?: string;
      returnWarehouseId?: bigint;
      returnUserId?: bigint;
      defaultWarehouseId?: bigint;
    }) => teamClient.teamInfoUpdate(vars),
    onSuccess: () => invalidate(),
  });
}
