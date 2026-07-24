import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { Spinner } from "../../components/ui/Spinner";
import { useAuth } from "./AuthContext";

// AuthGate blocks the first render until CheckAccess has settled.
//
// Without it, an authenticated user with a token in storage sees the login page flash before
// being redirected — the app would be rendering a decision it has not made yet.
export function AuthGate({ children }: { children: ReactNode }) {
  const { ready } = useAuth();

  if (!ready) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner className="size-8" />
      </div>
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

  if (!identity) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}
