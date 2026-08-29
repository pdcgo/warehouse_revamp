import { lazy } from "react";
import { createBrowserRouter, redirect } from "react-router-dom";
import { AuthGate, ProtectedRoute } from "./features/auth/AuthGate";
import { LoginPage } from "./pages/login/index";
import { Layout } from "./layouts/Layout";
import { TeamProvider, useTeam } from "./features/team/TeamContext";
import { TeamType } from "./gen/warehouse/team/v1/team_pb";

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
const LiabilityListPage = lazy(() =>
  import("./pages/liability-list").then((m) => ({ default: m.LiabilityListPage })),
);
// The MARKETPLACE payout ledger — not liability above, which is what teams owe each other.
const SettlementListRoute = lazy(() =>
  import("./pages/order-settlement/SettlementListRoute").then((m) => ({
    default: m.SettlementListRoute,
  })),
);
const LiabilityDetailPage = lazy(() =>
  import("./pages/liability-detail").then((m) => ({ default: m.LiabilityDetailPage })),
);
const InventoryPage = lazy(() =>
  import("./pages/inventory").then((m) => ({ default: m.InventoryPage })),
);
const PlacementsPage = lazy(() =>
  import("./pages/placements").then((m) => ({ default: m.PlacementsPage })),
);
const ReturnsPage = lazy(() =>
  import("./pages/returns").then((m) => ({ default: m.ReturnsPage })),
);
const ReturnDetailPage = lazy(() =>
  import("./pages/return-detail").then((m) => ({ default: m.ReturnDetailPage })),
);
const OpnamePage = lazy(() =>
  import("./pages/opname").then((m) => ({ default: m.OpnamePage })),
);
const SuppliersPage = lazy(() =>
  import("./pages/suppliers").then((m) => ({ default: m.SuppliersPage })),
);
const SupplierDetailPage = lazy(() =>
  import("./pages/supplier-detail").then((m) => ({ default: m.SupplierDetailPage })),
);
const RacksPage = lazy(() => import("./pages/racks").then((m) => ({ default: m.RacksPage })));
const BatchesPage = lazy(() => import("./pages/batches").then((m) => ({ default: m.BatchesPage })));
const BatchDetailPage = lazy(() =>
  import("./pages/batch-detail").then((m) => ({ default: m.BatchDetailPage })),
);
const BatchReceiptPage = lazy(() =>
  import("./pages/batch-receipt").then((m) => ({ default: m.BatchReceiptPage })),
);
const WarehouseProductPage = lazy(() =>
  import("./pages/warehouse-product").then((m) => ({ default: m.WarehouseProductPage })),
);
const RestockAcceptPage = lazy(() =>
  import("./pages/restock-accept").then((m) => ({ default: m.RestockAcceptPage })),
);
const RestockLabelsPage = lazy(() =>
  import("./pages/restock-labels").then((m) => ({ default: m.RestockLabelsPage })),
);
const ExpensesPage = lazy(() =>
  import("./pages/expenses").then((m) => ({ default: m.ExpensesPage })),
);
const DailyStatementPage = lazy(() =>
  import("./pages/daily-statement").then((m) => ({ default: m.DailyStatementPage })),
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
const RestockSellingPage = lazy(() =>
  import("./pages/restock-selling").then((m) => ({ default: m.RestockSellingPage })),
);
const RestockWarehousePage = lazy(() =>
  import("./pages/restock-warehouse").then((m) => ({ default: m.RestockWarehousePage })),
);
const RestockRequestFormPage = lazy(() =>
  import("./pages/restock-request-form").then((m) => ({ default: m.RestockRequestFormPage })),
);
const RestockSellingDetailPage = lazy(() =>
  import("./pages/restock-selling-detail").then((m) => ({ default: m.RestockSellingDetailPage })),
);
const RestockWarehouseDetailPage = lazy(() =>
  import("./pages/restock-warehouse-detail").then((m) => ({
    default: m.RestockWarehouseDetailPage,
  })),
);
const UsersPage = lazy(() => import("./pages/users").then((m) => ({ default: m.UsersPage })));
const UserDetailPage = lazy(() =>
  import("./pages/user-detail").then((m) => ({ default: m.UserDetailPage })),
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

// /inventories/restock is TWO screens, chosen by the current team's type.
//
// A restock has two sides doing two different jobs — a selling team BUYS goods and wants to know
// what it has committed money to, a warehouse RECEIVES them and wants a work queue — and one table
// could not be honest about both, so they are separate pages (#105 / #133).
//
// They share ONE PATH deliberately, rather than getting a route each. The team switcher changes the
// current team WITHOUT navigating, so a per-type path would strand a person on the other side's
// screen the moment they switched teams — the URL would still say the page they were on while the
// data underneath had become somebody else's. One path means switching re-renders the right screen.
//
// Anything that is not a warehouse — selling, and root/admin looking on — gets the buying view: it
// is the side that ORIGINATES a restock, and root creates them (the e2e does exactly this).
function RestockRoute() {
  const { current } = useTeam();

  return current?.teamType === TeamType.WAREHOUSE ? <RestockWarehousePage /> : <RestockSellingPage />;
}

// …and so is /inventories/restock/:requestId, on the same rule and for the same reason.
//
// The list and the detail split together on purpose. Splitting only the list would have left every
// row opening back into the one page that tries to serve both sides — which is where the awkward
// gating lived: `showPlaces` (fulfilled AND the warehouse), a supplier field the warehouse could
// never resolve, a Cancel button hidden from half its readers. Choosing the page by team type
// deletes all of it, because each page is only ever read by one side.
function RestockDetailRoute() {
  const { current } = useTeam();

  return current?.teamType === TeamType.WAREHOUSE ? (
    <RestockWarehouseDetailPage />
  ) : (
    <RestockSellingDetailPage />
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
      // What the team spent that no order caused (#170).
      { path: "expenses", element: <ExpensesPage /> },
      // ⚠ /revenue and /profit are GONE with `revenue_service`, and there is deliberately no redirect:
      // both were made entirely of its expected margin, so there is nowhere truthful to send a reader.
      { path: "statement", element: <DailyStatementPage /> },
      { path: "orders/new", element: <OrderCreatePage /> },
      { path: "orders/:orderId", element: <OrderDetailPage /> },
      // The WAREHOUSE's orders (#151) — the ones shipping FROM this building, and the screen where the
      // crew records what it has done to each. Top-level and order-named, beside the selling team's
      // orders rather than buried under inventories: an order is the work, not a kind of stock.
      //
      // Its OWN path rather than a team-type branch on /orders, because the two are different screens —
      // /orders has shops, money and a New Order button that a warehouse team has none of. The detail
      // route /orders/:orderId above is shared: the crew that shipped an order can open and read it.
      { path: "warehouse-orders", element: <PickQueuePage /> },
      { path: "warehouse-orders/:orderId", element: <PickOrderPage /> },
      // Where these two used to live. A crew member with the old URL open — or bookmarked, or in
      // history — gets the screen rather than React Router's "Unexpected Application Error!", which
      // is what a removed route renders and reads as the app being broken.
      //
      // A LOADER redirect, not a <Navigate> element: this is a data router, so the redirect happens
      // before anything mounts and never flashes a frame of the wrong page.
      { path: "inventories/picking", loader: () => redirect("/warehouse-orders") },
      {
        path: "inventories/picking/:orderId",
        loader: ({ params }) => redirect(`/warehouse-orders/${params.orderId}`),
      },
      // Drafts get their OWN route, not a tab on /orders (#195). A draft is not an order, and a tab
      // would put not-orders inside the orders screen — the same concern that gave them their own
      // table rather than an ORDER_STATUS_DRAFT.
      { path: "order-drafts", element: <OrderDraftsPage /> },
      // A detail view is a PAGE, not a dialog (CLAUDE.md) — and this one especially: mapping a
      // scraped line to a real product is work somebody sits down to, not a focused action.
      { path: "order-drafts/:draftId", element: <OrderDraftDetailPage /> },
      // The ledger of what teams owe each other (#185). Its own top-level section — a warehouse team
      // has no money screens at all today, and this gives it one.
      //
      // ⚠ THERE IS NO `/settlement` ROUTE ANY MORE, and its absence is the point. The word now means
      // the MARKETPLACE PAYOUT, whose screens are being built and want exactly these paths. The two
      // superseded pages that lived here (#221/#222 replaced them) are deleted rather than left
      // reachable — a route nobody links to, serving an older version of a screen that still works,
      // is how two designs of one thing stay alive.
      { path: "liability", element: <LiabilityListPage /> },
      // `/settlement`, not `/order-settlement`: the directory is named for the GRAIN (one account
      // per order), the route for what the screen is to the person opening it.
      { path: "settlement", element: <SettlementListRoute /> },
      // A detail view is a PAGE, not a dialog (CLAUDE.md), reached by clicking a row (#222).
      { path: "liability/:counterpartyId", element: <LiabilityDetailPage /> },
      { path: "inventory", element: <InventoryPage /> },
      // The Inventories sub-menu (#95). Restock IS the request flow (#105/#122), and it is now TWO
      // screens behind ONE path — see RestockRoute. The on-hand list is "Stock" (it was only ever
      // called Restock under the superseded "pick a warehouse and receive there" design).
      // Placements is a stub.
      { path: "inventories/restock", element: <RestockRoute /> },
      // `new` is static and `:requestId` is dynamic, so React Router ranks `new` first regardless of
      // the order here — /inventories/restock/new stays the create form, not a detail of id "new".
      //
      // One page serves create and edit (#131): it reads the mode off :requestId. The two routes carry
      // distinct `key`s so that switching between them REMOUNTS rather than reconciles — same component
      // type at the same position otherwise keeps its state, which would carry a loaded request's
      // fields into a blank create form.
      { path: "inventories/restock/new", element: <RestockRequestFormPage key="create" /> },
      { path: "inventories/restock/:requestId", element: <RestockDetailRoute /> },
      { path: "inventories/restock/:requestId/edit", element: <RestockRequestFormPage key="edit" /> },
      // The warehouse ACCEPTS a delivery here (#157) — a page, not a dialog.
      { path: "inventories/restock/:requestId/accept", element: <RestockAcceptPage /> },
      // After accepting, print the shelf labels for what landed (#207) — the step after accept.
      { path: "inventories/restock/:requestId/labels", element: <RestockLabelsPage /> },
      // The goods-received receipt for the delivery (#219) — a printable document, reached from an
      // accepted restock and from a batch's Print receipt (?batch= highlights that product's line).
      { path: "inventories/restock/:requestId/receipt", element: <BatchReceiptPage /> },
      { path: "inventories/stock", element: <InventoryPage title="Stock" /> },
      // What a WAREHOUSE sees when it opens a product it handles (#158) — the stock, not the
      // catalogue entry it does not own.
      { path: "inventories/products/:productId", element: <WarehouseProductPage /> },
      { path: "inventories/placements", element: <PlacementsPage /> },
      { path: "inventories/returns", element: <ReturnsPage /> },
      // One return's receive & inspect record (#163) — reached by clicking a row; a PAGE, not a
      // dialog (CLAUDE.md).
      { path: "inventories/returns/:returnId", element: <ReturnDetailPage /> },
      { path: "inventories/opname", element: <OpnamePage /> },
      { path: "inventories/suppliers", element: <SuppliersPage /> },
      { path: "inventories/suppliers/:supplierId", element: <SupplierDetailPage /> },
      // Racks are the warehouse's own shelves (#129) — the menu offers them to warehouse teams
      // only, but the route is open and the server's policy is what actually decides.
      { path: "inventories/racks", element: <RacksPage /> },
      // Every stock batch in the warehouse (#209) — cost layers, browsable by receipt and expiry.
      { path: "inventories/batches", element: <BatchesPage /> },
      // One batch's living detail (#209) — reached by clicking a row; a PAGE, not a dialog (CLAUDE.md).
      { path: "inventories/batches/:batchId", element: <BatchDetailPage /> },
      // What is on one shelf, and how much (#138) — reached by clicking a rack in the list.
      { path: "inventories/racks/:rackId", element: <RackDetailPage /> },
      { path: "users", element: <UsersPage /> },
      { path: "users/:userId", element: <UserDetailPage /> },
      { path: "settings", element: <SettingsPage /> },
      { path: "profile", element: <ProfilePage /> },
    ],
  },
]);
