package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// writeTree writes files (repo-relative path → content) under root.
func writeTree(t *testing.T, root string, files map[string]string) {
	t.Helper()

	for p, content := range files {
		full := filepath.Join(root, filepath.FromSlash(p))

		err := os.MkdirAll(filepath.Dir(full), 0o755)
		if err != nil {
			t.Fatal(err)
		}

		err = os.WriteFile(full, []byte(content), 0o644)
		if err != nil {
			t.Fatal(err)
		}
	}
}

// fakeRepo is the smallest tree findRepoRoot accepts, plus the files given.
func fakeRepo(t *testing.T, files map[string]string) string {
	t.Helper()

	root := t.TempDir()
	base := map[string]string{
		"go.mod":                      "module example.com/x\n",
		"backend/services/.keep":      "",
		"frontend/e2e/smoke.txt":      "## sign in\nauth.spec.ts › signs in\n",
		"frontend/e2e/auth.spec.ts":   "test(\"signs in\", async () => {});\n",
		"frontend/src/router.tsx":     "export const router = [];\n",
		"frontend/src/api/clients.ts": "",
	}

	for p, c := range files {
		base[p] = c
	}

	writeTree(t, root, base)

	return root
}

func TestFingerprintHashesSourcesAndSkipsBuildOutput(t *testing.T) {
	root := fakeRepo(t, map[string]string{
		"backend/services/a_service/a.go":                      "package a\n",
		"backend/gen/warehouse/a.pb.go":                        "generated\n",
		"frontend/src/pages/x/index.tsx":                       "export {}\n",
		"frontend/src/gen/warehouse/a_pb.ts":                   "generated\n",
		"frontend/node_modules/react/index.js":                 "x\n",
		"frontend/src/pages/x/node_modules/y.js":               "x\n",
		"frontend/dist/index.js":                               "x\n",
		"backend/app_development.exe":                          "bin\n",
		"frontend/e2e/.e2e-lock":                               "{}",
		"frontend/tsconfig.tsbuildinfo":                        "x",
		"proto/warehouse/a/v1/a.proto":                         "syntax = \"proto3\";\n",
		"docs/not_fingerprinted.md":                            "doc\n",
		"frontend/.storybook/stub.ts":                          "x\n",
		"tools/san/x.go":                                       "package main\n",
		"e2e_report/last_green.json":                           "{}",
		"backend/services/a_service/db_migrations/00001_a.sql": "CREATE TABLE a (id int);\n",
	})

	fp, err := takeFingerprint(root)
	if err != nil {
		t.Fatal(err)
	}

	for _, want := range []string{
		"backend/services/a_service/a.go", "frontend/src/pages/x/index.tsx", "proto/warehouse/a/v1/a.proto",
		"frontend/.storybook/stub.ts", "tools/san/x.go", "go.mod",
		"backend/services/a_service/db_migrations/00001_a.sql",
	} {
		if fp.Files[want] == "" {
			t.Errorf("%s should be fingerprinted", want)
		}
	}

	for _, skipped := range []string{
		"backend/gen/warehouse/a.pb.go", "frontend/src/gen/warehouse/a_pb.ts", "frontend/node_modules/react/index.js",
		"frontend/src/pages/x/node_modules/y.js", "frontend/dist/index.js", "backend/app_development.exe",
		"frontend/e2e/.e2e-lock", "docs/not_fingerprinted.md", "e2e_report/last_green.json",
	} {
		if _, ok := fp.Files[skipped]; ok {
			t.Errorf("%s should not be fingerprinted", skipped)
		}
	}
}

// A file whose only difference is its line endings is the same file — a Windows and a Linux checkout
// of one commit fingerprint alike.
func TestFingerprintReadsCRLFAsLF(t *testing.T) {
	a := fakeRepo(t, map[string]string{"backend/x.go": "package x\n\nfunc A() {}\n"})
	b := fakeRepo(t, map[string]string{"backend/x.go": "package x\r\n\r\nfunc A() {}\r\n"})

	fa, err := takeFingerprint(a)
	if err != nil {
		t.Fatal(err)
	}

	fb, err := takeFingerprint(b)
	if err != nil {
		t.Fatal(err)
	}

	if fa.Files["backend/x.go"] != fb.Files["backend/x.go"] {
		t.Fatal("CRLF and LF copies of one file hash differently")
	}
}

func TestDiffFingerprints(t *testing.T) {
	old := &Fingerprint{Files: map[string]string{"a": "1", "b": "2", "c": "3"}}
	cur := &Fingerprint{Files: map[string]string{"a": "1", "b": "9", "d": "4"}}

	d := diffFingerprints(old, cur)

	if strings.Join(d.Changed, ",") != "b" || strings.Join(d.Added, ",") != "d" || strings.Join(d.Deleted, ",") != "c" {
		t.Fatalf("diff = %+v", d)
	}

	if d.Count() != 3 || strings.Join(d.All(), ",") != "b,c,d" {
		t.Fatalf("count/all = %d %v", d.Count(), d.All())
	}

	if !diffFingerprints(cur, cur).Empty() {
		t.Fatal("a fingerprint differs from itself")
	}
}

func TestClassifyPath(t *testing.T) {
	cases := []struct {
		path, area, risk string
	}{
		{"frontend/src/components/pickers/X.tsx", "shared components", riskWide},
		{"frontend/src/components/pickers/X.stories.tsx", "shared components", riskLow},
		{"frontend/src/layouts/nav.ts", "layout & menu", riskWide},
		{"frontend/src/router.tsx", "app shell", riskWide},
		{"frontend/src/api/clients.ts", "app shell", riskWide},
		{"frontend/src/features/auth/AuthGate.tsx", "sign-in", riskWide},
		{"frontend/src/pages/login/index.tsx", "sign-in", riskWide},
		{"backend/services/user_service/access_interceptors/policy.go", "sign-in", riskWide},
		{"backend/services/user_service/user_v1/login.go", "sign-in", riskWide},
		{"backend/services/user_service/user_v1/create_user.go", "user_service", riskNormal},
		{"backend/pkgs/san_auth/x.go", "sign-in", riskWide},
		{"proto/warehouse/role_base/v1/role.proto", "sign-in", riskWide},
		{"frontend/e2e/global-setup.ts", "e2e setup", riskWide},
		{"frontend/e2e/fixtures/regions.csv", "e2e setup", riskWide},
		{"frontend/playwright.config.ts", "e2e setup", riskWide},
		{"tools/san/migrate.go", "e2e setup", riskWide},
		{"tools/san/report.go", "tools/san", riskNormal},
		{"tools/san/migrate_test.go", "tools/san", riskLow},
		{"frontend/e2e/orders.spec.ts", "e2e specs", riskLow},
		{"frontend/e2e/smoke.txt", "test plan", riskLow},
		{"frontend/.storybook/stubTransport.ts", "storybook", riskLow},
		{"frontend/src/pages/restock-form/index.tsx", "page restock-form", riskNormal},
		{"frontend/src/pages/restock-form/index.stories.tsx", "page restock-form", riskLow},
		{"frontend/src/features/restock/queries.ts", "feature restock", riskNormal},
		{"frontend/src/lib/money.ts", "frontend lib", riskNormal},
		{"frontend/src/lib/money.test.ts", "frontend lib", riskLow},
		{"backend/services/inventory_service/inventory_v1/x.go", "inventory_service", riskNormal},
		{"backend/services/inventory_service/inventory_v1/x_test.go", "inventory_service", riskLow},
		{"backend/services/inventory_service/db_migrations/00041_x.sql", "inventory_service", riskNormal},
		{"proto/warehouse/inventory/v1/rack.proto", "inventory_service", riskNormal},
		{"proto/warehouse/events/v1/event.proto", "events", riskNormal},
		{"backend/pkgs/san_money/money.go", "pkg san_money", riskNormal},
		{"backend/cmd/app_development/wire.go", "composition root", riskNormal},
		{"go.sum", "go modules", riskNormal},
		{"frontend/package.json", "frontend build", riskNormal},
	}

	for _, c := range cases {
		got := classifyPath(c.path)
		if got.Area != c.area || got.Risk != c.risk {
			t.Errorf("%s: got %s/%s, want %s/%s", c.path, got.Area, got.Risk, c.area, c.risk)
		}

		if got.Risk == riskWide && got.Reason == "" {
			t.Errorf("%s: a wide change needs its reason", c.path)
		}
	}
}

const protoBefore = `syntax = "proto3";
package warehouse.inventory.v1;

service RackService {
  rpc RackCreate(RackCreateRequest) returns (RackCreateResponse);
  rpc RackList(RackListRequest) returns (RackListResponse) {
    option idempotency_level = NO_SIDE_EFFECTS;
  }
}

message RackCreateRequest {
  option (warehouse.role_base.v1.request_policy) = {
    roles: [ROLE_WAREHOUSE_OWNER, ROLE_WAREHOUSE_ADMIN]
  };
  uint64 team_id = 1 [(buf.validate.field).uint64.gt = 0];
  string code = 2; // a comment with { braces ; and semicolons
  string note = 3 [(buf.validate.field).string.max_len = 200];
  /* block
     comment */
  message Inner {
    string name = 1;
  }
  oneof kind {
    string a = 4;
  }
}

enum RackKind {
  RACK_KIND_UNSPECIFIED = 0;
}
`

func TestParseProto(t *testing.T) {
	pf := parseProto(protoBefore)

	if pf.Package != "warehouse.inventory.v1" {
		t.Errorf("package = %q", pf.Package)
	}

	if len(pf.RPCs) != 2 || pf.RPCs[0].Name != "RackCreate" || pf.RPCs[1].Name != "RackList" ||
		pf.RPCs[0].Request != "RackCreateRequest" || pf.RPCs[0].Service != "RackService" {
		t.Errorf("rpcs = %+v", pf.RPCs)
	}

	msg := pf.Messages["RackCreateRequest"]
	if msg == nil {
		t.Fatal("RackCreateRequest not read")
	}

	for _, f := range []string{"team_id", "code", "note", "a"} {
		if _, ok := msg.Fields[f]; !ok {
			t.Errorf("field %s not read (oneof arms belong to the message)", f)
		}
	}

	if !strings.Contains(msg.policyText(), "ROLE_WAREHOUSE_ADMIN") {
		t.Errorf("policy = %q", msg.policyText())
	}

	if pf.Messages["RackCreateRequest.Inner"] == nil {
		t.Error("nested message not read")
	}

	if !requiresValue(msg.Fields["team_id"].Options) || requiresValue(msg.Fields["note"].Options) {
		t.Errorf("team_id %q / note %q", msg.Fields["team_id"].Options, msg.Fields["note"].Options)
	}
}

func TestProtoWideReasons(t *testing.T) {
	old := parseProto(protoBefore)

	cases := []struct {
		name string
		edit func(string) string
		want string // "" = no wide change
	}{
		{"a comment changed", func(s string) string { return strings.Replace(s, "a comment", "another comment", 1) }, ""},
		{"a new optional field", func(s string) string {
			return strings.Replace(s, "  string note = 3", "  string extra = 9;\n  string note = 3", 1)
		}, ""},
		{"a new message", func(s string) string {
			return s + "\nmessage Fresh { string x = 1 [(buf.validate.field).required = true]; }\n"
		}, ""},
		{"an existing field made required", func(s string) string {
			return strings.Replace(s, "string code = 2;", "string code = 2 [(buf.validate.field).string.min_len = 1];", 1)
		}, "an existing field made required: RackCreateRequest.code"},
		{"a new required field on an existing message", func(s string) string {
			return strings.Replace(s, "  string note = 3", "  string key = 9 [(buf.validate.field).required = true];\n  string note = 3", 1)
		}, "a new required field on an existing message: RackCreateRequest.key"},
		{"a role added to the policy", func(s string) string {
			return strings.Replace(s, "ROLE_WAREHOUSE_ADMIN]", "ROLE_WAREHOUSE_ADMIN, ROLE_WAREHOUSE_STAFF]", 1)
		}, "permissions: RackCreateRequest's request_policy changed"},
	}

	for _, c := range cases {
		got := protoWideReasons("proto/warehouse/inventory/v1/rack.proto", old, parseProto(c.edit(protoBefore)))

		if c.want == "" {
			if len(got) != 0 {
				t.Errorf("%s: want no wide change, got %v", c.name, got)
			}

			continue
		}

		if len(got) != 1 || got[0] != c.want {
			t.Errorf("%s: got %v, want [%s]", c.name, got, c.want)
		}
	}

	if protoWideReasons("x.proto", nil, old) != nil {
		t.Error("a new .proto file changes no existing contract")
	}
}

const eventsBefore = `syntax = "proto3";
package warehouse.events.v1;
message Event {
  string event_id = 1;
  oneof message {
    OrderPlaced order_placed = 10;
  }
}
message OrderPlaced {
  option (event_config).topic = "order-placed";
  uint64 order_id = 1;
  string shop = 2;
}
`

func TestEventContents(t *testing.T) {
	old := parseProto(eventsBefore)
	path := "proto/warehouse/events/v1/event.proto"

	// A new event: a new variant and a new arm of the envelope — nobody's contents changed.
	added := strings.Replace(eventsBefore, "OrderPlaced order_placed = 10;", "OrderPlaced order_placed = 10;\n    Fresh fresh = 11;", 1) +
		"message Fresh {\n  option (event_config).topic = \"fresh\";\n  uint64 id = 1;\n}\n"
	if got := protoWideReasons(path, old, parseProto(added)); len(got) != 0 {
		t.Errorf("a new event: %v", got)
	}

	for name, edited := range map[string]string{
		"a field added":   strings.Replace(eventsBefore, "string shop = 2;", "string shop = 2;\n  uint64 team_id = 3;", 1),
		"a field removed": strings.Replace(eventsBefore, "string shop = 2;\n", "", 1),
		"a type changed":  strings.Replace(eventsBefore, "string shop = 2;", "uint64 shop = 2;", 1),
	} {
		got := protoWideReasons(path, old, parseProto(edited))
		if len(got) != 1 || !strings.HasPrefix(got[0], "an event's contents: OrderPlaced") {
			t.Errorf("%s: %v", name, got)
		}
	}
}

func TestMigrationAltersExisting(t *testing.T) {
	cases := []struct {
		name, sql, want string
	}{
		{"a new table", "-- +goose Up\nCREATE TABLE a (id bigint);\nCREATE INDEX a_i ON a (id);\n-- +goose Down\nDROP TABLE a;\n", ""},
		{"a new table altered in its own file", "-- +goose Up\nCREATE TABLE IF NOT EXISTS a (id bigint);\nALTER TABLE a ADD COLUMN b int;\n", ""},
		{"a column added to an existing table", "-- +goose Up\nALTER TABLE public.orders ADD COLUMN k text;\n-- +goose Down\nALTER TABLE orders DROP COLUMN k;\n", "orders"},
		{"an existing table dropped", "-- +goose Up\nDROP TABLE IF EXISTS \"legacy\", other CASCADE;\n", "legacy, other"},
		{"a unique index on an existing table", "-- +goose Up\nCREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS u ON ONLY orders (k);\n", "orders"},
		{"only the Down half alters", "-- +goose Up\nCREATE TABLE z (id int);\n-- +goose Down\nALTER TABLE orders DROP COLUMN x;\n", ""},
		{"a commented-out alter", "-- +goose Up\n-- ALTER TABLE orders ADD COLUMN x int;\nCREATE TABLE y (id int);\n", ""},
	}

	for _, c := range cases {
		got := strings.Join(migrationAltersExisting(c.sql), ", ")
		if got != c.want {
			t.Errorf("%s: got %q, want %q", c.name, got, c.want)
		}
	}
}

// greenBaseline records the tree as tested green: last_green.json and its proto copy.
func greenBaseline(t *testing.T, root string, at time.Time) {
	t.Helper()

	fp, err := takeFingerprint(root)
	if err != nil {
		t.Fatal(err)
	}

	fp.TakenAt = at
	fp.Run = "20261113-090000"

	err = writeJSON(filepath.Join(reportDir(root), "last_green.json"), fp)
	if err != nil {
		t.Fatal(err)
	}

	err = copyDirFiles(filepath.Join(root, "proto"), filepath.Join(reportDir(root), "last_green_proto", "proto"))
	if err != nil {
		t.Fatal(err)
	}
}

func TestMeasureDueRules(t *testing.T) {
	now := time.Date(2026, 11, 13, 14, 0, 0, 0, time.Local)
	base := map[string]string{
		"backend/services/a_service/a.go":                    "package a\n",
		"backend/services/b_service/b.go":                    "package b\n",
		"backend/services/c_service/c.go":                    "package c\n",
		"backend/services/d_service/d.go":                    "package d\n",
		"backend/services/e_service/e.go":                    "package e\n",
		"backend/services/a_service/a_test.go":               "package a\n",
		"backend/services/a_service/db_migrations/00001.sql": "-- +goose Up\nCREATE TABLE a (id int);\n",
		"frontend/src/components/Button.tsx":                 "export {}\n",
		"frontend/src/pages/x/index.stories.tsx":             "export {}\n",
		"proto/warehouse/a/v1/a.proto":                       protoBefore,
		"frontend/e2e/orders.spec.ts":                        "test()\n",
	}

	cases := []struct {
		name    string
		change  map[string]string
		opts    measureOptions
		due     bool
		overdue bool
		whyHas  string
	}{
		{"nothing changed: covered", nil, measureOptions{}, false, false, ""},
		{"one service", map[string]string{"backend/services/a_service/a.go": "package a // 2\n"}, measureOptions{}, false, false, ""},
		{"tests only, many areas", map[string]string{
			"backend/services/a_service/a_test.go":   "package a // 2\n",
			"frontend/e2e/orders.spec.ts":            "test() // 2\n",
			"frontend/src/pages/x/index.stories.tsx": "export {} // 2\n",
		}, measureOptions{}, false, false, ""},
		{"two areas", map[string]string{
			"backend/services/a_service/a.go": "package a // 2\n",
			"backend/services/b_service/b.go": "package b // 2\n",
		}, measureOptions{}, false, false, ""},
		{"three areas", map[string]string{
			"backend/services/a_service/a.go": "package a // 2\n",
			"backend/services/b_service/b.go": "package b // 2\n",
			"backend/services/c_service/c.go": "package c // 2\n",
		}, measureOptions{}, true, false, "3 areas changed"},
		{"five areas: overdue", map[string]string{
			"backend/services/a_service/a.go": "package a // 2\n",
			"backend/services/b_service/b.go": "package b // 2\n",
			"backend/services/c_service/c.go": "package c // 2\n",
			"backend/services/d_service/d.go": "package d // 2\n",
			"backend/services/e_service/e.go": "package e // 2\n",
		}, measureOptions{}, true, true, "overdue: 5+ areas"},
		{"a shared component", map[string]string{"frontend/src/components/Button.tsx": "export const x = 1\n"},
			measureOptions{}, true, false, "a shared component"},
		{"a migration altering an existing table", map[string]string{
			"backend/services/a_service/db_migrations/00002.sql": "-- +goose Up\nALTER TABLE a ADD COLUMN b int;\n",
		}, measureOptions{}, true, false, "a migration alters an existing table (a)"},
		{"a new table", map[string]string{
			"backend/services/a_service/db_migrations/00002.sql": "-- +goose Up\nCREATE TABLE z (id int);\n",
		}, measureOptions{}, false, false, ""},
		{"an applied migration edited", map[string]string{
			"backend/services/a_service/db_migrations/00001.sql": "-- +goose Up\nCREATE TABLE a (id bigint);\n",
		}, measureOptions{}, true, false, "an applied migration was edited"},
		{"a field made required", map[string]string{
			"proto/warehouse/a/v1/a.proto": strings.Replace(protoBefore, "string code = 2;", "string code = 2 [(buf.validate.field).required = true];", 1),
		}, measureOptions{}, true, false, "an existing field made required"},
		{"ready to report", map[string]string{"backend/services/a_service/a.go": "package a // 2\n"},
			measureOptions{Ready: true}, true, false, "work is about to be reported ready"},
		{"end of the day", map[string]string{"frontend/src/components/Button.tsx": "export const x = 1\n"},
			measureOptions{EndOfDay: true}, true, true, "end of the day"},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			root := fakeRepo(t, base)
			greenBaseline(t, root, now.Add(-time.Hour))
			writeTree(t, root, c.change)

			c.opts.Now = now

			m, err := measure(root, c.opts)
			if err != nil {
				t.Fatal(err)
			}

			if m.Due != c.due || m.Overdue != c.overdue {
				t.Fatalf("due=%v overdue=%v, want %v %v (why %v, areas %d)", m.Due, m.Overdue, c.due, c.overdue, m.Why, m.countingAreas())
			}

			why := strings.Join(m.Why, "; ")
			if c.whyHas != "" && !strings.Contains(why, c.whyHas) {
				t.Errorf("why %q should contain %q", why, c.whyHas)
			}

			ask := m.Ask()
			if c.due != (ask != "") {
				t.Errorf("ask %q for due=%v", ask, c.due)
			}

			if strings.Contains(ask, "\n") {
				t.Errorf("the ask must be ONE line: %q", ask)
			}

			if c.due && !strings.Contains(ask, fmt.Sprintf("about %d min", int(estimateDefault/time.Minute))) {
				t.Errorf("the ask should say about how long: %q", ask)
			}
		})
	}
}

func TestMeasureWithoutABaseline(t *testing.T) {
	root := fakeRepo(t, map[string]string{"backend/services/a_service/a.go": "package a\n"})

	m, err := measure(root, measureOptions{})
	if err != nil {
		t.Fatal(err)
	}

	if !m.Due || !m.NoBaseline || !strings.Contains(m.Ask(), "no green full run is recorded yet") {
		t.Fatalf("due=%v noBaseline=%v ask=%q", m.Due, m.NoBaseline, m.Ask())
	}

	// --since stands in: the files modified after it, grouped as usual.
	old := time.Now().Add(-48 * time.Hour)

	for _, f := range []string{"backend/services/a_service/a.go", "backend/services/.keep", "go.mod", "frontend/e2e/smoke.txt",
		"frontend/e2e/auth.spec.ts",
		"frontend/src/router.tsx", "frontend/src/api/clients.ts"} {
		err = os.Chtimes(filepath.Join(root, filepath.FromSlash(f)), old, old)
		if err != nil {
			t.Fatal(err)
		}
	}

	writeTree(t, root, map[string]string{"backend/services/b_service/b.go": "package b\n"})

	m, err = measure(root, measureOptions{Since: time.Now().Add(-time.Hour)})
	if err != nil {
		t.Fatal(err)
	}

	if strings.Join(m.Diff.All(), ",") != "backend/services/b_service/b.go" {
		t.Fatalf("since: %v", m.Diff.All())
	}

	if !strings.Contains(m.Ask(), "no green baseline yet") {
		t.Errorf("ask %q", m.Ask())
	}
}

// Due on an earlier day and still unanswered: overdue — the state file remembers since when.
func TestMeasureOverdueTheNextDay(t *testing.T) {
	root := fakeRepo(t, map[string]string{"frontend/src/components/Button.tsx": "export {}\n"})
	yesterday := time.Date(2026, 11, 12, 16, 0, 0, 0, time.Local)
	greenBaseline(t, root, yesterday.Add(-time.Hour))
	writeTree(t, root, map[string]string{"frontend/src/components/Button.tsx": "export const x = 1\n"})

	m, err := measure(root, measureOptions{Now: yesterday})
	if err != nil {
		t.Fatal(err)
	}

	if !m.Due || m.Overdue {
		t.Fatalf("yesterday: due=%v overdue=%v", m.Due, m.Overdue)
	}

	err = recordMeasurement(m)
	if err != nil {
		t.Fatal(err)
	}

	m, err = measure(root, measureOptions{Now: yesterday.Add(20 * time.Hour)})
	if err != nil {
		t.Fatal(err)
	}

	if !m.Overdue || !strings.HasPrefix(m.Ask(), "ASK (OVERDUE): ") {
		t.Fatalf("next day: overdue=%v ask=%q", m.Overdue, m.Ask())
	}

	latest, err := os.ReadFile(filepath.Join(reportDir(root), "latest.md"))
	if err != nil || !strings.Contains(string(latest), "Not covered") {
		t.Fatalf("latest.md: %v\n%s", err, latest)
	}
}

func TestSliceLog(t *testing.T) {
	root := fakeRepo(t, map[string]string{"backend/services/a_service/a.go": "package a\n"})

	var out strings.Builder

	err := markSlice(root, "first", &out)
	if err != nil {
		t.Fatal(err)
	}

	writeTree(t, root, map[string]string{"backend/services/a_service/a.go": "package a // 2\n", "backend/services/b_service/b.go": "package b\n"})

	err = markSlice(root, "restock layout pass", &out)
	if err != nil {
		t.Fatal(err)
	}

	b, err := os.ReadFile(filepath.Join(reportDir(root), "slice_log.md"))
	if err != nil {
		t.Fatal(err)
	}

	log := string(b)
	for _, want := range []string{"· first", "· restock layout pass", "- changed `backend/services/a_service/a.go`",
		"- added `backend/services/b_service/b.go`"} {
		if !strings.Contains(log, want) {
			t.Errorf("slice_log.md lacks %q:\n%s", want, log)
		}
	}

	if got := slicesSince(reportDir(root), time.Now().Add(-time.Hour)); len(got) != 2 {
		t.Errorf("slicesSince = %v", got)
	}
}
