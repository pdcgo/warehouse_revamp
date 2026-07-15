import { createBrowserRouter } from "react-router-dom";
import { AuthGate, ProtectedRoute } from "./auth/AuthGate";
import { LoginPage } from "./auth/LoginPage";
import { CategoriesPage } from "./categories/CategoriesPage";
import { Layout } from "./components/Layout";
import { ComponentsPage } from "./dev/ComponentsPage";
import { HomePage } from "./home/HomePage";
import { ProductsPage } from "./products/ProductsPage";
import { ProfilePage } from "./settings/ProfilePage";
import { SettingsPage } from "./settings/SettingsPage";
import { ShippingChannelsPage } from "./shipping/ShippingChannelsPage";
import { TeamProvider } from "./team/TeamContext";
import { TeamsPage } from "./teams/TeamsPage";
import { WarehousesPage } from "./teams/WarehousesPage";
import { AllUsersPage } from "./users/AllUsersPage";
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
      { path: "warehouses", element: <WarehousesPage /> },
      { path: "categories", element: <CategoriesPage /> },
      { path: "shipping", element: <ShippingChannelsPage /> },
      { path: "products", element: <ProductsPage /> },
      { path: "users", element: <UsersPage /> },
      { path: "all-users", element: <AllUsersPage /> },
      { path: "components", element: <ComponentsPage /> },
      { path: "settings", element: <SettingsPage /> },
      { path: "profile", element: <ProfilePage /> },
    ],
  },
]);
