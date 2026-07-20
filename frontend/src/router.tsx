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
const DiscoverProductsPage = lazy(() =>
  import("./products/DiscoverProductsPage").then((m) => ({ default: m.DiscoverProductsPage })),
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
const SuppliersPage = lazy(() =>
  import("./suppliers/SuppliersPage").then((m) => ({ default: m.SuppliersPage })),
);
const SupplierDetailPage = lazy(() =>
  import("./suppliers/SupplierDetailPage").then((m) => ({ default: m.SupplierDetailPage })),
);
const RacksPage = lazy(() => import("./racks/RacksPage").then((m) => ({ default: m.RacksPage })));
const RackDetailPage = lazy(() =>
  import("./racks/RackDetailPage").then((m) => ({ default: m.RackDetailPage })),
);
const RestockRequestsPage = lazy(() =>
  import("./restock/RestockRequestsPage").then((m) => ({ default: m.RestockRequestsPage })),
);
const RestockRequestFormPage = lazy(() =>
  import("./restock/RestockRequestFormPage").then((m) => ({ default: m.RestockRequestFormPage })),
);
const RestockRequestDetailPage = lazy(() =>
  import("./restock/RestockRequestDetailPage").then((m) => ({ default: m.RestockRequestDetailPage })),
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
      { path: "products/discover", element: <DiscoverProductsPage /> },
      { path: "products/new", element: <ProductEditPage /> },
      { path: "products/:productId", element: <ProductDetailPage /> },
      { path: "products/:productId/edit", element: <ProductEditPage /> },
      { path: "shops", element: <ShopsPage /> },
      { path: "shops/:shopId", element: <ShopDetailPage /> },
      { path: "orders", element: <OrdersPage /> },
      { path: "orders/new", element: <OrderCreatePage /> },
      { path: "orders/:orderId", element: <OrderDetailPage /> },
      { path: "inventory", element: <InventoryPage /> },
      // The Inventories sub-menu (#95). Restock IS the request flow (#105/#122) — one screen that
      // reads differently per team type: a SELLING team creates requests, a WAREHOUSE team accepts
      // them. The on-hand list is "Stock" (it was only ever called Restock under the superseded
      // "pick a warehouse and receive there" design). Placements is a stub.
      { path: "inventories/restock", element: <RestockRequestsPage /> },
      // `new` is static and `:requestId` is dynamic, so React Router ranks `new` first regardless of
      // the order here — /inventories/restock/new stays the create form, not a detail of id "new".
      //
      // One page serves create and edit (#131): it reads the mode off :requestId. The two routes carry
      // distinct `key`s so that switching between them REMOUNTS rather than reconciles — same component
      // type at the same position otherwise keeps its state, which would carry a loaded request's
      // fields into a blank create form.
      { path: "inventories/restock/new", element: <RestockRequestFormPage key="create" /> },
      { path: "inventories/restock/:requestId", element: <RestockRequestDetailPage /> },
      { path: "inventories/restock/:requestId/edit", element: <RestockRequestFormPage key="edit" /> },
      { path: "inventories/stock", element: <InventoryPage title="Stock" /> },
      { path: "inventories/placements", element: <PlacementsPage /> },
      { path: "inventories/suppliers", element: <SuppliersPage /> },
      { path: "inventories/suppliers/:supplierId", element: <SupplierDetailPage /> },
      // Racks are the warehouse's own shelves (#129) — the menu offers them to warehouse teams
      // only, but the route is open and the server's policy is what actually decides.
      { path: "inventories/racks", element: <RacksPage /> },
      // What is on one shelf, and how much (#138) — reached by clicking a rack in the list.
      { path: "inventories/racks/:rackId", element: <RackDetailPage /> },
      { path: "users", element: <UsersPage /> },
      { path: "users/:userId", element: <UserDetailPage /> },
      { path: "components", element: <ComponentsPage /> },
      { path: "settings", element: <SettingsPage /> },
      { path: "profile", element: <ProfilePage /> },
    ],
  },
]);
