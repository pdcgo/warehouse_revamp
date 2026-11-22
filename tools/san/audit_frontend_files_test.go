package main

import (
	"strings"
	"testing"
)

// auditFilesTree is a small checkout for --files: two audited pages (rack-detail; product-edit holding a shared
// picker that an unaudited page holds too), the shell (a sidebar the layout draws, taking a badge hook — the router
// imports the layout, never the sidebar — and AuthGate, which the router mounts outside any page), an api/ module,
// two backend services, and a story beside a page.
func auditFilesTree(t *testing.T) string {
	t.Helper()

	return fakeRepo(t, map[string]string{
		"proto/warehouse/inventory/v1/rack.proto": `syntax = "proto3";
package warehouse.inventory.v1;
service RackService {
  rpc RackDetail(RackDetailRequest) returns (RackDetailResponse);
  rpc RackStock(RackStockRequest) returns (RackStockResponse);
}
`,
		"proto/warehouse/category/v1/category.proto": `syntax = "proto3";
package warehouse.category.v1;
service CategoryService {
  rpc CategoryList(CategoryListRequest) returns (CategoryListResponse);
  rpc CategoryCreate(CategoryCreateRequest) returns (CategoryCreateResponse);
}
`,
		"backend/services/inventory_service/inventory_v1/rack_stock.go": `package inventory_v1
func (s *Service) RackStock() { stockRows() }
`,
		"backend/services/inventory_service/inventory_v1/rack_detail.go": `package inventory_v1
func (s *Service) RackDetail() {}
`,
		"backend/services/inventory_service/inventory_v1/helpers.go": `package inventory_v1
func stockRows() {}
`,
		"backend/services/inventory_service/db_migrations/00001_racks.sql": "-- +goose Up\n",
		"backend/services/category_service/category_v1/category_create.go": `package category_v1
func (s *Service) CategoryCreate() {}
`,
		"backend/cmd/shipment_service/service_api.go": "package main\n",
		"frontend/src/api/clients.ts": `import { createClient } from "@connectrpc/connect";
import { RackService } from "../gen/warehouse/inventory/v1/rack_pb";
export const rackClient = createClient(RackService, transport);
`,
		"frontend/src/router.tsx": `import { lazy } from "react";
import { AuthGate } from "./features/auth/AuthGate";
import { Layout } from "./layouts/Layout";
const RackDetailPage = lazy(() => import("./pages/rack-detail").then((m) => ({ default: m.RackDetailPage })));
const ProductEditPage = lazy(() => import("./pages/product-edit").then((m) => ({ default: m.ProductEditPage })));
const CategoriesPage = lazy(() => import("./pages/categories").then((m) => ({ default: m.CategoriesPage })));
export const router = createBrowserRouter([
  { path: "/", element: <AuthGate><Layout /></AuthGate>, children: [
      { path: "inventories/racks/:rackId", element: <RackDetailPage /> },
      { path: "products/:id/edit", element: <ProductEditPage /> },
      { path: "categories", element: <CategoriesPage /> },
  ] },
]);
`,
		"frontend/src/features/auth/AuthGate.tsx":            "export function AuthGate() { return null; }\n",
		"frontend/src/layouts/Layout.tsx":                    "import { Sidebar } from \"./Sidebar\";\nexport function Layout() { return <Sidebar />; }\n",
		"frontend/src/layouts/Sidebar.tsx":                   "import { useBadge } from \"../features/badges/useBadge\";\nexport function Sidebar() { useBadge(); }\n",
		"frontend/src/features/badges/useBadge.ts":           "export function useBadge() { return 1; }\n",
		"frontend/src/components/pickers/CategorySelect.tsx": "export function CategorySelect() { return null; }\n",
		"frontend/src/pages/rack-detail/index.tsx": `import { rackClient } from "../../api/clients";
export function RackDetailPage() { rackClient.rackDetail({}); }
`,
		"frontend/src/pages/rack-detail/index.stories.tsx": "import { RackDetailPage } from \"./index\";\n",
		"frontend/src/pages/product-edit/index.tsx": `import { CategorySelect } from "../../components/pickers/CategorySelect";
export function ProductEditPage() { return <CategorySelect />; }
`,
		"frontend/src/pages/categories/index.tsx": `import { CategorySelect } from "../../components/pickers/CategorySelect";
export function CategoriesPage() { return <CategorySelect />; }
`,
		"frontend/e2e/racks.spec.ts": "test(\"x\", async () => {});\n",
	})
}

var auditFilesScreens = []auditScreenDef{
	{Name: "rack-detail", Page: "rack-detail", Save: &auditInteraction{RPC: "RackService/RackMove"}},
	{Name: "product-edit", Page: "product-edit"},
}

// auditFilesBase is what the two screens were measured calling: rack-detail its rack reads, product-edit the
// category list — and both the shell's CheckAccess.
func auditFilesBase() map[string]auditMeasure {
	shell := map[string]int{"AuthService/CheckAccess": 1}

	return map[string]auditMeasure{
		"rack-detail":  {Screen: "rack-detail", ByMethod: map[string]int{"RackService/RackDetail": 1, "RackService/RackStock": 1}, ShellByMethod: shell},
		"product-edit": {Screen: "product-edit", ByMethod: map[string]int{"CategoryService/CategoryList": 1}, ShellByMethod: shell},
	}
}

// --files reaches screens through `san test affected`'s page mapping: a page file its page, a shared component the
// AUDITED screens holding it, the shell every screen, a backend file the screens whose measured requests call the
// RPCs its handlers reach — and a test, a tool, an unaudited page or another binary nothing.
func TestAuditFilesReachTheScreens(t *testing.T) {
	root := auditFilesTree(t)

	fx, err := newAuditFileIndex(root, auditFilesScreens, auditFilesBase())
	if err != nil {
		t.Fatal(err)
	}

	cases := []struct {
		name, file, want string
	}{
		{"a page file", "frontend/src/pages/rack-detail/index.tsx", "rack-detail"},
		{"a shared component: only the audited page holding it", "frontend/src/components/pickers/CategorySelect.tsx", "product-edit"},
		{"the shell: a layout", "frontend/src/layouts/Layout.tsx", "rack-detail product-edit"},
		{"the shell: a hook the sidebar takes", "frontend/src/features/badges/useBadge.ts", "rack-detail product-edit"},
		{"the shell: what the router mounts outside any page", "frontend/src/features/auth/AuthGate.tsx", "rack-detail product-edit"},
		{"the shell: api/", "frontend/src/api/clients.ts", "rack-detail product-edit"},
		{"the build", "frontend/vite.config.ts", "rack-detail product-edit"},
		{"the audit's own build config (keepNames)", "frontend/scripts/speed-audit/vite.audit.config.mjs", "rack-detail product-edit"},
		{"the audit's driver is a tool, not the bundle", "frontend/scripts/speed-audit/run.mjs", ""},
		{"a backend helper: the RPC its handler reaches", "backend/services/inventory_service/inventory_v1/helpers.go", "rack-detail"},
		{"a migration: every RPC of the service", "backend/services/inventory_service/db_migrations/00001_racks.sql", "rack-detail"},
		{"a backend handler no screen calls", "backend/services/category_service/category_v1/category_create.go", ""},
		{"a .proto", "proto/warehouse/category/v1/category.proto", "product-edit"},
		{"a story beside a page", "frontend/src/pages/rack-detail/index.stories.tsx", ""},
		{"an unaudited page", "frontend/src/pages/categories/index.tsx", ""},
		{"a tool", "tools/san/report.go", ""},
		{"another binary", "backend/cmd/shipment_service/service_api.go", ""},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			r := fx.file(c.file)

			got := strings.Join(r.Screens, " ")
			if got != c.want {
				t.Fatalf("%s reaches %q, want %q (%s)", c.file, got, c.want, r.How)
			}

			if r.How == "" {
				t.Errorf("%s: every file says how", c.file)
			}
		})
	}

	reach := fx.reach([]string{"frontend/src/components/pickers/CategorySelect.tsx", " tools/san/report.go "})
	if len(reach.Screens) != 1 || reach.Screens[0].Name != "product-edit" || len(reach.Files) != 2 {
		t.Fatalf("reach: %d screen(s) %+v, %d file(s)", len(reach.Screens), reach.Screens, len(reach.Files))
	}

	var b strings.Builder

	printAuditReach(&b, fx.reach([]string{"tools/san/report.go"}))

	if !strings.HasPrefix(b.String(), "audit --files: 1 file(s) reach no audited screen — nothing measured\n") {
		t.Errorf("a file reaching nothing is said in one line:\n%s", b.String())
	}
}

// measured builds a screen's measure from the parts a verdict reads.
func measured(screen string, requests int, byMethod map[string]int, chain ...int) auditMeasure {
	m := auditMeasure{Screen: screen, RequestsScreen: requests, ByMethod: byMethod, CountsAgree: true, WarmLoads: 5,
		UsableMS: auditSpread{Median: 400, Min: 390, Max: 420, N: 5}, ChainDepth: chain[0], ChainDepths: chain}

	return m
}

// The verdict applies a-slice-fixes-the-speed-regression-it-caused: a count worse is to be fixed in the slice
// (naming the screen, the measure, before → after and the RPCs), a slower time with counts unchanged is only
// reported, a problem the baseline already had is "already there", a better count is named — and a count that does
// not hold in every run of the measurement is not judged.
func TestAuditVerdictLines(t *testing.T) {
	rack := map[string]int{"RackService/RackDetail": 1, "RackService/RackHistory": 1}
	link := [][2]string{{"TeamService/TeamList", "WarehouseInfoService/WarehouseReceivingStatus"}}
	order := auditScreenDef{Name: "order-create", UnstableLinks: link}

	cases := []struct {
		name      string
		base, now auditMeasure
		def       auditScreenDef
		want      string // the kinds and measures, "kind measure; …"
		line      string // a part of the first line
	}{
		{
			name: "a count worse",
			base: measured("rack-detail", 2, rack, 2),
			now:  measured("rack-detail", 4, map[string]int{"RackService/RackDetail": 1, "RackService/RackHistory": 3}, 2),
			want: "FIX requests",
			line: "FIX       rack-detail · requests 2 → 4 · RPCs RackHistory ×3 — a count this slice made worse: fix it in this slice",
		},
		{
			name: "a new duplicate",
			base: measured("rack-detail", 2, rack, 2),
			now: func() auditMeasure {
				m := measured("rack-detail", 2, rack, 2)
				m.Duplicates, m.DuplicateOf = 1, []string{"RackService/RackHistory"}

				return m
			}(),
			want: "FIX duplicates",
			line: "duplicates 0 → 1 · RPCs RackHistory",
		},
		{
			name: "a slower time, counts unchanged",
			base: measured("rack-detail", 2, rack, 2),
			now: func() auditMeasure {
				m := measured("rack-detail", 2, rack, 2)
				m.UsableMS = auditSpread{Median: 900, Min: 880, Max: 950, N: 5}

				return m
			}(),
			want: "timing usable",
			line: "usable 400 ms → 900 ms — slower, counts unchanged: reported, not to fix",
		},
		{
			name: "a duplicate already in the baseline",
			base: func() auditMeasure {
				m := measured("warehouse-edit", 2, rack, 2)
				m.Duplicates, m.DuplicateOf = 1, []string{"WarehouseInfoService/WarehouseInfoDetail"}

				return m
			}(),
			now: func() auditMeasure {
				m := measured("warehouse-edit", 2, rack, 2)
				m.Duplicates, m.DuplicateOf = 1, []string{"WarehouseInfoService/WarehouseInfoDetail"}

				return m
			}(),
			want: "already duplicates",
			line: "already in the baseline: reported, never fixed unasked",
		},
		{
			name: "a better count",
			base: measured("rack-detail", 2, rack, 2),
			now:  measured("rack-detail", 1, map[string]int{"RackService/RackDetail": 1}, 2),
			want: "better requests",
			line: "better    rack-detail · requests 2 → 1 · RPCs RackHistory ×0 — better",
		},
		{
			name: "a deeper chain in every pass",
			base: measured("rack-detail", 2, rack, 2),
			now:  measured("rack-detail", 2, rack, 3, 3),
			want: "FIX chain",
			line: "chain 2 → 3",
		},
		{
			name: "a deeper chain in one pass of two",
			base: measured("order-create", 2, rack, 1),
			now:  measured("order-create", 2, rack, 2, 1),
			want: "unstable chain",
			line: "chain 1 → 2·1 — the dependency passes disagree",
		},
		{
			name: "a deeper chain through a link the screen declares unstable",
			base: measured("order-create", 2, rack, 1),
			now: func() auditMeasure {
				m := measured("order-create", 2, rack, 2, 2)
				m.Chains = [][]string{{"TeamService/TeamList", "WarehouseInfoService/WarehouseReceivingStatus"}}

				return m
			}(),
			def:  order,
			want: "unstable chain",
			line: "through a link this screen declares unstable",
		},
		{
			name: "requests grown by a method that differs between warm loads",
			base: measured("rack-detail", 2, rack, 2),
			now: func() auditMeasure {
				m := measured("rack-detail", 3, map[string]int{"RackService/RackDetail": 1, "RackService/RackHistory": 2}, 2)
				m.CountsAgree, m.Unstable = false, []string{"RackService/RackHistory"}

				return m
			}(),
			want: "unstable requests",
			line: "the methods that grew differ between warm loads",
		},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			def := c.def
			if def.Name == "" {
				def.Name = c.now.Screen
			}

			v := judgeAudit([]auditMeasure{c.now}, map[string]auditMeasure{c.base.Screen: c.base}, []auditScreenDef{def})

			var kinds []string
			for _, l := range v.Lines {
				kinds = append(kinds, l.Kind+" "+l.Measure)
			}

			got := strings.Join(kinds, "; ")
			if got != c.want {
				t.Fatalf("lines %q, want %q\n%s", got, c.want, v)
			}

			if !strings.Contains(v.Lines[0].String(), c.line) {
				t.Errorf("line %q, want it to hold %q", v.Lines[0].String(), c.line)
			}
		})
	}
}

// One summary line first, counting the changes and the screens with none, then one line per change.
func TestAuditVerdictSummary(t *testing.T) {
	rack := map[string]int{"RackService/RackDetail": 1}
	base := map[string]auditMeasure{
		"rack-detail":  measured("rack-detail", 1, rack, 1),
		"product-edit": measured("product-edit", 1, rack, 1),
		"profile":      measured("profile", 1, rack, 1),
	}

	worse := measured("rack-detail", 2, map[string]int{"RackService/RackDetail": 2}, 1)

	v := judgeAudit([]auditMeasure{worse, base["product-edit"], base["profile"]}, base, nil)

	want := "audit: 3 screen(s) · 1 count(s) worse (fix) · 0 timing · 2 unchanged"
	if v.Summary != want {
		t.Fatalf("summary %q, want %q", v.Summary, want)
	}

	if !strings.HasPrefix(v.String(), want+"\n  FIX       rack-detail · requests 1 → 2") {
		t.Errorf("the summary first, then a line per change:\n%s", v)
	}

	v = judgeAudit([]auditMeasure{measured("team-detail", 1, rack, 1)}, base, nil)
	if v.Summary != "audit: 1 screen(s) · 0 count(s) worse (fix) · 0 timing · 1 no baseline · 0 unchanged" {
		t.Errorf("a screen with no baseline: %q", v.Summary)
	}
}

// Each dependency pass reads its own depth: a wait measured in one pass and not the next shows as two depths.
func TestAuditChainDepthPerDependencyPass(t *testing.T) {
	reqs := []auditRawRequest{
		req("TeamService/TeamList", 0, 10),
		{Method: "WarehouseInfoService/WarehouseReceivingStatus", Start: 20, End: 30, After: []int{0},
			AfterPasses: [][]int{{0}, {}}},
	}

	raw := auditRawScreen{Name: "order-create", Loads: []auditRawLoad{
		{Kind: "warm", UsableMS: usable(400), Requests: reqs, Deps: true, DepPasses: 2},
	}}

	m := measureScreen(raw, auditScreenDef{}, nil, false, "2026-11-21")
	if m.ChainDepth != 2 || depthsText(m.ChainDepths) != "2·1" {
		t.Fatalf("depth %d, passes %v — want 2 and 2·1", m.ChainDepth, m.ChainDepths)
	}

	raw.Loads[0].DepPasses = 0
	m = measureScreen(raw, auditScreenDef{}, nil, false, "2026-11-21")

	if depthsText(m.ChainDepths) != "2" {
		t.Errorf("one pass recorded: %v, want one reading of 2", m.ChainDepths)
	}
}
