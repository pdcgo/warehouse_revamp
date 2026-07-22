import { lazy } from "react";
import { createBrowserRouter } from "react-router-dom";
import { AuthGate, ProtectedRoute } from "./features/auth/AuthGate";
import { LoginPage } from "./pages/login/index";
import { Layout } from "./layouts/Layout";
import { TeamProvider } from "./features/team/TeamContext";

// The app SHELL (auth gate, protected route, team provider, layout) and the LOGIN page load eagerly —
// they are on the critical path to the first paint. Every PAGE behind the layout is code-split with
// React.lazy so a route only pulls its own chunk; the Suspense boundary lives around the <Outlet/> in
// Layout. The pages are named exports, so each import maps `.X` onto the default lazy expects.
const HomePage = lazy(() => import("./pages/home").then((m) => ({ default: m.HomePage })));
const TeamsPage = lazy(() => import("./pages/teams").then((m) => ({ default: m.TeamsPage })));
const TeamDetailPage = lazy(() =>
  import("./pages/team-detail").then((m) => ({ default: m.TeamDetailPage })),
);
const WarehouseEditPage = lazy(() =>
  import("./pages/warehouse-edit").then((m) => ({ default: m.WarehouseEditPage })),
);
const CategoriesPage = lazy(() =>
  import("./pages/categories").then((m) => ({ default: m.CategoriesPage })),
);
const ShippingChannelsPage = lazy(() =>
  import("./pages/shipping-channels").then((m) => ({ default: m.ShippingChannelsPage })),
);
const ProductsPage = lazy(() =>
  import("./pages/products").then((m) => ({ default: m.ProductsPage })),
);
const ProductEditPage = lazy(() =>
  import("./pages/product-edit").then((m) => ({ default: m.ProductEditPage })),
);
const ProductDetailPage = lazy(() =>
  import("./pages/product-detail").then((m) => ({ default: m.ProductDetailPage })),
);
const DiscoverProductsPage = lazy(() =>
  import("./pages/product-discover").then((m) => ({ default: m.DiscoverProductsPage })),
);
const ShopsPage = lazy(() => import("./pages/shops").then((m) => ({ default: m.ShopsPage })));
const ShopDetailPage = lazy(() =>
  import("./pages/shop-detail").then((m) => ({ default: m.ShopDetailPage })),
);
const OrdersPage = lazy(() => import("./pages/orders").then((m) => ({ default: m.OrdersPage })));
const OrderCreatePage = lazy(() =>
  import("./pages/order-create").then((m) => ({ default: m.OrderCreatePage })),
);
const OrderDetailPage = lazy(() =>
  import("./pages/order-detail").then((m) => ({ default: m.OrderDetailPage })),
);
const OrderDraftsPage = lazy(() =>
  import("./pages/order-drafts").then((m) => ({ default: m.OrderDraftsPage })),
);
const OrderDraftDetailPage = lazy(() =>
  import("./pages/order-draft-detail").then((m) => ({ default: m.OrderDraftDetailPage })),
);
const SettlementPage = lazy(() =>
  import("./pages/settlement").then((m) => ({ default: m.SettlementPage })),
);
const CounterpartyPage = lazy(() =>
  import("./pages/counterparty").then((m) => ({ default: m.CounterpartyPage })),
);
const InventoryPage = lazy(() =>
  import("./pages/inventory").then((m) => ({ default: m.InventoryPage })),
);
const PlacementsPage = lazy(() =>
  import("./pages/placements").then((m) => ({ default: m.PlacementsPage })),
);
const SuppliersPage = lazy(() =>
  import("./pages/suppliers").then((m) => ({ default: m.SuppliersPage })),
);
const SupplierDetailPage = lazy(() =>
  import("./pages/supplier-detail").then((m) => ({ default: m.SupplierDetailPage })),
);
const RacksPage = lazy(() => import("./pages/racks").then((m) => ({ default: m.RacksPage })));
const WarehouseProductPage = lazy(() =>
  import("./pages/warehouse-product").then((m) => ({ default: m.WarehouseProductPage })),
);
const RestockAcceptPage = lazy(() =>
  import("./pages/restock-accept").then((m) => ({ default: m.RestockAcceptPage })),
);
const ExpensesPage = lazy(() =>
  import("./pages/expenses").then((m) => ({ default: m.ExpensesPage })),
);
const RevenuePage = lazy(() =>
  import("./pages/revenue").then((m) => ({ default: m.RevenuePage })),
);
const ProfitPage = lazy(() =>
  import("./pages/profit").then((m) => ({ default: m.ProfitPage })),
);
const PickQueuePage = lazy(() =>
  import("./pages/pick-queue").then((m) => ({ default: m.PickQueuePage })),
);
const PickOrderPage = lazy(() =>
  import("./pages/pick-order").then((m) => ({ default: m.PickOrderPage })),
);
const RackDetailPage = lazy(() =>
  import("./pages/rack-detail").then((m) => ({ default: m.RackDetailPage })),
);
const RestockRequestsPage = lazy(() =>
  import("./pages/restock-requests").then((m) => ({ default: m.RestockRequestsPage })),
);
const RestockRequestFormPage = lazy(() =>
  import("./pages/restock-request-form").then((m) => ({ default: m.RestockRequestFormPage })),
);
const RestockRequestDetailPage = lazy(() =>
  import("./pages/restock-request-detail").then((m) => ({ default: m.RestockRequestDetailPage })),
);
const UsersPage = lazy(() => import("./pages/users").then((m) => ({ default: m.UsersPage })));
const UserDetailPage = lazy(() =>
  import("./pages/user-detail").then((m) => ({ default: m.UserDetailPage })),
);
const ComponentsPage = lazy(() =>
  import("./pages/components-gallery").then((m) => ({ default: m.ComponentsPage })),
);
const SettingsPage = lazy(() =>
  import("./pages/settings").then((m) => ({ default: m.SettingsPage })),
);
const ProfilePage = lazy(() =>
  import("./pages/profile").then((m) => ({ default: m.ProfilePage })),
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
      // What the team's orders were expected to make (#78).
      { path: "revenue", element: <RevenuePage /> },
      // What the team spent that no order caused (#170).
      { path: "expenses", element: <ExpensesPage /> },
      // The two above, subtracted (#172) — the arithmetic happens on the client because neither
      // service may own a number derived from the other's data.
      { path: "profit", element: <ProfitPage /> },
      { path: "orders/new", element: <OrderCreatePage /> },
      { path: "orders/:orderId", element: <OrderDetailPage /> },
      // Drafts get their OWN route, not a tab on /orders (#195). A draft is not an order, and a tab
      // would put not-orders inside the orders screen — the same concern that gave them their own
      // table rather than an ORDER_STATUS_DRAFT.
      { path: "order-drafts", element: <OrderDraftsPage /> },
      // A detail view is a PAGE, not a dialog (CLAUDE.md) — and this one especially: mapping a
      // scraped line to a real product is work somebody sits down to, not a focused action.
      { path: "order-drafts/:draftId", element: <OrderDraftDetailPage /> },
      // The ledger of what teams owe each other (#185). Its own top-level section — a warehouse team
      // has no money screens at all today, and this gives it one.
      { path: "settlement", element: <SettlementPage /> },
      // A detail view is a PAGE, not a dialog (CLAUDE.md), reached by clicking a row.
      { path: "settlement/:counterpartyId", element: <CounterpartyPage /> },
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
      // The warehouse ACCEPTS a delivery here (#157) — a page, not a dialog.
      { path: "inventories/restock/:requestId/accept", element: <RestockAcceptPage /> },
      { path: "inventories/stock", element: <InventoryPage title="Stock" /> },
      // What a WAREHOUSE sees when it opens a product it handles (#158) — the stock, not the
      // catalogue entry it does not own.
      { path: "inventories/products/:productId", element: <WarehouseProductPage /> },
      { path: "inventories/placements", element: <PlacementsPage /> },
      { path: "inventories/suppliers", element: <SuppliersPage /> },
      { path: "inventories/suppliers/:supplierId", element: <SupplierDetailPage /> },
      // Racks are the warehouse's own shelves (#129) — the menu offers them to warehouse teams
      // only, but the route is open and the server's policy is what actually decides.
      // The crew's pick screens (#151). Static segment before the dynamic one.
      { path: "inventories/picking", element: <PickQueuePage /> },
      { path: "inventories/picking/:orderId", element: <PickOrderPage /> },
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
