import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { userClient } from "../api/clients";
import type { TeamAccessItem } from "../gen/warehouse/user/v1/user_pb";
import { useAuth } from "../auth/AuthContext";

const CURRENT_TEAM_KEY = "warehouse_revamp.team";

interface TeamState {
  teams: TeamAccessItem[];
  current: TeamAccessItem | null;
  ready: boolean;
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
  const [current, setCurrent] = useState<TeamAccessItem | null>(null);
  const [ready, setReady] = useState(false);

  // load fetches memberships and picks the current team: the caller-supplied preferred id wins,
  // then the last-used team from storage, then the first team. Passing the current id in keeps the
  // selection stable across a refresh.
  const load = useCallback(
    async (preferredId?: bigint) => {
      const res = await userClient.teamAccessList({});

      setTeams(res.teams);

      const wanted = (preferredId ?? "").toString() || window.localStorage.getItem(CURRENT_TEAM_KEY);
      const restored = res.teams.find((t) => t.teamId.toString() === wanted);

      setCurrent(restored ?? res.teams[0] ?? null);
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

  const selectTeam = useCallback(
    (teamId: bigint) => {
      const team = teams.find((t) => t.teamId === teamId);

      if (!team) {
        return;
      }

      window.localStorage.setItem(CURRENT_TEAM_KEY, teamId.toString());
      setCurrent(team);
    },
    [teams],
  );

  return (
    <TeamContext.Provider value={{ teams, current, ready, selectTeam, refresh }}>
      {children}
    </TeamContext.Provider>
  );
}

export function useTeam(): TeamState {
  const ctx = useContext(TeamContext);

  if (!ctx) {
    throw new Error("useTeam must be used inside <TeamProvider>");
  }

  return ctx;
}
