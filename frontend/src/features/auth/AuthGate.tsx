import { Center, Spinner } from "@chakra-ui/react";
import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./AuthContext";
import { returnState } from "./returnTo";
import { SessionNoAnswer } from "./SessionNoAnswer";

// AuthGate blocks the first render until CheckAccess has settled.
//
// Without it, an authenticated user with a token in storage sees the login page flash before
// being redirected — the app would be rendering a decision it has not made yet.
//
// SETTLED MEANS ANSWERED (#96): a check that failed with no verdict from the server (aborted, the network, a 5xx) is
// sent again while the spinner stays, and when the tries are spent the gate says the server gave no answer, with Try
// Again — never the Sign in form, since nothing said the person is signed out (tokenVerdict.ts).
export function AuthGate({ children }: { children: ReactNode }) {
  const { ready, unreachable } = useAuth();

  if (!ready) {
    if (unreachable) {
      return <SessionNoAnswer />;
    }

    return (
      <Center minH="100dvh" data-testid="auth-checking">
        <Spinner size="lg" colorPalette="brand" />
      </Center>
    );
  }

  return <>{children}</>;
}

// ProtectedRoute keeps unauthenticated users out of the app shell.
//
// It is a UX guard, NOT a security boundary. The only real boundary is the server's access
// interceptor: every scoped RPC is checked there regardless of what the UI renders.
export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { identity } = useAuth();
  const location = useLocation();

  // `from` carries the QUERY as well as the path: the connect page an agent's OAuth opened is nothing without its
  // client_id, redirect_uri, state and challenge, and signing in must come back to all of it.
  if (!identity) {
    return <Navigate to="/login" replace state={returnState(location)} />;
  }

  return <>{children}</>;
}
