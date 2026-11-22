package main

// THE DAILY SCREENS (backlog #126, P4) — the main lists and the other screens a person works on every day, after
// P1's ten (audit_frontend_screens.go): router.tsx's routes, the menu nav.ts builds per team type and role, one role
// each — the one whose daily work the screen is. Each reads audit_frontend_seed_daily.go's ground (orders, drafts,
// expenses, found reports, a count) on top of P1's; its address is built from the seed's own ids.
//
// `ready` is the page's root test id where it has one; a page with none is waited on by the best stable element it
// already draws — its table, or `main` (the shell's page box: the lazy page's Suspense spinner, a list's skeleton
// and any request in flight all hold it unusable) — never by a test id added for the audit. A screen's one save is a
// cheap, repeatable write of its daily work (a note on an order, the order's next step); a list whose writes are
// creates in a dialog measures none.
//
// Skipped routes, each for a reason (docs/tools/san.md, audit frontend): /login (the audit signs in by token) and
// /connect-agent (an OAuth hand-off); warehouse-orders/print and inventories/restock/labels (print pages: a PDF built
// in the browser); products/archived (the products page with its archive flag), products/new (product-edit's create
// mode) and inventories/stock (a forwarder to /products or /inventory); every loader redirect; the setup screens
// (categories, shipping, settings, bundles), the cross-team discover pages and the reports read now and then
// (supplier report, account report, shop entries); and the screens that need a state the seed does not make (a
// transfer between two warehouses, a parcel, a return, an import file, a count in progress).

// auditMainReady is the shell's page box — the usable element of a page with no root test id of its own.
const auditMainReady = "main"

// auditNoRootID is said in the md of a page waited on by auditMainReady.
const auditNoRootID = "The page draws no root test id: usable waits on the shell's `main` (no loading marker, " +
	"nothing in flight) — the app is never edited for the audit."

var auditDailyScreens = []auditScreenDef{
	// ── the selling team (its owner) ──────────────────────────────────────────────────────────────
	{
		Name: "home", Page: "home", Route: "/", Role: "seller", Ready: `[data-testid="home-team"]`, Rows: "#126",
		Phase: "P4",
		Note:  "The page draws no root test id: usable waits on its team line (`home-team`).",
	},
	{
		Name: "products", Page: "products", Route: "/products", Role: "seller", Ready: `[data-testid="products-table"]`,
		Rows: "#126", Phase: "P4",
		Note: "The selling team's own catalogue (60 products, three pages); usable waits on its table (`products-table`).",
	},
	{Name: "product-detail", Page: "product-detail", Route: "/products/{product}", Role: "seller", Rows: "#126",
		Phase: "P4"},
	{
		Name: "orders", Page: "orders", Route: "/orders", Role: "seller", Ready: `[data-testid="orders-table"]`,
		Rows: "#126", Phase: "P4",
		Note: "The selling team's orders (SellerOrders, 25 seeded + any the order form placed); usable waits on its " +
			"table (`orders-table`).",
	},
	{
		Name: "order-detail", Page: "order-detail", Route: "/orders/{order}", Role: "seller", Rows: "#126", Phase: "P4",
		Save: &auditInteraction{
			Name:  "OrderNoteCreate (a note on the order)",
			Steps: []auditStep{stepFill("notes-input", "audit catatan"), stepClick("notes-add")},
			RPC:   "OrderService/OrderNoteCreate",
		},
	},
	{
		Name: "order-drafts", Page: "order-drafts", Route: "/order-drafts", Role: "seller",
		Ready: `[data-testid="order-drafts-table"]`, Rows: "#126", Phase: "P4",
		Note: "25 seeded drafts; usable waits on the table (`order-drafts-table`) — the page has no root test id.",
	},
	{Name: "restock-selling", Page: "restock-selling", Route: "/inventories/restock", Role: "seller", Rows: "#126",
		Phase: "P4"},
	{
		Name: "restock-selling-detail", Page: "restock-selling-detail", Route: "/inventories/restock/{accepted_restock}",
		Role: "seller", Ready: `[data-testid="restock-detail-page"]`, Rows: "#126", Phase: "P4",
	},
	{Name: "suppliers", Page: "suppliers", Route: "/inventories/suppliers", Role: "seller", Rows: "#126", Phase: "P4"},
	{Name: "supplier-detail", Page: "supplier-detail", Route: "/inventories/suppliers/{supplier}", Role: "seller",
		Rows: "#126", Phase: "P4"},
	{Name: "shops", Page: "shops", Route: "/shops", Role: "seller", Rows: "#126", Phase: "P4"},
	{Name: "financial-accounts", Page: "financial-accounts", Route: "/financial-accounts", Role: "seller",
		Rows: "#126", Phase: "P4"},
	{
		Name: "financial-account-detail", Page: "financial-account-detail", Route: "/financial-accounts/{account}",
		Role: "seller", Ready: `[data-testid="financial-account-page"]`, Rows: "#126", Phase: "P4",
		Note: "The first account: a capital deposit and 24 running costs on its log.",
	},
	{
		Name: "expenses", Page: "expenses", Route: "/expenses", Role: "seller", Ready: `[data-testid="expenses-table"]`,
		Rows: "#126", Phase: "P4",
		Note: "25 seeded expenses; usable waits on the table (`expenses-table`) — the page has no root test id. No " +
			"write measured: recording an expense is a create in a dialog.",
	},
	{
		Name: "settlement", Page: "order-settlement", Route: "/settlement", Role: "seller",
		Ready: `[data-testid="order-settlement-page"]`, Rows: "#126", Phase: "P4",
		Note: "One settlement account opened per seeded order (the order-placed event).",
	},
	{Name: "settlement-report", Page: "settlement-report", Route: "/settlement/report", Role: "seller", Rows: "#126",
		Phase: "P4"},
	{
		Name: "settlement-imports", Page: "settlement-imports", Route: "/settlement/imports", Role: "seller",
		Ready: `[data-testid="imports-table"]`, Rows: "#126", Phase: "P4",
		Note: "No import seeded (an import is a platform's file). Usable waits on the table (`imports-table`) — the " +
			"page has no root test id.",
	},
	{
		Name: "analytic", Page: "analytic", Route: "/analytic?g=shop&m=metrics/orders/created&r=7d", Role: "seller",
		Rows: "#126", Phase: "P4",
		Note: "Opened on a report — orders created, by shop, the last 7 days (the composer keeps its report in the " +
			"address: `g`, `m`, `r`): the bare /analytic asks nothing until a metric is picked.",
	},
	{
		Name: "users", Page: "users", Route: "/users", Role: "seller", Ready: auditMainReady, Rows: "#126",
		Phase: "P4", Note: auditNoRootID,
	},
	{Name: "user-detail", Page: "user-detail", Route: "/users/{cs1_id}", Role: "seller", Rows: "#126", Phase: "P4"},
	{
		Name: "transfers-selling", Page: "warehouse-transfer-selling", Route: "/inventories/transfer", Role: "seller",
		Ready: auditMainReady, Rows: "#126", Phase: "P4",
		Note: "No transfer seeded (one needs a second warehouse): the empty list's reads. " + auditNoRootID,
	},
	{
		Name: "custom-shipments-selling", Page: "custom-shipments", Route: "/inventories/custom-shipments",
		Role: "seller", Ready: auditMainReady, Rows: "#126", Phase: "P4",
		Note: "No parcel seeded: the empty list's reads. " + auditNoRootID,
	},

	// ── the warehouse (its owner; the crew for the order queue) ─────────────────────────────────
	{
		Name: "warehouse-orders", Page: "pick-queue", Route: "/warehouse-orders", Role: "wh_staff",
		Ready: `[data-testid="pick-queue-table"]`, Rows: "#126", Phase: "P4",
		Note: "The crew's order queue (25 seeded orders shipping from this warehouse); usable waits on the table " +
			"(`pick-queue-table`) — the page has no root test id.",
	},
	{
		Name: "warehouse-order", Page: "pick-order", Route: "/warehouse-orders/{warehouse_order}", Role: "wh_staff",
		Ready: `[data-testid="pick-list-table"]`, Rows: "#126", Phase: "P4",
		Save: &auditInteraction{
			Name:  "OrderStatusChange (the order's next step)",
			Steps: []auditStep{stepClick("pick-order-advance")},
			RPC:   "OrderService/OrderStatusChange",
		},
		Note: "One seeded order's pick page; usable waits on its pick list (`pick-list-table`) — the page has no root " +
			"test id.",
	},
	{
		Name: "restock-warehouse", Page: "restock-warehouse", Route: "/inventories/restock", Role: "wh_owner",
		Ready: `[data-testid="restock-inbound-page"]`, Rows: "#126", Phase: "P4",
	},
	{
		Name: "restock-warehouse-detail", Page: "restock-warehouse-detail",
		Route: "/inventories/restock/{accepted_restock}", Role: "wh_owner", Ready: `[data-testid="restock-detail-page"]`,
		Rows: "#126", Phase: "P4",
	},
	{
		Name: "restock-accept", Page: "restock-accept", Route: "/inventories/restock/{open_restock_2}/accept",
		Role: "wh_owner", Rows: "#126", Phase: "P4",
		Note: "An open restock's accept form (the second open one — restock-edit's is the first). No write measured: " +
			"the accept is the restock's one-way step.",
	},
	{Name: "racks", Page: "racks", Route: "/inventories/racks", Role: "wh_owner", Rows: "#126", Phase: "P4"},
	{Name: "batches", Page: "batches", Route: "/inventories/batches", Role: "wh_owner", Rows: "#126", Phase: "P4"},
	{Name: "batch-detail", Page: "batch-detail", Route: "/inventories/batches/{batch}", Role: "wh_owner",
		Rows: "#126", Phase: "P4"},
	{
		Name: "warehouse-products", Page: "products", Route: "/products", Role: "wh_owner", Rows: "#126", Phase: "P4",
		Note: "A warehouse's Products is what it holds (a-warehouses-products-is-what-it-holds) — the same page as the " +
			"selling team's, its warehouse branch.",
	},
	{Name: "warehouse-product", Page: "warehouse-product", Route: "/inventories/products/{product}", Role: "wh_owner",
		Rows: "#126", Phase: "P4"},
	{Name: "opname-sessions", Page: "opname-sessions", Route: "/inventories/opname/sessions", Role: "wh_owner",
		Rows: "#126", Phase: "P4"},
	{
		Name: "opname-session-detail", Page: "opname-session-detail",
		Route: "/inventories/opname/sessions/{opname_session}", Role: "wh_owner",
		Ready: `[data-testid="opname-detail-page"]`, Rows: "#126", Phase: "P4",
		Note: "The seeded count of rack J (open, nothing counted yet).",
	},
	{
		Name: "found-stock", Page: "found-requests", Route: "/inventories/found-stock", Role: "wh_owner",
		Ready: `[data-testid="found-requests-page"]`, Rows: "#126", Phase: "P4",
		Note: "Three seeded found reports waiting for the owner. No write measured: deciding opens the report first.",
	},
	{
		Name: "returns", Page: "returns", Route: "/inventories/returns", Role: "wh_owner",
		Ready: `[data-testid="return-list-page"]`, Rows: "#126", Phase: "P4",
		Note: "No return seeded: the empty list's reads.",
	},
	{
		Name: "statement", Page: "daily-statement", Route: "/statement", Role: "wh_owner", Ready: auditMainReady,
		Rows: "#126", Phase: "P4", Note: auditNoRootID,
	},
	{Name: "liability-list", Page: "liability-list", Route: "/liability", Role: "wh_owner", Rows: "#126",
		Phase: "P4"},

	// ── root ─────────────────────────────────────────────────────────────────────────────────────
	{
		Name: "teams", Page: "teams", Route: "/teams", Role: "root", Ready: auditMainReady, Rows: "#126", Phase: "P4",
		Note: auditNoRootID,
	},
	{
		Name: "inventory", Page: "inventory", Route: "/inventory?warehouse={warehouse_team}", Role: "root",
		Rows: "#126", Phase: "P4",
		Note: "Root's Inventory with the audit's warehouse picked (the `warehouse` the page keeps in its address).",
	},
}
