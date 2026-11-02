import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { teamClient, userClient } from "../../api/clients";
import { Role } from "../../gen/warehouse/role_base/v1/role_pb";
import { teamByIdsRowData, teamsByIds } from "../teams/adapt";
import { teamAccessFromList, teamAccessRowData } from "../users/adapt";
import { create } from "@bufbuild/protobuf";
import { TeamAccessItemSchema } from "../../gen/warehouse/user/v1/user_pb";
import type { TeamAccessItem } from "../../gen/warehouse/user/v1/user_pb";
import { useAuth } from "../auth/AuthContext";
import { TeamType } from "../../gen/warehouse/team/v1/team_pb";
import { roleLabel, rolesFor } from "../../lib/roles";
import { useTranslation } from "react-i18next";

// Stored in sessionStorage, NOT localStorage: the active team is per-TAB, so two tabs can be open
// on two different teams at once (a warehouse manager reconciling against a selling team, say).
// Exported so a test harness can plant the selection rather than re-typing the key. A second copy
// of a storage key is a copy that silently stops matching — and the symptom would be a story quietly
// rendering the DEFAULT team while claiming to be another one.
export const CURRENT_TEAM_KEY = "warehouse_revamp.team";

/** The root team — membership there as Root or the Administrator reaches every team. */
export const ROOT_TEAM_ID = 1n;

/** The team the app is scoped to. `notMember` marks a team picked from the switcher's *All teams*: the person
 *  is not in it. Root or the Administrator act there with their platform role
 *  (a-non-member-root-acts-under-a-strip); the admin team only READS it, and `readOnly` says so
 *  (the-admin-team-monitors-read-only) — see canWrite. */
export type CurrentTeam = TeamAccessItem & { notMember?: boolean; readOnly?: boolean };

interface TeamState {
  teams: TeamAccessItem[];
  current: CurrentTeam | null;
  ready: boolean;
  /** ROOT or ADMINISTRATOR when the person holds it in the root team — the reach that lets them pick a team
   *  they are not in (the-switcher-offers-every-team). */
  platformRole: Role | undefined;
  /** ADMIN_OWNER or ADMIN_ADMINISTRATOR when the person holds it in an admin-type team — the reach that lets them
   *  pick any warehouse or selling team and READ it (the-admin-team-monitors-read-only). Root's reach wins over it. */
  monitorRole: Role | undefined;
  selectTeam: (teamId: bigint) => void;
  // refresh re-loads the caller's memberships, KEEPING the current selection, so a rename or a
  // new team picture is reflected in the switcher without a full reload.
  refresh: () => Promise<void>;
}

const TeamContext = createContext<TeamState | null>(null);

// TeamProvider loads the caller's memberships once they are authenticated.
//
// THE CURRENT TEAM IS THE SCOPE. Every scoped RPC must put `current.teamId` in its request body —
// the backend's (use_scope) option reads it from the message, not from a header, so no
// interceptor can do this for you.
export function TeamProvider({ children }: { children: ReactNode }) {
  const { identity } = useAuth();

  const [teams, setTeams] = useState<TeamAccessItem[]>([]);
  const [current, setCurrent] = useState<CurrentTeam | null>(null);
  const [ready, setReady] = useState(false);

  // load fetches memberships and picks the current team: the caller-supplied preferred id wins,
  // then the last-used team from storage, then the first team. Passing the current id in keeps the
  // selection stable across a refresh.
  const load = useCallback(
    async (preferredId?: bigint) => {
      // Ask for a large first page: this backs the team switcher, which needs all of the caller's
      // teams. A person is realistically in far fewer than the 200 max.
      const res = await userClient.teamAccessList({
        dataRequest: teamAccessRowData(),
        page: { page: 1, limit: 200 },
      });
      const teams = teamAccessFromList(res.items, res.ids);

      setTeams(teams);

      const wanted =
        (preferredId ?? "").toString() || window.sessionStorage.getItem(CURRENT_TEAM_KEY);
      const restored = teams.find((t) => t.teamId.toString() === wanted);

      if (restored) {
        setCurrent(restored);
        return;
      }

      // A team picked from *All teams* is not among the memberships, so it is restored BY ID — for Root and
      // the Administrator, who reach it through the root team, and for the admin team, who reads it. Anyone else
      // falls back to their first team.
      const platform = platformRoleOf(teams);
      const monitor = monitorRoleOf(teams);

      if (wanted && (platform !== undefined || monitor !== undefined)) {
        const outside = await nonMemberTeam(BigInt(wanted), platform);

        if (outside) {
          setCurrent(outside);
          return;
        }
      }

      setCurrent(teams[0] ?? null);
    },
    [],
  );

  useEffect(() => {
    if (!identity) {
      setTeams([]);
      setCurrent(null);
      setReady(true);

      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        if (!cancelled) {
          await load();
        }
      } catch {
        // Memberships are part of the session. If this fails the app is unusable anyway; the
        // route guard will send the user to login.
        if (!cancelled) {
          setTeams([]);
          setCurrent(null);
        }
      } finally {
        if (!cancelled) {
          setReady(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [identity, load]);

  // refresh re-loads memberships but keeps whichever team is currently selected.
  const refresh = useCallback(async () => {
    await load(current?.teamId);
  }, [load, current?.teamId]);

  const platformRole = platformRoleOf(teams);
  const monitorRole = monitorRoleOf(teams);

  const selectTeam = useCallback(
    (teamId: bigint) => {
      const team = teams.find((t) => t.teamId === teamId);

      // Only Root, the Administrator and the admin team may pick a team they are not in; the reload resolves it by
      // id — and, for the admin team, refuses one that is not a warehouse or selling team.
      if (!team && platformRoleOf(teams) === undefined && monitorRoleOf(teams) === undefined) {
        return;
      }

      window.sessionStorage.setItem(CURRENT_TEAM_KEY, teamId.toString());

      // Reset to the app root and hard-reload. Switching team re-scopes the WHOLE app, so rather
      // than surgically re-fetch every open view, we reload: no stale data from the previous scope
      // can survive, and the route returns to a page that exists for the new team.
      //
      // ⚠ CONSIDERED AND KEPT (#178, 2026-07-22). Once a query cache existed, the obvious question
      // was whether this could become `queryClient.clear()` plus a router navigation. It was measured
      // rather than argued: a full switch — click to the app usable again in the new team — takes
      // ~630ms, with the document and bundle served from cache (0 KB transferred, DOMContentLoaded
      // 260ms). That is the whole prize for giving up the guarantee below, on an action somebody
      // performs a handful of times a day.
      //
      // What the reload buys is CORRECTNESS BY CONSTRUCTION: nothing from the previous team can
      // survive, because nothing survives. "We clear the cache correctly" is a weaker promise, and
      // the failure it risks — one team seeing another team's rows — is the worst this system can
      // produce. It also solves a second problem for free: routes differ by team type, so a
      // warehouse-only page must not persist after switching to a selling team.
      //
      // Do not re-open this without a reason the 630ms is actually costing somebody something.
      window.location.assign("/");
    },
    [teams],
  );

  return (
    <TeamContext.Provider value={{ teams, current, ready, platformRole, monitorRole, selectTeam, refresh }}>
      {children}
    </TeamContext.Provider>
  );
}

/** ROOT or ADMINISTRATOR, when held in the root team. */
function platformRoleOf(teams: TeamAccessItem[]): Role | undefined {
  const role = teams.find((t) => t.teamId === ROOT_TEAM_ID)?.role;

  return role === Role.ROOT || role === Role.ADMINISTRATOR ? role : undefined;
}

/** ADMIN_OWNER or ADMIN_ADMINISTRATOR, when held in any team — they exist only in admin-type teams, since a role
 *  belongs to its team's type. The Owner first, if somebody holds both. */
function monitorRoleOf(teams: TeamAccessItem[]): Role | undefined {
  const roles = new Set(teams.map((t) => t.role));

  if (roles.has(Role.ADMIN_OWNER)) return Role.ADMIN_OWNER;
  if (roles.has(Role.ADMIN_ADMINISTRATOR)) return Role.ADMIN_ADMINISTRATOR;

  return undefined;
}

/** The team types the admin team monitors — every warehouse and selling team, and nothing else
 *  (the-admin-team-monitors-all-and-manages-its-own). Exported for the switcher's All teams. */
export function isMonitorable(teamType: TeamType | number | undefined): boolean {
  return teamType === TeamType.WAREHOUSE || teamType === TeamType.SELLING;
}

/**
 * A team the person is not in, as the current team, flagged `notMember`.
 *
 * Root or the Administrator (`platform` set) act there with their platform role. Otherwise it is the admin team
 * MONITORING it: only a warehouse or selling team, and `readOnly`. Its `role` is then the team type's OWNER role —
 * the SCREEN ROLE: it decides which screens and which reads appear (the menu, the manager's views), so the monitor
 * sees the team type's screens as their fullest reader does. It never decides a write: canWrite is false for the
 * whole team, and the server knows no role of theirs here at all.
 */
async function nonMemberTeam(teamId: bigint, platform: Role | undefined): Promise<CurrentTeam | null> {
  try {
    const team = teamsByIds(await teamClient.teamByIds({ filter: { ids: [teamId] }, dataRequest: teamByIdsRowData() }))[
      teamId.toString()
    ];

    if (!team) {
      return null;
    }

    const monitoring = platform === undefined;

    if (monitoring && !isMonitorable(team.type)) {
      return null;
    }

    return {
      ...create(TeamAccessItemSchema, {
        teamId,
        teamName: team.name,
        teamType: team.type,
        imageUrl: team.imageUrl,
        role: monitoring ? rolesFor(team.type)[0] : platform,
      }),
      notMember: true,
      readOnly: monitoring,
    };
  } catch {
    return null;
  }
}

/**
 * WHETHER A SCREEN MAY OFFER A WRITE in the current team — false only while the admin team monitors it
 * (the-admin-team-monitors-read-only).
 *
 * THE ONE GATE. Every create button, row action, edit link, form submit, upload and import goes through it — on top
 * of whatever role check it already had, never instead of one — and no screen works the answer out for itself from
 * `readOnly` or the team. A monitor's `role` is the team type's Owner (nonMemberTeam), so a role check alone would
 * OFFER the Owner's writes: this is what takes them away.
 *
 * ⚠ UX ONLY, like every role helper. The access interceptor refuses a monitor's write whatever the screen offers.
 */
export function canWrite(current: CurrentTeam | null | undefined): boolean {
  return !current?.readOnly;
}

/** canWrite for the current team. Outside a TeamProvider (a component story with no session) it answers true — the
 *  app always has the provider, and a component story is not a monitored team. */
export function useCanWrite(): boolean {
  return canWrite(useContext(TeamContext)?.current);
}

/** What the shells print as "your role here" — *Monitoring* for a monitored team, whose `role` is only the screen
 *  role (nonMemberTeam) and must never read as the person being its Owner. */
export function useCurrentRoleLabel(): string {
  const { t } = useTranslation();
  const current = useContext(TeamContext)?.current;

  return current?.readOnly ? t("shell.monitoringRole") : roleLabel(current?.role);
}

export function useTeam(): TeamState {
  const ctx = useContext(TeamContext);

  if (!ctx) {
    throw new Error("useTeam must be used inside <TeamProvider>");
  }

  return ctx;
}
