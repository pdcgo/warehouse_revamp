package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// Unit tests for the parallel e2e plan (`san test full --workers N`, backlog #51): the longest-first balancing, the
// coupled-spec grouping, the batches inside a worker, the per-spec times and the template steps.

func unitsOf(secs map[string]float64) []specUnit {
	var specs []string
	for s := range secs {
		specs = append(specs, s)
	}

	times := map[string]specTime{}
	for s, v := range secs {
		times[s] = specTime{Secs: v}
	}

	return groupUnits(sortedCopy(specs), nil, times)
}

func sortedCopy(s []string) []string {
	out := append([]string(nil), s...)

	for i := 1; i < len(out); i++ {
		for j := i; j > 0 && out[j] < out[j-1]; j-- {
			out[j], out[j-1] = out[j-1], out[j]
		}
	}

	return out
}

func loadOf(us []specUnit) float64 {
	var s float64
	for _, u := range us {
		s += u.Secs
	}

	return s
}

func TestAssignWorkersLongestFirstBalances(t *testing.T) {
	units := unitsOf(map[string]float64{
		"a.spec.ts": 300, "b.spec.ts": 280, "c.spec.ts": 120, "d.spec.ts": 100, "e.spec.ts": 90,
		"f.spec.ts": 60, "g.spec.ts": 40, "h.spec.ts": 30, "i.spec.ts": 20,
	})

	got := assignWorkers(units, 3)
	if len(got) != 3 {
		t.Fatalf("%d workers, want 3", len(got))
	}

	// LPT: 300 → w1, 280 → w2, 120 → w3, 100 → w3 (220), 90 → w3? no: w3 is 220 > w2 280? the least is w3 (220)…
	// Whatever the walk, every spec is placed once and the spread stays within the longest unit.
	seen := map[string]int{}
	lo, hi := 1e9, 0.0

	for _, us := range got {
		for _, u := range us {
			for _, s := range u.Specs {
				seen[s]++
			}
		}

		l := loadOf(us)
		lo, hi = min(lo, l), max(hi, l)
	}

	if len(seen) != 9 {
		t.Fatalf("%d specs placed, want 9: %v", len(seen), seen)
	}

	for s, n := range seen {
		if n != 1 {
			t.Errorf("%s placed %d times", s, n)
		}
	}

	if hi-lo > 300 {
		t.Errorf("loads spread %v–%v: more than the longest unit apart", lo, hi)
	}

	// The two longest never share a worker.
	for _, us := range got {
		names := map[string]bool{}
		for _, u := range us {
			names[u.Specs[0]] = true
		}

		if names["a.spec.ts"] && names["b.spec.ts"] {
			t.Errorf("the two longest specs share a worker: %v", names)
		}
	}
}

func TestAssignWorkersKeepsNameOrderInsideAWorker(t *testing.T) {
	units := unitsOf(map[string]float64{"z.spec.ts": 500, "a.spec.ts": 10, "m.spec.ts": 20, "b.spec.ts": 15})

	for _, us := range assignWorkers(units, 2) {
		for i := 1; i < len(us); i++ {
			if us[i].Specs[0] < us[i-1].Specs[0] {
				t.Errorf("a worker's specs are not in name order: %v then %v", us[i-1].Specs, us[i].Specs)
			}
		}
	}
}

func TestAssignWorkersOneWorkerTakesEverything(t *testing.T) {
	units := unitsOf(map[string]float64{"a.spec.ts": 1, "b.spec.ts": 2})

	got := assignWorkers(units, 1)
	if len(got) != 1 || len(got[0]) != 2 {
		t.Fatalf("one worker should take both units: %v", got)
	}
}

func TestGroupUnitsKeepsCoupledSpecsTogetherInNameOrder(t *testing.T) {
	specs := []string{"a.spec.ts", "b.spec.ts", "c.spec.ts", "d.spec.ts"}
	times := map[string]specTime{"a.spec.ts": {Secs: 10}, "b.spec.ts": {Secs: 20}, "c.spec.ts": {Secs: 30}, "d.spec.ts": {Secs: 40}}

	// A group listed out of order, and a member not in this run (x): it is left out, the rest stay together.
	units := groupUnits(specs, [][]string{{"d.spec.ts", "b.spec.ts", "x.spec.ts"}}, times)

	if len(units) != 3 {
		t.Fatalf("%d units, want 3 (one group, two singles): %v", len(units), units)
	}

	g := units[0]
	if strings.Join(g.Specs, " ") != "b.spec.ts d.spec.ts" || g.Secs != 60 {
		t.Errorf("group = %v %vs, want [b d] in name order, 60s", g.Specs, g.Secs)
	}

	// Placed as ONE unit: whatever the worker count, b and d land on the same worker and in the same batch.
	for _, n := range []int{2, 3, 4} {
		for _, us := range assignWorkers(units, n) {
			batches, _ := workerBatches(us, batchSize)

			for _, b := range batches {
				has := strings.Join(b, " ")
				if strings.Contains(has, "b.spec.ts") != strings.Contains(has, "d.spec.ts") {
					t.Errorf("n=%d: the coupled specs were split: batch %v", n, b)
				}
			}
		}
	}
}

func TestParseCoupled(t *testing.T) {
	groups, err := parseCoupled(strings.NewReader("# a comment\n\na.spec.ts b.spec.ts  # why\n c.spec.ts d.spec.ts e.spec.ts\n"))
	if err != nil {
		t.Fatal(err)
	}

	if len(groups) != 2 || len(groups[0]) != 2 || len(groups[1]) != 3 {
		t.Fatalf("groups = %v", groups)
	}

	for _, bad := range []string{"a.spec.ts\n", "a.spec.ts b.ts\n", "a.spec.ts b.spec.ts\nb.spec.ts c.spec.ts\n"} {
		_, err := parseCoupled(strings.NewReader(bad))
		if err == nil {
			t.Errorf("parseCoupled(%q) accepted", bad)
		}
	}
}

func TestTheCheckedInCoupledListParses(t *testing.T) {
	root, err := findRepoRoot()
	if err != nil {
		t.Skip("no repo root")
	}

	groups, err := readCoupled(root)
	if err != nil {
		t.Fatal(err)
	}

	specs, err := specFiles(filepath.Join(root, "frontend"))
	if err != nil {
		t.Fatal(err)
	}

	for _, g := range groups {
		for _, s := range g {
			if !contains(specs, s) {
				t.Errorf("coupled.txt names %s, which is not a spec file", s)
			}
		}
	}
}

func TestWorkerBatchesNeverCutAUnitAndKeepOrdersAlone(t *testing.T) {
	units := []specUnit{
		{Specs: []string{"a.spec.ts"}, Secs: 1}, {Specs: []string{"b.spec.ts", "c.spec.ts", "d.spec.ts"}, Secs: 3},
		{Specs: []string{"e.spec.ts"}, Secs: 1}, {Specs: []string{"f.spec.ts", "g.spec.ts"}, Secs: 2},
		{Specs: []string{"orders.spec.ts"}, Secs: 9}, {Specs: []string{"p.spec.ts"}, Secs: 1},
	}

	batches, secs := workerBatches(units, 6)

	want := []string{"a.spec.ts b.spec.ts c.spec.ts d.spec.ts e.spec.ts", "f.spec.ts g.spec.ts", "orders.spec.ts", "p.spec.ts"}
	if len(batches) != len(want) {
		t.Fatalf("batches = %v, want %v", batches, want)
	}

	for i := range want {
		if strings.Join(batches[i], " ") != want[i] {
			t.Errorf("b%d = %v, want %s", i+1, batches[i], want[i])
		}
	}

	if secs[0] != 5 || secs[2] != 9 {
		t.Errorf("batch seconds = %v", secs)
	}
}

func TestPickWorkerPortsSkipsAForeignHolder(t *testing.T) {
	busy := func(p int) bool { return p == 5182 || p == 8184 }

	apis, uis, skipped, err := pickWorkerPorts(3, busy)
	if err != nil {
		t.Fatal(err)
	}

	if want := []int{8181, 8183, 8185}; !equalInts(apis, want) {
		t.Errorf("api ports = %v, want %v", apis, want)
	}

	if want := []int{5181, 5183, 5185}; !equalInts(uis, want) {
		t.Errorf("ui ports = %v, want %v", uis, want)
	}

	if len(skipped) != 2 {
		t.Errorf("skipped = %v, want the two held pairs", skipped)
	}

	for _, p := range append(apis, uis...) {
		if p == 8080 || p == 8081 || p == 5174 || p == 5175 {
			t.Errorf("a worker took :%d — the dev servers' or the single run's port", p)
		}
	}
}

func equalInts(a, b []int) bool {
	if len(a) != len(b) {
		return false
	}

	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}

	return true
}

func TestWorkerEnvNamesItsOwnEverything(t *testing.T) {
	w := &e2eWorker{Name: "w2", DB: "warehouse_test_w2", APIPort: 8182, UIPort: 5182, Project: "warehouse-e2e-w2"}
	env := strings.Join(w.env(), "\n")

	for _, want := range []string{"E2E_WORKER=w2", "E2E_API_PORT=8182", "E2E_UI_PORT=5182", "E2E_DB_NAME=warehouse_test_w2",
		"E2E_DB_TEMPLATE=warehouse_test_tpl", "E2E_PUBSUB_PROJECT=warehouse-e2e-w2", "E2E_API_ADDR=localhost:8182",
		"E2E_PUSH_BASE_URL=http://host.docker.internal:8182"} {
		if !strings.Contains(env, want) {
			t.Errorf("env lacks %s:\n%s", want, env)
		}
	}

	if !testDBNameRe.MatchString(w.DB) || !testDBNameRe.MatchString(templateDB) {
		t.Errorf("%s / %s would be refused by san db", w.DB, templateDB)
	}
}

func TestTestDBNamesStayInTheTestFamily(t *testing.T) {
	for _, ok := range []string{"warehouse_test", "warehouse_test_w1", "warehouse_test_tpl"} {
		if !testDBNameRe.MatchString(ok) {
			t.Errorf("%s refused", ok)
		}
	}

	for _, bad := range []string{"postgres", "warehouse", "warehouse_testx", "warehouse_test_W1", `warehouse_test_"x`, "warehouse_test_"} {
		if testDBNameRe.MatchString(bad) {
			t.Errorf("%s accepted", bad)
		}
	}
}

func TestSummaryTimesShareABatchByItsTests(t *testing.T) {
	dir := t.TempDir()
	front := filepath.Join(dir, "frontend")

	err := os.MkdirAll(filepath.Join(front, "e2e"), 0o755)
	if err != nil {
		t.Fatal(err)
	}

	summary := "b1 exit=0 secs=125 specs= a.spec.ts b.spec.ts\n  4 passed (2.0m)\nb2 exit=0 secs=700 specs=restock.spec.ts\nDONE\n"
	log1 := "[1/4] [chromium] › e2e\\a.spec.ts:1:1 › one\n[2/4] [chromium] › e2e\\a.spec.ts:2:1 › two\n" +
		"[3/4] [chromium] › e2e\\a.spec.ts:3:1 › three\n[4/4] [chromium] › e2e\\b.spec.ts:1:1 › four\n"

	for name, body := range map[string]string{"summary.txt": summary, "b1.log": log1} {
		err = os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644)
		if err != nil {
			t.Fatal(err)
		}
	}

	got, err := summaryTimes(filepath.Join(dir, "summary.txt"), front)
	if err != nil {
		t.Fatal(err)
	}

	// 125 s less the batch's overhead (25 s) = 100 s, shared 3:1.
	if got["a.spec.ts"].Secs != 75 || got["b.spec.ts"].Secs != 25 || got["a.spec.ts"].Tests != 3 {
		t.Errorf("a = %+v, b = %+v", got["a.spec.ts"], got["b.spec.ts"])
	}

	if got["restock.spec.ts"].Secs != 700-singleBatchOverhead.Seconds() {
		t.Errorf("restock = %+v", got["restock.spec.ts"])
	}
}

func TestEstimateUsesTheSplitParentsRate(t *testing.T) {
	dir := t.TempDir()
	e2e := filepath.Join(dir, "frontend", "e2e")

	err := os.MkdirAll(e2e, 0o755)
	if err != nil {
		t.Fatal(err)
	}

	// The old restock.spec.ts: 4 tests in 40 s; it is now 1 test, and restock_accept.spec.ts holds 3.
	files := map[string]string{
		"restock.spec.ts":        "test(\"one\", async () => {});\n",
		"restock_accept.spec.ts": "test.describe(\"x\", () => {\n  test(\"a\", async () => {});\n  test(\"b\", async () => {});\n  test.fail(\"c\", async () => {});\n});\n",
		"other.spec.ts":          "test(\"x\", async () => {});\ntest(`y`, async () => {});\n",
	}

	for n, b := range files {
		err = os.WriteFile(filepath.Join(e2e, n), []byte(b), 0o644)
		if err != nil {
			t.Fatal(err)
		}
	}

	summary := filepath.Join(dir, "summary.txt")

	err = os.WriteFile(summary, []byte("b1 exit=0 secs=65 specs=restock.spec.ts\n"), 0o644)
	if err != nil {
		t.Fatal(err)
	}

	// No b1.log: the old file's 4 tests are unknown, so the recorded count is the file's own (1) — make the log say 4.
	err = os.WriteFile(filepath.Join(dir, "b1.log"), []byte(strings.Repeat("[1/4] [chromium] › e2e\\restock.spec.ts:1:1 › t\n", 4)), 0o644)
	if err != nil {
		t.Fatal(err)
	}

	got, err := estimateSpecTimes(dir, []string{"restock.spec.ts", "restock_accept.spec.ts", "other.spec.ts"}, summary, nil)
	if err != nil {
		t.Fatal(err)
	}

	// 65 − 25 = 40 s over 4 tests = 10 s a test.
	if got["restock.spec.ts"].Secs != 10 {
		t.Errorf("restock.spec.ts = %+v, want 40 s scaled 4→1 tests = 10 s", got["restock.spec.ts"])
	}

	if got["restock_accept.spec.ts"].Secs != 30 {
		t.Errorf("restock_accept.spec.ts = %+v, want 3 tests at restock.spec.ts's 10 s", got["restock_accept.spec.ts"])
	}

	if got["other.spec.ts"].Secs != 2*secsPerTest {
		t.Errorf("other.spec.ts = %+v, want 2 tests × %.1f s", got["other.spec.ts"], secsPerTest)
	}

	// Playwright's own count wins over the test( calls (a loop declares one test per role).
	got, err = estimateSpecTimes(dir, []string{"restock_accept.spec.ts"}, summary, map[string]int{"restock_accept.spec.ts": 6})
	if err != nil {
		t.Fatal(err)
	}

	if got["restock_accept.spec.ts"].Secs != 60 {
		t.Errorf("restock_accept.spec.ts = %+v, want 6 listed tests at 10 s", got["restock_accept.spec.ts"])
	}
}

func TestParallelPlanBeatsTheSingleRun(t *testing.T) {
	p := &workerPlan{Times: map[string]specTime{}}

	var specs []string

	for i := 0; i < 30; i++ {
		s := strings.Repeat("s", i+1) + ".spec.ts"
		specs = append(specs, s)
		p.Times[s] = specTime{Secs: 60}
	}

	for i, us := range assignWorkers(groupUnits(specs, nil, p.Times), 3) {
		w := &e2eWorker{Name: "w" + string(rune('1'+i)), Units: us}
		w.Batches, w.BatchSecs = workerBatches(us, batchSize)
		p.Workers = append(p.Workers, w)
	}

	if p.wall() >= p.singleWall(specs) {
		t.Errorf("3 workers %s, not faster than the single run's %s", p.wall(), p.singleWall(specs))
	}

	if p.wall() < 10*time.Minute {
		t.Errorf("3 workers over 30 min of specs estimated at %s — under a third", p.wall())
	}
}

func TestTemplateStepsAreTheGlobalSetupSteps(t *testing.T) {
	root, err := findRepoRoot()
	if err != nil {
		t.Skip("no repo root")
	}

	front := filepath.Join(root, "frontend")

	pw, err := e2eRootPassword(front)
	if err != nil {
		t.Fatal(err)
	}

	b, err := os.ReadFile(filepath.Join(front, "e2e", "global-setup.ts"))
	if err != nil {
		t.Fatal(err)
	}

	setup := string(b)
	steps := templateSteps("host=localhost port=5433 user=user password=password dbname=postgres sslmode=disable", pw)

	// Each template step is a step the single run's setup takes (migrate up-all is its per-service loop, in the same
	// contract order — orderedServicesWithMigrations).
	for _, want := range []string{"san db reset-test", "san migrate up --service", "san region load-seed --file ../frontend/e2e/fixtures/regions.csv",
		"san seed root --password ${ROOT_PASSWORD}"} {
		if !strings.Contains(setup, want) {
			t.Errorf("global-setup.ts no longer runs %q — templateSteps must follow it", want)
		}
	}

	joined := ""
	for _, s := range steps {
		joined += strings.Join(s, " ") + "\n"
	}

	for _, want := range []string{"db reset-test --name warehouse_test_tpl", "migrate up-all --dsn host=localhost port=5433 user=user password=password dbname=warehouse_test_tpl",
		"region load-seed --file ../frontend/e2e/fixtures/regions.csv", "seed root --password " + pw} {
		if !strings.Contains(joined, want) {
			t.Errorf("templateSteps lack %q:\n%s", want, joined)
		}
	}

	if !strings.Contains(setup, "--template ${DB_TEMPLATE}") {
		t.Error("global-setup.ts no longer clones E2E_DB_TEMPLATE")
	}
}

func TestPlanBatchesKeepsTheRestockFamilyTogether(t *testing.T) {
	specs := []string{"racks.spec.ts", "restock_warehouse_wants_to_accept.spec.ts", "restock.spec.ts",
		"restock_selling_wants_to_edit.spec.ts", "settlement_imports.spec.ts", "products.spec.ts", "orders.spec.ts"}

	got := planBatches(specs, batchSize)
	want := []string{"orders.spec.ts", "products.spec.ts racks.spec.ts",
		"restock.spec.ts restock_selling_wants_to_edit.spec.ts restock_warehouse_wants_to_accept.spec.ts", "settlement_imports.spec.ts"}

	if len(got) != len(want) {
		t.Fatalf("batches = %v, want %v", got, want)
	}

	for i := range want {
		if strings.Join(got[i], " ") != want[i] {
			t.Errorf("b%d = %v, want %s", i+1, got[i], want[i])
		}
	}

	if capFor(got[2]) != longSpecCap || capFor([]string{"restock_selling_wants_to_edit.spec.ts"}) != batchCap {
		t.Error("the restock family's batch gets the long cap; one split file alone the batch cap")
	}
}

func TestDsnWithDB(t *testing.T) {
	if got := dsnWithDB("host=h port=1 dbname=postgres sslmode=disable", "warehouse_test_tpl"); got !=
		"host=h port=1 dbname=warehouse_test_tpl sslmode=disable" {
		t.Errorf("got %s", got)
	}
}

// Playwright reads a spec file named on its command line as a pattern matched ANYWHERE in the path, so a spec name
// that ends another's ("restock.spec.ts" inside "…_to_restock.spec.ts") runs both — a worker would run a spec twice
// and the smoke check would count the wrong tests. No spec name may end another.
func TestNoSpecNameEndsAnother(t *testing.T) {
	root, err := findRepoRoot()
	if err != nil {
		t.Skip("no repo root")
	}

	specs, err := specFiles(filepath.Join(root, "frontend"))
	if err != nil {
		t.Fatal(err)
	}

	for _, a := range specs {
		for _, b := range specs {
			if a != b && strings.HasSuffix(b, a) {
				t.Errorf("%s ends with %s: naming %s to Playwright also runs %s — rename one", b, a, a, b)
			}
		}
	}
}

func TestParentRatePrefersTheWholeFileBeforeTheSplit(t *testing.T) {
	// A newer run timed the parent AFTER the split (8 quick screen tests); the old summary timed the whole file (62).
	run := map[string]recordedTime{"restock.spec.ts": {Secs: 40, Tests: 8}}
	old := map[string]recordedTime{"restock.spec.ts": {Secs: 682, Tests: 62}}

	parent, rate, ok := parentRate("restock_warehouse_wants_to_accept.spec.ts", map[string]int{"restock.spec.ts": 8}, run, old)
	if !ok || parent != "restock.spec.ts" || rate != 11 {
		t.Errorf("parentRate = %s %v %v, want restock.spec.ts at 11 s a test (the whole file's)", parent, rate, ok)
	}

	// With only the after-split record, it is still a rate.
	_, rate, ok = parentRate("restock_x.spec.ts", map[string]int{"restock.spec.ts": 8}, run)
	if !ok || rate != 5 {
		t.Errorf("fallback rate = %v %v, want 5", rate, ok)
	}
}
