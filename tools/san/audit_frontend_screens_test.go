package main

import (
	"path/filepath"
	"strings"
	"testing"
)

// The screen table names screens the app really has: every page directory exists, every address is a route
// router.tsx renders that page on, every role is signed in by the seed, every ready test id is drawn by the app —
// over the REAL checkout, so a route renamed or a page moved fails here before a run reads it as "never usable". P1's
// ten keep their names and order (their baseline entries wait on the tester), and P4 adds the daily screens.
func TestAuditScreenTableMatchesTheApp(t *testing.T) {
	root, err := testRoot()
	if err != nil {
		t.Fatal(err)
	}

	problems, err := auditScreenProblems(root, auditScreens)
	if err != nil {
		t.Fatal(err)
	}

	for _, p := range problems {
		t.Error(p)
	}

	first := []string{"rack-detail", "restock-edit", "restock-new", "product-edit", "liability-detail", "profile",
		"warehouse-edit", "shop-detail", "order-create", "team-detail"}

	names := auditScreenNames()
	if len(names) < len(first)+35 {
		t.Fatalf("%d screens, want P1's %d and at least 35 daily ones", len(names), len(first))
	}

	if got := strings.Join(names[:len(first)], " "); got != strings.Join(first, " ") {
		t.Errorf("P1's screens moved: %s", got)
	}

	for _, s := range auditDailyScreens {
		if s.Phase != "P4" || s.Rows != "#126" {
			t.Errorf("%s: a daily screen names its phase and row (%q, %q)", s.Name, s.Phase, s.Rows)
		}
	}
}

// The check itself names each way a screen can miss the app: a route the page is not rendered on, a page directory
// that is not there, a ready test id the app never draws, a role nobody signs in as, a name used twice — and passes a
// screen behind a route component (RestockRoute picks the page by team type), the index route, and a query string.
func TestAuditScreenProblemsNamesWhatDoesNotMatch(t *testing.T) {
	root := fakeRepo(t, map[string]string{
		"frontend/src/router.tsx": `import { lazy } from "react";
const HomePage = lazy(() => import("./pages/home").then((m) => ({ default: m.HomePage })));
const OrdersPage = lazy(() => import("./pages/orders").then((m) => ({ default: m.OrdersPage })));
const RestockSellingPage = lazy(() => import("./pages/restock-selling").then((m) => ({ default: m.RestockSellingPage })));
const RestockWarehousePage = lazy(() => import("./pages/restock-warehouse").then((m) => ({ default: m.RestockWarehousePage })));
function RestockRoute() {
  return current ? <RestockWarehousePage /> : <RestockSellingPage />;
}
export const router = createBrowserRouter([
  { path: "/", element: <AppShell />, children: [
      { index: true, element: <HomePage /> },
      { path: "orders", element: <OrdersPage /> },
      { path: "orders/:orderId", element: <OrdersPage /> },
      { path: "inventories/restock", element: <RestockRoute /> },
  ] },
]);
`,
		"frontend/src/pages/home/index.tsx":              `export function HomePage() { return <p data-testid="home-team" />; }` + "\n",
		"frontend/src/pages/orders/index.tsx":            `export function OrdersPage() { return <div data-testid="orders-table" />; }` + "\n",
		"frontend/src/pages/orders/index.stories.tsx":    `export const S = <div data-testid="orders-ghost" />;` + "\n",
		"frontend/src/pages/restock-selling/index.tsx":   `export function RestockSellingPage() { return <div data-testid={"restock-selling-page"} />; }` + "\n",
		"frontend/src/pages/restock-warehouse/index.tsx": `export function RestockWarehousePage() { return null; }` + "\n",
		"frontend/src/pages/order-form/index.tsx":        `export const F = <div data-testid={edit ? "order-edit-page" : "order-new-page"} />;` + "\n",
	})

	screens := []auditScreenDef{
		{Name: "home", Page: "home", Route: "/", Role: "seller", Ready: `[data-testid="home-team"]`},
		{Name: "orders", Page: "orders", Route: "/orders?tab=all", Role: "seller", Ready: `[data-testid="orders-table"]`},
		{Name: "order", Page: "orders", Route: "/orders/{order}", Role: "seller", Ready: "main"},
		{Name: "restock-selling", Page: "restock-selling", Route: "/inventories/restock", Role: "seller"},
		{Name: "order-new", Page: "orders", Route: "/orders", Role: "seller", Ready: `[data-testid="order-new-page"]`},
		{Name: "wrong-route", Page: "orders", Route: "/order", Role: "seller", Ready: "main"},
		{Name: "no-page", Page: "drafts", Route: "/orders", Role: "seller", Ready: "main"},
		{Name: "restock-warehouse", Page: "restock-warehouse", Route: "/inventories/restock", Role: "wh_owner"},
		{Name: "a-story-id", Page: "orders", Route: "/orders", Role: "seller", Ready: `[data-testid="orders-ghost"]`},
		{Name: "nobody", Page: "home", Route: "/", Role: "picker", Ready: "main"},
		{Name: "home", Page: "home", Route: "/", Role: "seller", Ready: "main"},
	}

	problems, err := auditScreenProblems(root, screens)
	if err != nil {
		t.Fatal(err)
	}

	want := []string{
		"wrong-route: route /order is none of the routes router.tsx renders pages/orders on",
		"no-page: no page frontend/src/pages/drafts/index.tsx",
		`restock-warehouse: its usable rule waits on test id "restock-warehouse-page"`,
		`a-story-id: its usable rule waits on test id "orders-ghost"`,
		`nobody: role "picker" is no role the seed signs in`,
		"home: a second screen of that name",
	}

	if len(problems) != len(want) {
		t.Fatalf("%d problem(s), want %d:\n%s", len(problems), len(want), strings.Join(problems, "\n"))
	}

	for i, w := range want {
		if !strings.HasPrefix(problems[i], w) {
			t.Errorf("problem %d: %q, want it to start %q", i, problems[i], w)
		}
	}
}

// --files reaches every screen of the table through its own page (the REAL checkout's imports, `san test affected`'s
// mapping): a change to a daily screen's page is judged on that screen, a page two screens share on both — and a
// backend handler reaches a daily screen through the RPC its measured requests call.
func TestAuditFilesReachEveryScreenThroughItsPage(t *testing.T) {
	root, err := testRoot()
	if err != nil {
		t.Fatal(err)
	}

	base := map[string]auditMeasure{
		"expenses": {Screen: "expenses", ByMethod: map[string]int{"ExpenseService/ExpenseList": 1}},
	}

	fx, err := newAuditFileIndex(root, auditScreens, base)
	if err != nil {
		t.Fatal(err)
	}

	for _, s := range auditScreens {
		f := "frontend/src/pages/" + s.Page + "/index.tsx"

		r := fx.file(f)
		if !contains(r.Screens, s.Name) {
			t.Errorf("%s does not reach %s (it reaches %v — %s)", f, s.Name, r.Screens, r.How)
		}
	}

	shared := fx.file("frontend/src/pages/products/index.tsx")
	if !contains(shared.Screens, "products") || !contains(shared.Screens, "warehouse-products") {
		t.Errorf("the products page reaches both of its screens: %v", shared.Screens)
	}

	queue := fx.file("frontend/src/pages/pick-queue/index.tsx")
	if strings.Join(queue.Screens, " ") != "warehouse-orders" {
		t.Errorf("the warehouse's order queue reaches only its screen: %v (%s)", queue.Screens, queue.How)
	}

	handler := fx.file("backend/services/expense_service/expense_v1/expense_list.go")
	if !contains(handler.Screens, "expenses") {
		t.Errorf("ExpenseList's handler reaches the expenses screen: %v (%s)", handler.Screens, handler.How)
	}
}

// The template is rebuilt when ANY of the seed's Go files changes — P1's and P4's daily ground — and never for a test
// beside them.
func TestAuditTemplateFingerprintTakesEverySeedFile(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "tools", "san")
	daily := filepath.Join(dir, "audit_frontend_seed_daily.go")
	test := filepath.Join(dir, "audit_frontend_seed_daily_test.go")

	writeFile(t, filepath.Join(dir, "audit_frontend_seed.go"), "package main\n")
	writeFile(t, daily, "package main\n")
	writeFile(t, test, "package main\n")

	fp := func() string {
		got, err := auditTemplateFingerprint(root)
		if err != nil {
			t.Fatal(err)
		}

		return got
	}

	first := fp()

	writeFile(t, test, "package main // changed\n")

	if fp() != first {
		t.Fatal("a test beside the seed moved the fingerprint")
	}

	writeFile(t, daily, "package main // more orders\n")

	if fp() == first {
		t.Fatal("changing the daily seed did not move the fingerprint")
	}
}

// Every screen's address and steps are built from the seed's own ids — none left a {placeholder} once the seed made
// its ground — and the daily screens open the ids P4 seeded: the first order on the seller's page, the second on the
// crew's (its save moves that order on), the second open restock on the accept form (restock-edit saves the first).
func TestAuditPlaceholdersFillEveryScreen(t *testing.T) {
	ids := &auditSeedIDs{WarehouseTeam: 2, SellingTeam: 3, OpenRestock: 4, Racks: map[string]uint64{"A": 1, "B": 2},
		Users: map[string]string{"cs1": "auditcs1"}, UserIDs: map[string]uint64{"cs1": 12},
		Products: []uint64{21, 22}, Shops: []uint64{31}, Accepted: []uint64{41}, Open: []uint64{4, 5},
		Suppliers: []uint64{61}, Accounts: []uint64{71},
		Daily: &auditDailyIDs{Orders: []uint64{81, 82}, Batch: 91, OpnameSession: 92}}

	values := auditPlaceholders(ids)

	want := map[string]string{"order": "81", "warehouse_order": "82", "open_restock_2": "5", "accepted_restock": "41",
		"supplier": "61", "account": "71", "cs1_id": "12", "batch": "91", "opname_session": "92"}

	for k, v := range want {
		if values[k] != v {
			t.Errorf("{%s} = %q, want %q", k, values[k], v)
		}
	}

	seat := &auditSeat{APIPort: 8251, UIPort: 5251}
	plan := buildAuditPlan(seat, auditScreens, ids, map[string]string{}, 1, false)

	for _, s := range plan.Screens {
		left := []string{s.URL}
		if s.Save != nil {
			for _, st := range s.Save.Steps {
				left = append(left, st.TestID, st.Selector)
			}
		}

		for _, x := range left {
			if auditPlaceholderRe.MatchString(x) {
				t.Errorf("%s: %q keeps a placeholder", s.Name, x)
			}
		}
	}
}

// A screen's first History row names the phase that added it — P1's ten "first baseline (P1)", P4's daily screens
// "(P4)" — so the md says when the screen joined the audit.
func TestAuditFirstHistoryRowNamesThePhase(t *testing.T) {
	m := auditMeasure{Screen: "orders", RequestsScreen: 13}

	if got := historyRow(m, nil, "P4").Change; got != "first baseline (P4)" {
		t.Errorf("a daily screen's first row: %q", got)
	}

	if got := historyRow(m, nil, "").Change; got != "first baseline (P1)" {
		t.Errorf("a P1 screen's first row: %q", got)
	}

	prev := m
	if got := historyRow(m, &prev, "P4").Change; got != "no change past a threshold" {
		t.Errorf("a later row names what changed, not the phase: %q", got)
	}
}
