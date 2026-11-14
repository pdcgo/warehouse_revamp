package main

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/urfave/cli/v3"
)

// The 53 specs of the 2026-11-13 full run, and the batches e2e_batches.sh made of them (its summary.txt).
var specsOf20261113 = strings.Fields(`auth.spec.ts bundles.spec.ts expenses.spec.ts finance_metrics.spec.ts
financial_accounts.spec.ts found_requests.spec.ts inventory.spec.ts language.spec.ts liability.spec.ts
opname_sessions.spec.ts order_drafts.spec.ts orders.spec.ts products.spec.ts profile.spec.ts racks.spec.ts
restock.spec.ts settlement_imports.spec.ts shipment_channels.spec.ts shops.spec.ts statement.spec.ts
stock_count_cancel.spec.ts supplier_channels.spec.ts suppliers.spec.ts team_switch.spec.ts teams.spec.ts
the_closed_shop.spec.ts the_expense_metrics.spec.ts the_inventory_metrics.spec.ts the_labels_print_together.spec.ts
the_order_keeps_exact_figures.spec.ts the_order_needs_a_return_warehouse.spec.ts the_owner_corrects_a_batch_price.spec.ts
the_received_count_is_corrected.spec.ts the_return_goes_back_on_the_shelf.spec.ts the_root_team_badge.spec.ts
the_settlement_report.spec.ts the_shop_entries.spec.ts the_supplier_exports.spec.ts the_supplier_goods.spec.ts
the_team_balance_names_who_recorded.spec.ts the_warehouse_list.spec.ts the_warehouse_reads_a_shelf_in_units.spec.ts
transfers.spec.ts users.spec.ts warehouses.spec.ts writes_need_a_shop_grant.spec.ts`)

func TestPlanBatchesMatchesTheScript(t *testing.T) {
	want := []string{
		"auth.spec.ts bundles.spec.ts expenses.spec.ts finance_metrics.spec.ts financial_accounts.spec.ts found_requests.spec.ts",
		"inventory.spec.ts language.spec.ts liability.spec.ts opname_sessions.spec.ts order_drafts.spec.ts",
		"orders.spec.ts",
		"products.spec.ts profile.spec.ts racks.spec.ts",
		"restock.spec.ts",
		"settlement_imports.spec.ts shipment_channels.spec.ts shops.spec.ts statement.spec.ts stock_count_cancel.spec.ts supplier_channels.spec.ts",
		"suppliers.spec.ts team_switch.spec.ts teams.spec.ts the_closed_shop.spec.ts the_expense_metrics.spec.ts the_inventory_metrics.spec.ts",
		"the_labels_print_together.spec.ts the_order_keeps_exact_figures.spec.ts the_order_needs_a_return_warehouse.spec.ts " +
			"the_owner_corrects_a_batch_price.spec.ts the_received_count_is_corrected.spec.ts the_return_goes_back_on_the_shelf.spec.ts",
		"the_root_team_badge.spec.ts the_settlement_report.spec.ts the_shop_entries.spec.ts the_supplier_exports.spec.ts " +
			"the_supplier_goods.spec.ts the_team_balance_names_who_recorded.spec.ts",
		"the_warehouse_list.spec.ts the_warehouse_reads_a_shelf_in_units.spec.ts transfers.spec.ts users.spec.ts warehouses.spec.ts " +
			"writes_need_a_shop_grant.spec.ts",
	}

	// Shuffled in: the plan sorts by name, as the script's LC_ALL=C sort did.
	specs := append([]string{}, specsOf20261113[30:]...)
	specs = append(specs, specsOf20261113[:30]...)

	got := planBatches(specs, batchSize)
	if len(got) != len(want) {
		t.Fatalf("%d batches, want %d: %v", len(got), len(want), got)
	}

	for i := range want {
		if strings.Join(got[i], " ") != want[i] {
			t.Errorf("b%d = %s\n want %s", i+1, strings.Join(got[i], " "), want[i])
		}
	}

	if capFor([]string{"restock.spec.ts"}) != longSpecCap || capFor(got[0]) != batchCap {
		t.Error("restock.spec.ts alone runs under the long cap, the rest under the batch cap")
	}
}

func TestParseNetstat(t *testing.T) {
	out := "Active Connections\r\n\r\n  Proto  Local Address          Foreign Address        State           PID\r\n" +
		"  TCP    0.0.0.0:5175           0.0.0.0:0              LISTENING       4242\r\n" +
		"  TCP    [::1]:5175             [::]:0                 LISTENING       4242\r\n" +
		"  TCP    127.0.0.1:8081         0.0.0.0:0              LISTENING       77\r\n" +
		"  TCP    127.0.0.1:51750        127.0.0.1:5175         ESTABLISHED     9\r\n" +
		"  TCP    0.0.0.0:15175          0.0.0.0:0              LISTENING       5\r\n"

	if got := parseNetstat(out, 5175); len(got) != 1 || got[0] != 4242 {
		t.Errorf(":5175 = %v", got)
	}

	if got := parseNetstat(out, 8081); len(got) != 1 || got[0] != 77 {
		t.Errorf(":8081 = %v", got)
	}
}

func TestOwnServer(t *testing.T) {
	frontends := []string{`D:\pdcgo\warehouse_revamp\frontend`}

	cases := []struct {
		cmd  string
		want bool
	}{
		{`C:\Users\x\AppData\Local\Temp\go-build1\b001\exe\app_development.exe`, true},
		{`"C:\Program Files\nodejs\node.exe" D:\pdcgo\warehouse_revamp\frontend\node_modules\.bin\..\vite\bin\vite.js --port 5175`, true},
		{`"C:\Program Files\nodejs\node.exe" D:\work\hai-tukang\web\node_modules\vite\bin\vite.js --port 5175`, false},
		{`C:\tools\hai-tukang.exe dev run`, false},
		{`C:\something\else.exe`, false},
	}

	for _, c := range cases {
		if got := ownServer(c.cmd, frontends); got != c.want {
			t.Errorf("ownServer(%q) = %v", c.cmd, got)
		}
	}
}

const playwrightReport = `{
  "suites": [
    {"title": "auth.spec.ts", "file": "auth.spec.ts", "specs": [
      {"title": "signs in", "file": "auth.spec.ts", "tests": [{"status": "expected", "results": [{"status": "passed", "duration": 1500}]}]},
      {"title": "is flaky", "file": "auth.spec.ts", "tests": [{"status": "flaky", "results": [{"status": "failed", "duration": 100}, {"status": "passed", "duration": 400}]}]}
    ]},
    {"title": "restock.spec.ts", "file": "restock.spec.ts", "specs": [], "suites": [
      {"title": "warehouse:all wants to accept a restock", "file": "restock.spec.ts", "specs": [
        {"title": "accept (from arrived)", "file": "restock.spec.ts", "tests": [{"status": "unexpected", "results": [{"status": "failed", "duration": 9000}]}]},
        {"title": "accept (from ongoing)", "file": "restock.spec.ts", "tests": [{"status": "skipped", "results": []}]},
        {"title": "known gap", "file": "restock.spec.ts", "tests": [{"status": "skipped", "results": [{"status": "skipped", "duration": 0}]}]}
      ]}
    ]}
  ],
  "stats": {"expected": 1, "unexpected": 1, "flaky": 1, "skipped": 2}
}`

func TestParsePlaywrightJSON(t *testing.T) {
	path := filepath.Join(t.TempDir(), "b1.json")

	err := os.WriteFile(path, []byte(playwrightReport), 0o644)
	if err != nil {
		t.Fatal(err)
	}

	sum, err := parsePlaywrightJSON(path)
	if err != nil {
		t.Fatal(err)
	}

	if sum.Counts != (Counts{Passed: 1, Failed: 1, Flaky: 1, Skipped: 1, DidNotRun: 1}) {
		t.Errorf("counts %+v", sum.Counts)
	}

	if sum.Specs["auth.spec.ts"].Secs != 2.0 || sum.Specs["restock.spec.ts"].Failed != 1 {
		t.Errorf("auth %+v restock %+v", sum.Specs["auth.spec.ts"], sum.Specs["restock.spec.ts"])
	}

	if len(sum.Failures) != 1 || sum.Failures[0] != "restock.spec.ts › warehouse:all wants to accept a restock › accept (from arrived)" {
		t.Errorf("failures %v", sum.Failures)
	}
}

func TestLogCounts(t *testing.T) {
	line := "Running 42 tests using 1 worker\n  1 failed\n    [chromium] › e2e\\x.spec.ts:3:1 › y\n  2 did not run\n  39 passed (3.0m)\n"
	if c := countsFromLine(line); c != (Counts{Passed: 39, Failed: 1, DidNotRun: 2}) {
		t.Errorf("line reporter %+v", c)
	}

	goLog := "ok  \tgithub.com/x/a\t1.2s\n--- FAIL: TestB (0.01s)\nFAIL\tgithub.com/x/b\t0.5s\nok  \tgithub.com/x/c\t(cached)\n"
	passed, failed, failures := goTestCounts(goLog)

	if passed != 2 || failed != 1 || strings.Join(failures, ",") != "package github.com/x/b,TestB" {
		t.Errorf("go: %d %d %v", passed, failed, failures)
	}

	vitest := " ✓ src/a.stories.tsx (3 tests) 120ms\n FAIL  src/b.stories.tsx > Story\n Test Files  1 failed | 120 passed (121)\n      Tests  2 failed | 1200 passed (1202)\n"
	passed, failed, failures = vitestCounts(vitest)

	if passed != 1200 || failed != 2 || len(failures) != 1 || failures[0] != "src/b.stories.tsx > Story" {
		t.Errorf("vitest: %d %d %v", passed, failed, failures)
	}
}

func TestParseSmoke(t *testing.T) {
	flows, err := parseSmoke(strings.NewReader("# comment\n\n## sign in\nauth.spec.ts › root logs in\n## accept a restock\n" +
		"restock.spec.ts › warehouse:all wants to accept a restock › warehouse:owner accept restock (from arrived)\r\n"))
	if err != nil {
		t.Fatal(err)
	}

	if len(flows) != 2 || flows[1].Entries[0].Spec != "restock.spec.ts" || len(flows[1].Entries[0].Titles) != 2 {
		t.Fatalf("flows %+v", flows)
	}

	re := regexp.MustCompile(flows[1].Entries[0].grep())

	// Playwright greps "<project> <file> <describe…> <title> <@tags>".
	if !re.MatchString("chromium restock.spec.ts warehouse:all wants to accept a restock warehouse:owner accept restock (from arrived)") {
		t.Error("the grep misses its own test")
	}

	if re.MatchString("chromium restock.spec.ts warehouse:all wants to accept a restock warehouse:owner accept restock (from arrived) again") {
		t.Error("the grep matches a longer title")
	}

	for _, bad := range []string{"auth.spec.ts › x\n", "## f\nnot a spec line\n", "## f\nauth.spec.ts\n"} {
		_, err = parseSmoke(strings.NewReader(bad))
		if err == nil {
			t.Errorf("%q should not parse", bad)
		}
	}
}

func TestSmokeBatches(t *testing.T) {
	flows := []smokeFlow{
		{Name: "a", Entries: []smokeEntry{{Spec: "auth.spec.ts", Titles: []string{"x"}}}},
		{Name: "b", Entries: []smokeEntry{{Spec: "restock.spec.ts", Titles: []string{"d", "y"}}}},
		{Name: "c", Entries: []smokeEntry{{Spec: "orders.spec.ts", Titles: []string{"z"}}}},
	}

	// One restock test joins the others…
	got := smokeBatches(flows[:2], nil)
	if len(got) != 1 || strings.Join(got[0].Specs, " ") != "auth.spec.ts restock.spec.ts" {
		t.Fatalf("batches %+v", got)
	}

	// …and orders.spec.ts always runs alone (name order puts it between them).
	got = smokeBatches(flows, nil)
	if len(got) != 3 || strings.Join(got[1].Specs, " ") != "orders.spec.ts" || got[2].Grep == "" {
		t.Fatalf("batches %+v", got)
	}

	// The whole of restock.spec.ts runs alone, ungrepped; a whole spec beside a smoke entry is grepped whole.
	got = smokeBatches(flows, map[string]bool{"restock.spec.ts": true, "users.spec.ts": true})
	if len(got) != 4 {
		t.Fatalf("batches %+v", got)
	}

	for _, b := range got {
		joined := strings.Join(b.Specs, " ")

		switch joined {
		case "restock.spec.ts":
			if b.Grep != "" {
				t.Errorf("whole restock.spec.ts grepped: %s", b.Grep)
			}
		case "users.spec.ts", "auth.spec.ts":
		case "auth.spec.ts users.spec.ts":
			re := regexp.MustCompile(b.Grep)
			if !re.MatchString("chromium users.spec.ts any title") || !re.MatchString("chromium auth.spec.ts x") ||
				re.MatchString("chromium auth.spec.ts other") {
				t.Errorf("grep %s", b.Grep)
			}
		}
	}
}

// liveTree is a checkout with an installed node_modules and the things a copy must leave behind.
func liveTree(t *testing.T) string {
	t.Helper()

	return fakeRepo(t, map[string]string{
		"backend/services/a_service/a.go":          "package a\n",
		"backend/gen/warehouse/a.pb.go":            "package gen\n",
		"backend/bin/app.exe":                      "binary",
		"backend/app_development.exe":              "binary",
		"examples/receipt_file_samples/a.pdf":      "%PDF",
		".git/HEAD":                                "ref: refs/heads/x\n",
		"backend/sub/.git":                         "gitdir: ../.git/modules/sub\n",
		".env":                                     "SECRET=1\n",
		"e2e_report/last_green.json":               "{}",
		"frontend/node_modules/react/index.js":     "module.exports = 1\n",
		"frontend/node_modules/.bin/vite.cmd":      "@echo off\n",
		"frontend/node_modules/.vite/deps/x.js":    "cache\n",
		"frontend/node_modules/.package-lock.json": "{}",
		"frontend/test-results/old/trace.zip":      "x",
		"frontend/.e2e-lock":                       "{\"pid\":1}",
		"frontend/tsconfig.tsbuildinfo":            "x",
		"frontend/src/gen/warehouse/a_pb.ts":       "export {}\n",
		"graphify-out/graph.json":                  "{}",
		"development_data/pg/PG_VERSION":           "16",
	})
}

func TestFreezeCopyAndRemove(t *testing.T) {
	live := liveTree(t)
	dst := filepath.Join(t.TempDir(), "copy")

	files, err := freezeCopy(live, dst)
	if err != nil {
		t.Fatal(err)
	}

	if files == 0 {
		t.Fatal("nothing copied")
	}

	for _, want := range []string{"backend/services/a_service/a.go", "backend/gen/warehouse/a.pb.go", "frontend/src/gen/warehouse/a_pb.ts",
		"examples/receipt_file_samples/a.pdf", "frontend/node_modules/.package-lock.json", copyMarker} {
		_, err = os.Stat(filepath.Join(dst, filepath.FromSlash(want)))
		if err != nil {
			t.Errorf("%s should be in the copy: %v", want, err)
		}
	}

	for _, gone := range []string{".git", "backend/sub/.git", "backend/bin", "backend/app_development.exe", ".env", "e2e_report",
		"frontend/node_modules/.vite", "frontend/test-results", "frontend/.e2e-lock", "frontend/tsconfig.tsbuildinfo",
		"graphify-out", "development_data"} {
		_, err = os.Lstat(filepath.Join(dst, filepath.FromSlash(gone)))
		if err == nil {
			t.Errorf("%s should not be in the copy", gone)
		}
	}

	// The packages are the copy's own files — hard links to the live ones, not junctions out of it.
	for _, f := range []string{"react/index.js", ".bin/vite.cmd"} {
		cp := filepath.Join(dst, "frontend", "node_modules", filepath.FromSlash(f))

		info, err := os.Lstat(cp)
		if err != nil || !info.Mode().IsRegular() {
			t.Fatalf("node_modules/%s should be a regular file in the copy: %v", f, err)
		}

		liveInfo, err := os.Stat(filepath.Join(live, "frontend", "node_modules", filepath.FromSlash(f)))
		if err != nil || !os.SameFile(info, liveInfo) {
			t.Errorf("node_modules/%s should be hard-linked, not copied (same volume): %v", f, err)
		}
	}

	err = removeCopy(dst)
	if err != nil {
		t.Fatal(err)
	}

	_, err = os.Stat(dst)
	if !os.IsNotExist(err) {
		t.Errorf("the copy is still there: %v", err)
	}

	// Removing a hard link leaves the live file.
	b, err := os.ReadFile(filepath.Join(live, "frontend", "node_modules", "react", "index.js"))
	if err != nil || string(b) != "module.exports = 1\n" {
		t.Fatalf("the live node_modules was harmed: %q %v", b, err)
	}

	err = removeCopy(live)
	if err == nil || !strings.Contains(err.Error(), "not a frozen copy") {
		t.Errorf("removeCopy must refuse a folder without the marker: %v", err)
	}
}

func TestPlanFull(t *testing.T) {
	root := fakeRepo(t, map[string]string{
		"frontend/e2e/orders.spec.ts":  "",
		"frontend/e2e/restock.spec.ts": "",
		"frontend/e2e/users.spec.ts":   "",
	})
	now := time.Date(2026, 11, 13, 18, 0, 0, 0, time.Local)

	plan, err := planFull(root, fullOptions{}, now)
	if err != nil {
		t.Fatal(err)
	}

	if plan.Partial || strings.Join(plan.GoArgv, " ") != "go test -count=1 ./..." || len(plan.Batches) != 4 ||
		plan.CopyDir != filepath.Join(filepath.Dir(root), ".san_frozen", filepath.Base(root)+"-20261113-180000") {
		t.Fatalf("plan %+v", plan)
	}

	fp, err := takeFingerprint(root)
	if err != nil {
		t.Fatal(err)
	}

	var out bytes.Buffer

	plan.print(&out, fp, nil)

	for _, want := range []string{"b1  auth.spec.ts", "b2  orders.spec.ts", "b3  restock.spec.ts", "b4  users.spec.ts",
		"last_green.json moves only when", "vitest.mjs run --project=storybook", "hard-linked"} {
		if !strings.Contains(out.String(), want) {
			t.Errorf("the plan lacks %q:\n%s", want, out.String())
		}
	}

	plan, err = planFull(root, fullOptions{Specs: []string{"users.spec.ts"}, Skip: []string{"go"}}, now)
	if err != nil {
		t.Fatal(err)
	}

	out.Reset()
	plan.print(&out, fp, nil)

	if !plan.Partial || plan.GoArgv != nil || len(plan.Batches) != 1 || !strings.Contains(out.String(), "NOT moved — a partial run") {
		t.Fatalf("a partial plan:\n%s", out.String())
	}
}

// runSan runs the real root command in dir and returns what it printed.
func runSan(t *testing.T, dir string, args ...string) (string, error) {
	t.Helper()
	t.Chdir(dir)

	var out bytes.Buffer

	cmd := &cli.Command{Name: "san", Writer: &out, ErrWriter: &out, Commands: []*cli.Command{testCommand()}}
	err := cmd.Run(context.Background(), append([]string{"san"}, args...))

	return out.String(), err
}

func TestTestCommandWiring(t *testing.T) {
	var names []string
	for _, c := range testCommand().Commands {
		names = append(names, c.Name)
	}

	if strings.Join(names, " ") != "measure affected smoke full report slice" {
		t.Fatalf("subcommands %v", names)
	}

	root := fakeRepo(t, map[string]string{"backend/services/a_service/a.go": "package a\n"})

	out, err := runSan(t, root, "test", "measure")
	if err != nil || !strings.Contains(out, "no green baseline") || !strings.Contains(out, "ASK: ") {
		t.Fatalf("measure: %v\n%s", err, out)
	}

	_, err = os.Stat(filepath.Join(root, "e2e_report", "latest.md"))
	if err != nil {
		t.Errorf("measure writes latest.md: %v", err)
	}

	_, err = runSan(t, root, "test", "affected")
	if err == nil || !strings.Contains(err.Error(), "pass --since") {
		t.Errorf("affected with no baseline should ask for --since: %v", err)
	}

	out, err = runSan(t, root, "test", "affected", "--files", "frontend/e2e/auth.spec.ts")
	if err != nil || !strings.Contains(out, "auth.spec.ts") || !strings.Contains(out, "the smoke set") {
		t.Errorf("affected --files: %v\n%s", err, out)
	}

	out, err = runSan(t, root, "test", "full", "--dry-run", "--skip", "go")
	if err != nil || !strings.Contains(out, "dry run: nothing is copied or run") || !strings.Contains(out, "partial run (--skip go)") {
		t.Errorf("full --dry-run: %v\n%s", err, out)
	}

	_, err = runSan(t, root, "test", "full", "--dry-run", "--skip", "lint")
	if err == nil {
		t.Error("--skip lint should be refused")
	}

	_, err = runSan(t, root, "test", "slice")
	if err == nil || !strings.Contains(err.Error(), "name the slice") {
		t.Errorf("slice without a name: %v", err)
	}

	out, err = runSan(t, root, "test", "slice", "first", "pass")
	if err != nil || !strings.Contains(out, "slice marked") {
		t.Errorf("slice: %v\n%s", err, out)
	}

	out, err = runSan(t, root, "test", "report")
	if err != nil || !strings.Contains(out, "e2e_report — latest") {
		t.Errorf("report: %v\n%s", err, out)
	}
}

func TestPidAlive(t *testing.T) {
	if !pidAlive(os.Getpid()) {
		t.Error("this process is alive")
	}

	if runtime.GOOS == "windows" && pidAlive(0x7ffffff0) {
		t.Error("a pid nobody has is not alive")
	}
}
