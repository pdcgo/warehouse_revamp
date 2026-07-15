import { createBrowserRouter } from "react-router-dom";
import { AuthGate, ProtectedRoute } from "./auth/AuthGate";
import { LoginPage } from "./auth/LoginPage";
import { CategoriesPage } from "./categories/CategoriesPage";
import { Layout } from "./components/Layout";
import { ComponentsPage } from "./dev/ComponentsPage";
import { HomePage } from "./home/HomePage";
import { InventoryPage } from "./inventory/InventoryPage";
import { ProductDetailPage } from "./products/ProductDetailPage";
import { ProductEditPage } from "./products/ProductEditPage";
import { ProductsPage } from "./products/ProductsPage";
import { ShopDetailPage } from "./shops/ShopDetailPage";
import { ShopsPage } from "./shops/ShopsPage";
import { OrderCreatePage } from "./orders/OrderCreatePage";
import { OrderDetailPage } from "./orders/OrderDetailPage";
import { OrdersPage } from "./orders/OrdersPage";
import { ProfilePage } from "./settings/ProfilePage";
import { SettingsPage } from "./settings/SettingsPage";
import { ShippingChannelsPage } from "./shipping/ShippingChannelsPage";
import { TeamProvider } from "./team/TeamContext";
import { TeamDetailPage } from "./teams/TeamDetailPage";
import { TeamsPage } from "./teams/TeamsPage";
import { WarehouseEditPage } from "./warehouses/WarehouseEditPage";
import { UserDetailPage } from "./users/UserDetailPage";
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
      { path: "teams/:teamId", element: <TeamDetailPage backTo="/teams" /> },
      // The warehouse edit surface is a dedicated page (it carries the weekly hours); every team
      // type reaches it under /teams. Non-warehouse teams edit in a dialog instead (#59).
      { path: "teams/:teamId/edit", element: <WarehouseEditPage /> },
      { path: "categories", element: <CategoriesPage /> },
      { path: "shipping", element: <ShippingChannelsPage /> },
      { path: "products", element: <ProductsPage /> },
      { path: "products/new", element: <ProductEditPage /> },
      { path: "products/:productId", element: <ProductDetailPage /> },
      { path: "products/:productId/edit", element: <ProductEditPage /> },
      { path: "shops", element: <ShopsPage /> },
      { path: "shops/:shopId", element: <ShopDetailPage /> },
      { path: "orders", element: <OrdersPage /> },
      { path: "orders/new", element: <OrderCreatePage /> },
      { path: "orders/:orderId", element: <OrderDetailPage /> },
      { path: "inventory", element: <InventoryPage /> },
      { path: "users", element: <UsersPage /> },
      { path: "users/:userId", element: <UserDetailPage /> },
      { path: "components", element: <ComponentsPage /> },
      { path: "settings", element: <SettingsPage /> },
      { path: "profile", element: <ProfilePage /> },
    ],
  },
]);
