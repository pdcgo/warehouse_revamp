import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { teamClient } from "../../api/clients";
import { key } from "../../api/queryClient";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
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
}

export function useTeams({ teamType, page, pageSize, enabled = true }: TeamListArgs) {
  const type = teamType ?? TeamType.UNSPECIFIED;

  return useQuery({
    queryKey: key.teams(undefined, { teamType: type, page, pageSize }),
    enabled,
    queryFn: async () => {
      const res = await teamClient.teamList({ teamType: type, page: { page, limit: pageSize } });

      return {
        teams: res.teams,
        totalItems: Number(res.pageInfo?.totalItems ?? 0n),
      };
    },
  });
}

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
