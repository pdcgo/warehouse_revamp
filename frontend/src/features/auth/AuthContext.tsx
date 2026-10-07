import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { authClient } from "../../api/clients";
import type { Identity } from "../../gen/warehouse/role_base/v1/role_pb";
import { clearToken, getToken, isRemembered, setToken } from "./tokenStorage";

interface AuthState {
  identity: Identity | null;
  // ready is false until the initial CheckAccess settles. Rendering before that would flash the
  // login page at an already-authenticated user.
  ready: boolean;
  login: (username: string, password: string, remember: boolean) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [ready, setReady] = useState(false);

  // Validate the stored token ON PAGE LOAD.
  //
  // A token in storage proves nothing: it may be expired, the account may be suspended, or the
  // password may have been reset. CheckAccess is the server deciding, and it hands back a
  // renewed token (sliding session) which we write back to the SAME store the old one came from.
  const check = useCallback(async () => {
    const token = getToken();

    if (!token) {
      setIdentity(null);
      setReady(true);

      return;
    }

    try {
      const res = await authClient.checkAccess({ token });

      if (res.token) {
        setToken(res.token, isRemembered());
      }

      setIdentity(res.identity ?? null);
    } catch {
      // Expired, suspended, or garbage. Drop it — a stale token must not linger.
      clearToken();
      setIdentity(null);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

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
    <AuthContext.Provider value={{ identity, ready, login, logout }}>
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
