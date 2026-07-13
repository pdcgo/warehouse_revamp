import { createBrowserRouter } from "react-router-dom";
import { AuthGate, ProtectedRoute } from "./auth/AuthGate";
import { LoginPage } from "./auth/LoginPage";
import { Layout } from "./components/Layout";
import { HomePage } from "./home/HomePage";
import { ProfilePage } from "./settings/ProfilePage";
import { TeamProvider } from "./team/TeamContext";
import { TeamsPage } from "./teams/TeamsPage";
import { UsersPage } from "./users/UsersPage";

// TeamProvider sits INSIDE the protected route: memberships are only loadable once there is an
// identity, and TeamAccessList requires a token.
function AppShell() {
  return (
    <ProtectedRoute>
      <TeamProvider>
        <Layout />
      </TeamProvider>
    </ProtectedRoute>
  );
}

export const router = createBrowserRouter([
  {
    path: "/login",
    element: (
      <AuthGate>
        <LoginPage />
      </AuthGate>
    ),
  },
  {
    path: "/",
    element: (
      <AuthGate>
        <AppShell />
      </AuthGate>
    ),
    children: [
      { index: true, element: <HomePage /> },
      { path: "teams", element: <TeamsPage /> },
      { path: "users", element: <UsersPage /> },
      { path: "profile", element: <ProfilePage /> },
    ],
  },
]);
