import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { authClient } from "../../api/clients";
import type { Identity } from "../../gen/warehouse/role_base/v1/role_pb";
import { clearToken, getToken, isRemembered, setToken } from "./tokenStorage";
import { nextCheckDelay, serverRefusedTheToken } from "./tokenVerdict";

interface AuthState {
  identity: Identity | null;
  // ready is false until the page load's CheckAccess gets an ANSWER — a session, or the server's verdict on the token —
  // or there is no token to check. Rendering before that would flash the login page at an already-authenticated user,
  // and a check that failed with no verdict (aborted, the network, a 5xx) is not an answer: it is sent again (#96).
  ready: boolean;
  // unreachable: a token is stored, every try so far failed with no verdict, and the waits are spent (checkRetry in
  // tokenVerdict.ts). AuthGate then says the server gave no answer and offers `retry` — never Sign in.
  unreachable: boolean;
  // checking: a CheckAccess is in flight — the no-answer panel's Try Again shows it.
  checking: boolean;
  // retry sends the check once more, now (Try Again); nothing while one is in flight or the load already has its answer.
  retry: () => void;
  login: (username: string, password: string, remember: boolean) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [ready, setReady] = useState(false);
  const [unreachable, setUnreachable] = useState(false);
  const [checking, setChecking] = useState(false);

  // The page load's checks, across its tries. Refs, not state: two checks can be in flight at once (StrictMode, below)
  // and each must see what the other already learned the moment it lands, not on the next render.
  const answered = useRef(false); // a check of this load got an answer — a session or the server's verdict
  const inFlight = useRef(0); // checks sent and not yet ended
  const failures = useRef(0); // checks of this load that ended with no verdict
  const retryTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mounted = useRef(false);

  const cancelRetry = useCallback(() => {
    if (retryTimer.current !== undefined) {
      clearTimeout(retryTimer.current);
      retryTimer.current = undefined;
    }
  }, []);

  // Validate the stored token ON PAGE LOAD.
  //
  // A token in storage proves nothing: it may be expired, the account may be suspended, or the
  // password may have been reset. CheckAccess is the server deciding, and it hands back a
  // renewed token (sliding session) which we write back to the SAME store the old one came from.
  const check: () => Promise<void> = useCallback(async () => {
    const token = getToken();

    if (!token) {
      answered.current = true;
      cancelRetry();
      setIdentity(null);
      setUnreachable(false);
      setReady(true);

      return;
    }

    inFlight.current += 1;
    setChecking(true);

    try {
      const res = await authClient.checkAccess({ token });

      if (res.token) {
        setToken(res.token, isRemembered());
      }

      answered.current = true;
      cancelRetry();
      setIdentity(res.identity ?? null);
      setUnreachable(false);
      setReady(true);
    } catch (err) {
      // Expired, suspended, or garbage — the SERVER's verdict: drop it, a stale token must not linger.
      if (serverRefusedTheToken(err)) {
        answered.current = true;
        cancelRetry();
        clearToken();
        setIdentity(null);
        setUnreachable(false);
        setReady(true);

        return;
      }

      // Anything else (the request aborted because the person navigated mid-check, the network, a server error) says
      // nothing about the token: keep it, and keep whoever another check of this load already named. When nothing has
      // answered yet, nobody is known to be signed out either — so no Sign in: the shell stays on its spinner and the
      // check goes out again after a short wait, three times; then the gate's no-answer panel (tokenVerdict.ts).
      // Another check still in flight (StrictMode's pair) answers for this one; an unmounted provider asks nothing.
      if (answered.current || inFlight.current > 1 || !mounted.current) {
        return;
      }

      const wait = nextCheckDelay(failures.current);
      failures.current += 1;

      if (wait === null) {
        setUnreachable(true);
      } else {
        cancelRetry();
        retryTimer.current = setTimeout(() => {
          retryTimer.current = undefined;
          void check();
        }, wait);
      }
    } finally {
      inFlight.current -= 1;

      if (inFlight.current === 0) {
        setChecking(false);
      }
    }
  }, [cancelRetry]);

  // ⚠ Under StrictMode (main.tsx) a DEV build runs this effect twice, so a page load sends two CheckAccess calls — React's
  // mount/unmount/mount check, not a second caller; a production build sends one. Leaving the page while the second is in
  // flight aborts it, which is why an abort must never drop the token (the catch above). The cleanup only stops a waiting
  // retry: the first check of the pair stays in flight, and its answer counts.
  useEffect(() => {
    mounted.current = true;
    void check();

    return () => {
      mounted.current = false;
      cancelRetry();
    };
  }, [check, cancelRetry]);

  const retry = useCallback(() => {
    if (inFlight.current === 0 && !answered.current) {
      void check();
    }
  }, [check]);

  // Past the last wait, the connection coming back or the person returning to the window asks once more by itself —
  // one check per event, and only while the gate shows its no-answer panel.
  useEffect(() => {
    if (!unreachable) {
      return;
    }

    window.addEventListener("online", retry);
    window.addEventListener("focus", retry);

    return () => {
      window.removeEventListener("online", retry);
      window.removeEventListener("focus", retry);
    };
  }, [unreachable, retry]);

  const login = useCallback(async (username: string, password: string, remember: boolean) => {
    const res = await authClient.login({ username, password });

    setToken(res.token, remember);
    setIdentity(res.identity ?? null);
  }, []);

  const logout = useCallback(async () => {
    try {
      // Best-effort: this evicts the user's cached roles server-side. The token itself stays
      // valid until it expires — logout is a client-side act.
      await authClient.logout({});
    } catch {
      // Logging out must never fail. If the server is unreachable, dropping the token locally
      // is still the right outcome.
    }

    clearToken();
    setIdentity(null);
  }, []);

  return (
    <AuthContext.Provider value={{ identity, ready, unreachable, checking, retry, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);

  if (!ctx) {
    throw new Error("useAuth must be used inside <AuthProvider>");
  }

  return ctx;
}
