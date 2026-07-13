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
        const res = await userClient.teamAccessList({});

        if (cancelled) {
          return;
        }

        setTeams(res.teams);

        // Restore the last-used team, else fall back to the first.
        const saved = window.localStorage.getItem(CURRENT_TEAM_KEY);
        const restored = res.teams.find((t) => t.teamId.toString() === saved);

        setCurrent(restored ?? res.teams[0] ?? null);
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
  }, [identity]);

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
    <TeamContext.Provider value={{ teams, current, ready, selectTeam }}>
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
