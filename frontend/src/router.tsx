import { lazy } from "react";
import { createBrowserRouter } from "react-router-dom";
import { AuthGate, ProtectedRoute } from "./auth/AuthGate";
import { LoginPage } from "./auth/LoginPage";
import { Layout } from "./components/Layout";
import { TeamProvider } from "./team/TeamContext";

// The app SHELL (auth gate, protected route, team provider, layout) and the LOGIN page load eagerly —
// they are on the critical path to the first paint. Every PAGE behind the layout is code-split with
// React.lazy so a route only pulls its own chunk; the Suspense boundary lives around the <Outlet/> in
// Layout. The pages are named exports, so each import maps `.X` onto the default lazy expects.
const HomePage = lazy(() => import("./home/HomePage").then((m) => ({ default: m.HomePage })));
const TeamsPage = lazy(() => import("./teams/TeamsPage").then((m) => ({ default: m.TeamsPage })));
const TeamDetailPage = lazy(() =>
  import("./teams/TeamDetailPage").then((m) => ({ default: m.TeamDetailPage })),
);
const WarehouseEditPage = lazy(() =>
  import("./warehouses/WarehouseEditPage").then((m) => ({ default: m.WarehouseEditPage })),
);
const CategoriesPage = lazy(() =>
  import("./categories/CategoriesPage").then((m) => ({ default: m.CategoriesPage })),
);
const ShippingChannelsPage = lazy(() =>
  import("./shipping/ShippingChannelsPage").then((m) => ({ default: m.ShippingChannelsPage })),
);
const ProductsPage = lazy(() =>
  import("./products/ProductsPage").then((m) => ({ default: m.ProductsPage })),
);
const ProductEditPage = lazy(() =>
  import("./products/ProductEditPage").then((m) => ({ default: m.ProductEditPage })),
);
const ProductDetailPage = lazy(() =>
  import("./products/ProductDetailPage").then((m) => ({ default: m.ProductDetailPage })),
);
const ShopsPage = lazy(() => import("./shops/ShopsPage").then((m) => ({ default: m.ShopsPage })));
const ShopDetailPage = lazy(() =>
  import("./shops/ShopDetailPage").then((m) => ({ default: m.ShopDetailPage })),
);
const OrdersPage = lazy(() => import("./orders/OrdersPage").then((m) => ({ default: m.OrdersPage })));
const OrderCreatePage = lazy(() =>
  import("./orders/OrderCreatePage").then((m) => ({ default: m.OrderCreatePage })),
);
const OrderDetailPage = lazy(() =>
  import("./orders/OrderDetailPage").then((m) => ({ default: m.OrderDetailPage })),
);
const InventoryPage = lazy(() =>
  import("./inventory/InventoryPage").then((m) => ({ default: m.InventoryPage })),
);
const PlacementsPage = lazy(() =>
  import("./inventory/PlacementsPage").then((m) => ({ default: m.PlacementsPage })),
);
const UsersPage = lazy(() => import("./users/UsersPage").then((m) => ({ default: m.UsersPage })));
const UserDetailPage = lazy(() =>
  import("./users/UserDetailPage").then((m) => ({ default: m.UserDetailPage })),
);
const ComponentsPage = lazy(() =>
  import("./dev/ComponentsPage").then((m) => ({ default: m.ComponentsPage })),
);
const SettingsPage = lazy(() =>
  import("./settings/SettingsPage").then((m) => ({ default: m.SettingsPage })),
);
const ProfilePage = lazy(() =>
  import("./settings/ProfilePage").then((m) => ({ default: m.ProfilePage })),
);

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
      // The Inventories sub-menu (#95): Restock reuses the stock screen; Placements is a stub.
      { path: "inventories/restock", element: <InventoryPage title="Restock" restock /> },
      { path: "inventories/placements", element: <PlacementsPage /> },
      { path: "users", element: <UsersPage /> },
      { path: "users/:userId", element: <UserDetailPage /> },
      { path: "components", element: <ComponentsPage /> },
      { path: "settings", element: <SettingsPage /> },
      { path: "profile", element: <ProfilePage /> },
    ],
  },
]);
