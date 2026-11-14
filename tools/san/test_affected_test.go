package main

import (
	"sort"
	"strings"
	"testing"
)

// affectedTree is a small checkout: one RPC service with three RPCs, two pages calling them through a
// hook module, a shared component, a sidebar importing the same hook module, and four specs.
func affectedTree(t *testing.T) string {
	t.Helper()

	return fakeRepo(t, map[string]string{
		"proto/warehouse/inventory/v1/rack.proto": `syntax = "proto3";
package warehouse.inventory.v1;
service RackService {
  rpc RackList(RackListRequest) returns (RackListResponse);
  rpc RackHistory(RackHistoryRequest) returns (RackHistoryResponse);
  rpc RackCreate(RackCreateRequest) returns (RackCreateResponse);
}
`,
		"backend/services/inventory_service/inventory_v1/rack_list.go": `package inventory_v1
func (s *Service) RackList() { rows := listRacks(); _ = rows }
`,
		"backend/services/inventory_service/inventory_v1/rack_create.go": `package inventory_v1
func (s *Service) RackCreate() { validateCode() }
`,
		// A LOCAL named like the helper is not a call of the helper.
		"backend/services/inventory_service/inventory_v1/rack_history.go": `package inventory_v1
func (s *Service) RackHistory() { listRacks := 1; _ = listRacks; s.row.validate = nil }
`,
		"backend/services/inventory_service/inventory_v1/helpers.go": `package inventory_v1
func listRacks() []int { return nil }
func validateCode() {}
`,
		"backend/services/inventory_service/inventory_v1/listener.go": `package inventory_v1
func handleEvent() {}
`,
		"frontend/src/api/clients.ts": `import { createClient } from "@connectrpc/connect";
import { RackService } from "../gen/warehouse/inventory/v1/rack_pb";
export const rackClient = createClient(RackService, transport);
`,
		"frontend/src/router.tsx": `import { lazy } from "react";
const RacksPage = lazy(() => import("./pages/racks").then((m) => ({ default: m.RacksPage })));
const RackDetailPage = lazy(() =>
  import("./pages/rack-detail").then((m) => ({ default: m.RackDetailPage })),
);
function RackRoute() {
  return current ? <RackDetailPage /> : <RacksPage />;
}
export const router = createBrowserRouter([
  { path: "/", element: <Shell />, children: [
      { path: "inventories/racks", element: <RacksPage /> },
      { path: "inventories/racks/:rackId", element: write(<RackDetailPage />) },
      { path: "racks-either", element: <RackRoute /> },
  ] },
]);
`,
		"frontend/src/features/racks/queries.ts": `import { rackClient } from "../../api/clients";
export function useRackList() {
  return rackClient.rackList({});
}
export function useRackHistory() {
  return rackClient.rackHistory({});
}
`,
		"frontend/src/pages/racks/index.tsx": `import { useRackList } from "../../features/racks/queries";
export function RacksPage() {
  useRackList();
  return <div data-testid="racks-page" />;
}
`,
		"frontend/src/pages/rack-detail/index.tsx": `import { useRackHistory } from "../../features/racks/queries";
import { RackBadge } from "../../components/RackBadge";
export function RackDetailPage() {
  useRackHistory();
  return <RackBadge />;
}
`,
		"frontend/src/components/RackBadge.tsx": "export function RackBadge() {\n  return <span data-testid={`rack-badge-${id}`} />;\n}\n",
		"frontend/src/layouts/Sidebar.tsx": `import { useRackList } from "../features/racks/queries";
export function Sidebar() { useRackList(); }
`,
		"frontend/src/features/racks/storyHelper.ts":   "export const storyRack = 1;\n",
		"frontend/src/features/racks/Rack.stories.tsx": "import { storyRack } from \"./storyHelper\";\n",
		"frontend/e2e/helpers.ts":                      "export function call() {}\n",
		"frontend/e2e/racks_list.spec.ts":              "test(\"x\", async ({ page }) => { await page.goto(\"/inventories/racks?tab=all\"); });\n",
		"frontend/e2e/rack_detail.spec.ts":             "test(\"x\", async ({ page }) => { await page.goto(`/inventories/racks/${id}`); page.getByTestId(`rack-badge-${id}`); });\n",
		"frontend/e2e/rack_api.spec.ts":                "import { call } from \"./helpers\";\ntest(\"x\", async ({ page }) => { await call(page, \"inventory.v1.RackService/RackCreate\", {}); });\n",
		"frontend/e2e/other.spec.ts":                   "test(\"x\", async ({ page }) => { await page.goto(\"/orders\"); await expect(page).toHaveURL(/\\/orders\\/\\d+/); });\n",
		"frontend/e2e/affected.txt":                    "# comment\nbackend/services/inventory_service/**/listener.go -> other.spec.ts   # an event's listener\n",
	})
}

func affectedSpecs(t *testing.T, root string, files ...string) (*affectedResult, string) {
	t.Helper()

	res, err := findAffected(root, files)
	if err != nil {
		t.Fatal(err)
	}

	var specs []string
	for s := range res.Specs {
		specs = append(specs, s)
	}

	sort.Strings(specs)

	return res, strings.Join(specs, " ")
}

func TestAffectedFinder(t *testing.T) {
	root := affectedTree(t)

	cases := []struct {
		name  string
		file  string
		specs string
	}{
		// helpers.go's listRacks reaches RackList (not RackHistory, whose `listRacks` is a local), and
		// validateCode reaches RackCreate: the page calling RackList, and the spec calling RackCreate.
		{"a Go helper", "backend/services/inventory_service/inventory_v1/helpers.go", "rack_api.spec.ts racks_list.spec.ts"},
		{"a handler", "backend/services/inventory_service/inventory_v1/rack_history.go", "rack_detail.spec.ts"},
		// Nothing reaches the listener: affected.txt names its spec.
		{"what only the mapping knows", "backend/services/inventory_service/inventory_v1/listener.go", "other.spec.ts"},
		{"a .proto", "proto/warehouse/inventory/v1/rack.proto", "rack_api.spec.ts rack_detail.spec.ts racks_list.spec.ts"},
		// The hook module: each page by the hook it takes; the sidebar (the shell) does not make every route affected.
		{"a hook module", "frontend/src/features/racks/queries.ts", "rack_detail.spec.ts racks_list.spec.ts"},
		{"a page", "frontend/src/pages/racks/index.tsx", "racks_list.spec.ts"},
		{"a shared component, by import and by test id", "frontend/src/components/RackBadge.tsx", "rack_detail.spec.ts"},
		{"a spec", "frontend/e2e/other.spec.ts", "other.spec.ts"},
		{"an e2e helper", "frontend/e2e/helpers.ts", "rack_api.spec.ts"},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			res, got := affectedSpecs(t, root, c.file)
			if got != c.specs {
				t.Fatalf("specs %q, want %q\nreasons: %v\nuntraced: %v", got, c.specs, res.Specs, res.Untraced)
			}

			for spec, reasons := range res.Specs {
				if len(reasons) == 0 || !strings.Contains(reasons[0], "←") {
					t.Errorf("%s: every spec says why, naming the file: %v", spec, reasons)
				}
			}
		})
	}
}

func TestAffectedSortsWhatNoSpecRuns(t *testing.T) {
	root := affectedTree(t)

	res, specs := affectedSpecs(t, root,
		"frontend/src/features/racks/storyHelper.ts",
		"frontend/src/features/racks/Rack.stories.tsx",
		"backend/services/inventory_service/inventory_v1/helpers_test.go",
		"tools/san/report.go",
		"frontend/src/lib/unused.ts",
	)

	if specs != "" {
		t.Errorf("specs %q, want none", specs)
	}

	if strings.Join(res.TestOnly, " ") != "frontend/src/features/racks/storyHelper.ts frontend/src/features/racks/Rack.stories.tsx "+
		"backend/services/inventory_service/inventory_v1/helpers_test.go" {
		t.Errorf("test only: %v", res.TestOnly)
	}

	if strings.Join(res.NotE2E, " ") != "tools/san/report.go" {
		t.Errorf("not e2e: %v", res.NotE2E)
	}

	if strings.Join(res.Untraced, " ") != "frontend/src/lib/unused.ts" {
		t.Errorf("untraced: %v", res.Untraced)
	}
}

func TestParseRoutes(t *testing.T) {
	root := affectedTree(t)

	ix, err := indexFrontend(root)
	if err != nil {
		t.Fatal(err)
	}

	got := strings.Join(ix.routes["rack-detail"], " ")
	if got != "/inventories/racks/:rackId /racks-either" {
		t.Errorf("rack-detail routes %q (a route component in router.tsx renders both pages)", got)
	}
}

func TestPathMatches(t *testing.T) {
	cases := []struct {
		route, visited string
		prefix, want   bool
	}{
		{"/inventories/racks/:rackId", "/inventories/racks/*", false, true},
		{"/inventories/racks/:rackId", "/inventories/racks/12", false, true},
		{"/inventories/racks/:rackId", "/inventories/racks", false, false},
		{"/inventories/racks", "/inventories/racks/12", false, false},
		{"/orders/:orderId/edit", "/orders/*", true, true},
		{"/orders", "/orders/*", true, false},
		{"/", "/", false, true},
	}

	for _, c := range cases {
		if got := pathMatches(c.route, c.visited, c.prefix); got != c.want {
			t.Errorf("pathMatches(%q, %q, %v) = %v", c.route, c.visited, c.prefix, got)
		}
	}
}

func TestTestidMatching(t *testing.T) {
	src := sourceTestids("<a data-testid=\"order-row-total\" />\n<b data-testid={`order-line-${id}`} />\n<c testId=\"plain\" />\n<d data-testid={`${x}-value`} />")

	cases := []struct {
		spec string
		want bool
	}{
		{`page.getByTestId("order-row-total")`, true},
		{"page.getByTestId(`order-line-${line.id}`)", true},
		{`page.getByTestId(/^order-line-/)`, true},
		{`page.locator('[data-testid^="order-row"]')`, true},
		{`helper(page, "order-line-7")`, true},
		{`page.getByTestId("something-else")`, false},
		// "-value" alone names too little.
		{`page.locator('[data-testid$="-value"]')`, false},
	}

	for _, c := range cases {
		sp := indexSpec("x.spec.ts", c.spec)
		if got := sp.usesTestid(src) != ""; got != c.want {
			t.Errorf("%s: %v", c.spec, got)
		}
	}
}

func TestGlobMatch(t *testing.T) {
	cases := []struct {
		glob, path string
		want       bool
	}{
		{"proto/warehouse/events/**", "proto/warehouse/events/v1/event.proto", true},
		{"backend/services/*/x.go", "backend/services/a_service/x.go", true},
		{"backend/services/*/x.go", "backend/services/a_service/sub/x.go", false},
		{"backend/**/listener.go", "backend/services/a/b/listener.go", true},
		{"frontend/src/i18n/**", "frontend/src/lib/x.ts", false},
	}

	for _, c := range cases {
		if got := globMatch(c.glob, c.path); got != c.want {
			t.Errorf("globMatch(%q, %q) = %v", c.glob, c.path, got)
		}
	}
}
