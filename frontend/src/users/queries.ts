import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { userClient } from "../api/clients";
import { key } from "../api/queryClient";
import type { Role } from "../gen/warehouse/role_base/v1/role_pb";

// The user screens' reads (#176) and writes (#177). Query hooks live beside the screens that use
// them, per the convention in api/queryClient.ts.

interface UserListArgs {
  /**
   * The team whose members to list. `0n` means EVERY user — UserList's `team_id` does double duty
   * (see the proto), and an unset scope resolves to the root team, so 0 is a root/admin read.
   * `undefined` means the team is not known yet and nothing should be fetched.
   */
  teamId: bigint | undefined;
  q: string;
  page: number;
  pageSize: number;
}

// A team's members — and, at `teamId = 0n`, everyone.
//
// ONE hook for two screens that used to fetch separately: the Users table (both of its tabs) and the
// members tab of a team detail page. They are the same question — "who is in this team?" — so they
// are the same cache entry, and a member added from either place appears on both. That sharing is
// the reason the member list moved out of TeamDetailCommon and into the USERS domain rather than
// getting a teams-domain key of its own: it is a user list that happens to be scoped to a team.
export function useUsers({ teamId, q, page, pageSize }: UserListArgs) {
  return useQuery({
    queryKey: key.users(teamId, { q, page, pageSize }),
    // The current team is not known on first paint (TeamProvider is still resolving memberships),
    // and a request sent in that window would be scoped to nothing and rejected.
    enabled: teamId !== undefined,
    queryFn: async () => {
      const res = await userClient.userList({ teamId: teamId!, q, page: { page, limit: pageSize } });

      return {
        users: res.users,
        totalItems: Number(res.pageInfo?.totalItems ?? 0n),
      };
    },
  });
}

// The user detail screen's read (#176).
//
// UserTeams returns the person AND their memberships in one call, so one query holds both — they are
// one answer, not two that happen to arrive together.
//
// No team in the key: this is an admin screen about a PERSON, and the same user is the same user
// whichever team the admin is currently standing in. `key.users(undefined, …)` records that
// deliberately rather than by omission.
export function useUserTeams(args: { userId: bigint; page: number; pageSize: number }) {
  const { userId, page, pageSize } = args;

  return useQuery({
    queryKey: key.users(undefined, { userId: userId.toString(), page, pageSize }),
    enabled: userId > 0n,
    queryFn: async () => {
      const res = await userClient.userTeams({ userId, page: { page, limit: pageSize } });

      return {
        user: res.user ?? null,
        teams: res.teams,
        pageInfo: res.pageInfo,
      };
    },
  });
}

// Deliberately BROAD — every user list, every team's members, and every person's memberships at
// once. A membership write changes a list in one team and a list on one person's page; a rename
// changes a row that may be cached under several filters and pages. Working out the exact set is a
// calculation, and a calculation is something that can be wrong; the domain holds a handful of
// cached pages, so refetching them costs nothing worth optimising for.
// The user PICKER's search (UserSelect).
//
// Two RPCs behind one hook, because the question differs with the scope: inside a team it is "this
// team's members matching q" (UserList), outside it is "anyone" (SearchUser). Both are in the key,
// so the two answers cannot share an entry.
//
// Reading through the cache buys two things a hand-rolled search does not have. A transient failure
// RETRIES rather than silently becoming an empty result list — and deleting a character returns to a
// query already answered, so backing up through a search is instant instead of another round trip.
//
// The caller still debounces. That is now about request VOLUME rather than correctness: the cache
// decides which answer belongs on screen, so a late reply for an abandoned prefix cannot land.
export function useUserSearch(args: { teamId: bigint | undefined; q: string }) {
  const { teamId, q } = args;

  return useQuery({
    queryKey: key.users(teamId, { search: q }),
    // Both backends want >= 2 characters (SearchUser rejects fewer; UserList is held to the same bar
    // for a consistent feel), so below that we do not ask at all.
    enabled: q.length >= 2,
    queryFn: async () => {
      if (teamId !== undefined && teamId > 0n) {
        const res = await userClient.userList({ teamId, q, page: { page: 1, limit: 10 } });

        return res.users;
      }

      const res = await userClient.searchUser({ q, limit: 10 });

      return res.users;
    },
  });
}

export function useInvalidateUsers() {
  const client = useQueryClient();

  return () => client.invalidateQueries({ queryKey: ["users"] });
}

// ── Writes (#177) ───────────────────────────────────────────────────────────────────────────────
//
// A mutation DECLARES WHAT IT INVALIDATES, here, beside the query it makes stale. The hook owns the
// CACHE; the component owns the UX (the toast, closing the dialog, showing the error). That is why
// these dialogs no longer take an `onDone` — a write cannot forget to invalidate when invalidating
// is part of what the write IS.
//
// `onSuccess` RETURNS the invalidation promise on purpose — TanStack then awaits it, so the mutation
// is not "settled" until the list behind the dialog has refetched. Dropping the `return` makes the
// dialog close a beat before the row appears, which reads as a write that did not land.
//
// ── What these do NOT invalidate, and why ──
//
// `["teams"]` — nothing here touches it. A team's RECORD (name, code, type, contact, bank) carries
// no membership-derived field: TeamList and TeamDetail would return byte-identical rows after any of
// these writes. The entanglement runs the other way — a team write DOES move the users cache,
// because UserTeams carries the team's resolved name and type. See teams/queries.ts.
//
// The team SWITCHER is the real gap: TeamContext keeps the caller's memberships in its own state,
// outside this cache, so adding or removing the CURRENT USER leaves the switcher showing the old
// set until a reload. No invalidation from here can reach it. That is #178, and it is left alone on
// purpose rather than worked around from in here.

interface SaveUserVars {
  /**
   * Whose profile. OMITTED means the caller's own, which is a genuinely different RPC:
   * UpdateProfile takes no user_id (the subject is the token holder) while UpdateUser is
   * root/admin-only. One RPC meaning both is exactly how the source produced an IDOR, so the split
   * survives into the mutation rather than being flattened into an optional argument the server
   * would have to police.
   */
  userId?: bigint;
  name: string;
  email: string;
  phoneNumber: string;
}

export function useSaveUser() {
  const invalidate = useInvalidateUsers();

  return useMutation({
    mutationFn: async ({ userId, ...vars }: SaveUserVars) =>
      userId === undefined
        ? await userClient.updateProfile(vars)
        : await userClient.updateUser({ ...vars, userId }),
    onSuccess: () => invalidate(),
  });
}

// CreateUser writes the account AND its membership in one transaction, so the new person is a member
// of the scoping team the moment this returns — there is no window in which they exist teamless.
export function useCreateUser() {
  const invalidate = useInvalidateUsers();

  return useMutation({
    mutationFn: (vars: {
      teamId: bigint;
      username: string;
      password: string;
      name: string;
      email: string;
      role: Role;
      alias: string;
    }) => userClient.createUser(vars),
    onSuccess: () => invalidate(),
  });
}

export function useSuspendUser() {
  const invalidate = useInvalidateUsers();

  return useMutation({
    mutationFn: (vars: { userId: bigint; suspended: boolean }) => userClient.suspendUser(vars),
    onSuccess: () => invalidate(),
  });
}

export function useDeleteUser() {
  const invalidate = useInvalidateUsers();

  return useMutation({
    mutationFn: (vars: { userId: bigint }) => userClient.deleteUser(vars),
    onSuccess: () => invalidate(),
  });
}

// Add / remove a membership — two hooks over the one RPC, because they are two actions with two
// audiences (a picker dialog, a destructive confirm) and reading `action: { case: "add" }` at the
// call site is how a remove ends up written as an add.
//
// Both invalidate the SAME thing, and it is more than the list you are looking at: the team's member
// list and that person's team list are two cached answers to one fact, and both live under
// `["users"]`.

export function useAddTeamMember() {
  const invalidate = useInvalidateUsers();

  return useMutation({
    mutationFn: (vars: { teamId: bigint; userId: bigint; role: Role }) =>
      userClient.teamUserUpdate({
        teamId: vars.teamId,
        action: { case: "add", value: { userId: vars.userId, role: vars.role, alias: "" } },
      }),
    onSuccess: () => invalidate(),
  });
}

export function useRemoveTeamMember() {
  const invalidate = useInvalidateUsers();

  return useMutation({
    mutationFn: (vars: { teamId: bigint; userId: bigint }) =>
      userClient.teamUserUpdate({
        teamId: vars.teamId,
        action: { case: "remove", value: { userId: vars.userId } },
      }),
    onSuccess: () => invalidate(),
  });
}

// A password is not in any list, so this invalidates NOTHING — deliberately, and it is worth the
// line: every other write here refetches, and a reader would otherwise read the absence as an
// oversight. What it changes is invisible to every query in the app (and very visible to the person
// holding the old token).
export function useAdminResetPassword() {
  return useMutation({
    mutationFn: (vars: { userId: bigint; newPassword: string }) =>
      userClient.adminResetPassword(vars),
  });
}
