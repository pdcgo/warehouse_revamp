package main

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"
)

// A full run shares nothing with the live tree's own tests, even on ONE worker: its e2e on warehouse_test_w1,
// :8181/:5181, warehouse-e2e-w1, its go test on warehouse_test_go, its Storybook on a port of its own — and its lock
// stops only what would truly collide (docs/tools/san.md#test-full, "While it runs").

// noListeners makes every port free for a plan, whatever this host runs; listening names ports held by someone.
func noListeners(t *testing.T, listening ...int) {
	t.Helper()

	held := map[int]bool{}
	for _, p := range listening {
		held[p] = true
	}

	old := portListeners
	portListeners = func(port int) []int {
		if held[port] {
			return []int{0x7ffffff0}
		}

		return nil
	}

	t.Cleanup(func() { portListeners = old })
}

func TestOneWorkerPlanIsIsolatedWithTodaysBatches(t *testing.T) {
	specs := []string{"auth.spec.ts", "orders.spec.ts", "products.spec.ts", "racks.spec.ts", "restock.spec.ts",
		"restock_selling_wants_to_edit.spec.ts", "restock_warehouse_wants_to_accept.spec.ts", "settlement_imports.spec.ts",
		"shops.spec.ts", "statement.spec.ts", "suppliers.spec.ts", "teams.spec.ts", "the_closed_shop.spec.ts",
		"users.spec.ts"}

	files := map[string]string{}
	for _, s := range specs {
		files["frontend/e2e/"+s] = "test(\"x\", async () => {});\n"
	}

	root := fakeRepo(t, files)

	p, err := planWorkers(root, specs, 1, "", func(int) bool { return false })
	if err != nil {
		t.Fatal(err)
	}

	if len(p.Workers) != 1 {
		t.Fatalf("%d workers, want 1", len(p.Workers))
	}

	w := p.Workers[0]
	if w.Name != "w1" || w.DB != "warehouse_test_w1" || w.APIPort != 8181 || w.UIPort != 5181 ||
		w.Project != "warehouse-e2e-w1" {
		t.Fatalf("the one worker = %s %s :%d :%d %s — want its own w1, warehouse_test_w1, :8181, :5181, "+
			"warehouse-e2e-w1", w.Name, w.DB, w.APIPort, w.UIPort, w.Project)
	}

	// Never the live tree's database or ports.
	if w.DB == testDBName || w.APIPort == e2eAPIPort || w.UIPort == e2eUIPort {
		t.Fatal("the one worker uses the live tree's warehouse_test or :8081/:5175")
	}

	env := strings.Join(w.env(), " ")
	for _, want := range []string{"E2E_WORKER=w1", "E2E_DB_NAME=warehouse_test_w1", "E2E_DB_TEMPLATE=warehouse_test_tpl",
		"E2E_API_PORT=8181", "E2E_UI_PORT=5181", "E2E_PUBSUB_PROJECT=warehouse-e2e-w1"} {
		if !strings.Contains(env, want) {
			t.Errorf("the worker's environment lacks %s: %s", want, env)
		}
	}

	// Its batches are today's single-database batches, exactly: name order, six a batch, orders alone, the restock
	// family together.
	want := planBatches(specs, batchSize)
	if len(w.Batches) != len(want) {
		t.Fatalf("batches %v, want %v", w.Batches, want)
	}

	for i := range want {
		if strings.Join(w.Batches[i], " ") != strings.Join(want[i], " ") {
			t.Errorf("b%d = %v, want %v", i+1, w.Batches[i], want[i])
		}
	}

	if strings.Join(w.Batches[1], " ") != "orders.spec.ts" ||
		strings.Join(w.Batches[3], " ") != "restock.spec.ts restock_selling_wants_to_edit.spec.ts restock_warehouse_wants_to_accept.spec.ts" {
		t.Errorf("orders alone and the restock family together: %v", w.Batches)
	}

	// And their caps: three times each batch's estimate, at least today's fixed caps — 590 s, the restock family's
	// batch 1500 s (estimatedCap). One test a spec, no recorded run: every estimate is under its floor.
	for i, b := range w.Batches {
		if got, want := p.batchCap(w, i), estimatedCap(b, w.BatchSecs[i]); got != want {
			t.Errorf("b%d cap %s, want %s", i+1, got, want)
		}
	}

	if p.batchCap(w, 3) != longSpecCap || p.batchCap(w, 0) != batchCap {
		t.Error("the restock batch gets at least 1500 s, the others at least 590 s")
	}

	if len(w.BatchSecs) != len(w.Batches) {
		t.Errorf("%d batch estimates for %d batches", len(w.BatchSecs), len(w.Batches))
	}
}

func TestOneWorkerSkipsABusyPortPair(t *testing.T) {
	root := fakeRepo(t, nil)

	busy := func(port int) bool { return port == 5181 }

	p, err := planWorkers(root, []string{"auth.spec.ts"}, 1, "", busy)
	if err != nil {
		t.Fatal(err)
	}

	w := p.Workers[0]
	if w.APIPort != 8182 || w.UIPort != 5182 || w.DB != "warehouse_test_w1" || len(p.Skipped) != 1 {
		t.Fatalf("with :5181 held the one worker takes :%d/:%d (%s), skipped %v — want :8182/:5182", w.APIPort, w.UIPort,
			w.DB, p.Skipped)
	}
}

func TestParallelWorkersKeepTheirOwnCaps(t *testing.T) {
	w := &e2eWorker{Batches: [][]string{{"a.spec.ts"}, {"restock.spec.ts"}}, BatchSecs: []float64{10, 400}}
	p := &workerPlan{Workers: []*e2eWorker{w, {}}}

	if p.batchCap(w, 0) != workerBatchCapMin || p.batchCap(w, 1) != 1200*time.Second {
		t.Errorf("beside another worker: caps %s, %s — want the least cap, then three times the estimate",
			p.batchCap(w, 0), p.batchCap(w, 1))
	}
}

func TestKeepCoupledPutsAGroupInItsFirstBatch(t *testing.T) {
	batches := [][]string{{"a.spec.ts", "b.spec.ts"}, {"c.spec.ts", "d.spec.ts"}, {"e.spec.ts"}}

	got := keepCoupled(batches, [][]string{{"e.spec.ts", "b.spec.ts"}, {"x.spec.ts", "c.spec.ts"}})
	want := []string{"a.spec.ts b.spec.ts e.spec.ts", "c.spec.ts d.spec.ts"}

	if len(got) != len(want) {
		t.Fatalf("batches %v, want %v", got, want)
	}

	for i := range want {
		if strings.Join(got[i], " ") != want[i] {
			t.Errorf("b%d = %v, want %s", i+1, got[i], want[i])
		}
	}

	if strings.Join(batches[0], " ") != "a.spec.ts b.spec.ts" {
		t.Error("keepCoupled changed its input")
	}

	same := keepCoupled(batches, nil)
	if len(same) != 3 {
		t.Errorf("no groups — the batches as they were: %v", same)
	}
}

func TestPlanFullRunsOneIsolatedWorker(t *testing.T) {
	root := fakeRepo(t, map[string]string{
		"frontend/e2e/orders.spec.ts":                            "",
		"frontend/e2e/restock.spec.ts":                           "",
		"frontend/e2e/restock_warehouse_wants_to_accept.spec.ts": "",
	})
	noListeners(t, 6116) // something already holds the first Storybook port
	now := time.Date(2026, 11, 14, 16, 0, 0, 0, time.Local)

	plan, err := planFull(root, fullOptions{Workers: 1}, now)
	if err != nil {
		t.Fatal(err)
	}

	if plan.Shared || plan.Batches != nil || plan.Workers == nil || len(plan.Workers.Workers) != 1 {
		t.Fatalf("--workers 1 = one isolated worker, got %+v", plan)
	}

	if plan.GoDB != goTestDB || plan.GoDB == testDBName {
		t.Errorf("the go test's database %q — want its own %s", plan.GoDB, goTestDB)
	}

	if plan.StoriesPort != 6117 {
		t.Errorf("the Storybook port %d — want 6117, the first free one from %d (6116 is held)", plan.StoriesPort,
			storiesPortMin)
	}

	if names := plan.workerNames(); strings.Join(names, " ") != "w1" {
		t.Errorf("worker names %v", names)
	}

	fp, err := takeFingerprint(root)
	if err != nil {
		t.Fatal(err)
	}

	var out bytes.Buffer

	plan.print(&out, fp, nil)

	// The estimate / dry run shows where the one worker lives, and what may go on meanwhile.
	for _, want := range []string{
		"specs on ONE worker",
		"w1  db warehouse_test_w1 · API :8181 · UI :5181 · events warehouse-e2e-w1",
		"on its own database warehouse_test_go — not warehouse_test",
		"vitest browser port :6117 — not the live tree's :6106",
		"the live frontend/.e2e-lock.w1",
		"a second full run refuses",
		"meanwhile    the live tree's Go DB tests and smoke / affected --run (warehouse_test, :8081/:5175",
		"b2  orders.spec.ts",
		"b3  restock.spec.ts", "restock_warehouse_wants_to_accept.spec.ts",
		"capped at 3× its estimate, at least 9m50s (restock 25m0s)",
		"· cap 25m0s",
		"e2e wall     about",
	} {
		if !strings.Contains(out.String(), want) {
			t.Errorf("the plan lacks %q:\n%s", want, out.String())
		}
	}

	if strings.Contains(out.String(), "the live frontend/.e2e-lock ") || strings.Contains(out.String(), "no Go DB tests") {
		t.Errorf("an isolated run must not claim the live tree's own lock:\n%s", out.String())
	}

	// --shared-db: the old single-database batches on warehouse_test, :8081/:5175.
	plan, err = planFull(root, fullOptions{SharedDB: true}, now)
	if err != nil {
		t.Fatal(err)
	}

	out.Reset()
	plan.print(&out, fp, nil)

	if !plan.Shared || plan.Workers != nil || len(plan.Batches) != 3 || plan.workerNames() != nil ||
		!strings.Contains(out.String(), "--shared-db: 3 batches on warehouse_test, :8081/:5175") ||
		!strings.Contains(out.String(), "no Go DB tests either") {
		t.Fatalf("--shared-db plan:\n%s", out.String())
	}
}

func TestPickFreePortSkipsEveryHolder(t *testing.T) {
	noListeners(t, 6116, 6117)

	port, err := pickFreePort(storiesPortMin, storiesPortSpan)
	if err != nil || port != 6118 {
		t.Fatalf("port %d, %v — want 6118", port, err)
	}

	noListeners(t, 6116, 6117, 6118)

	_, err = pickFreePort(storiesPortMin, 3)
	if err == nil || !strings.Contains(err.Error(), "6116–6118") {
		t.Errorf("every port held: %v", err)
	}
}

func TestWhatALiveFullRunRefuses(t *testing.T) {
	isolated := &fullRunLock{PID: 11, Started: time.Now(), Copy: "D:/c", Workers: []string{"w1"}}
	shared := &fullRunLock{PID: 12, Started: time.Now(), Copy: "D:/c", Shared: true}
	lock := func(pid int) *e2eLock { return &e2eLock{PID: pid, StartedAt: "2026-11-14T09:00:00Z"} }

	cases := []struct {
		name     string
		state    busyState
		liveTree string // what smoke / affected --run are told ("" = they may run)
		accept   string // what accept-run is told
		full     string // what a full run on one worker is told
		fullSh   string // what a --shared-db full run is told
	}{
		{"nothing live", busyState{}, "", "", "", ""},
		{"an isolated full run", busyState{Full: isolated}, "", "moves last_green.json when it ends", "a full run is live",
			"a full run is live"},
		{"a --shared-db full run", busyState{Full: shared}, "a --shared-db full run is live",
			"moves last_green.json when it ends", "a full run is live", "a full run is live"},
		{"a live-tree smoke (frontend/.e2e-lock)", busyState{Locks: map[string]*e2eLock{".e2e-lock": lock(21)}},
			"another e2e run is live", "another e2e run is live", "", "another e2e run is live"},
		{"a live-tree run as worker w1", busyState{Locks: map[string]*e2eLock{".e2e-lock.w1": lock(22)}},
			"", "", "runs as worker w1", ""},
		{"a live-tree run as worker w9", busyState{Locks: map[string]*e2eLock{".e2e-lock.w9": lock(23)}}, "", "", "", ""},
	}

	for _, c := range cases {
		check := func(who string, err error, want string) {
			switch {
			case want == "" && err != nil:
				t.Errorf("%s: %s refused — %v", c.name, who, err)
			case want != "" && (err == nil || !strings.Contains(err.Error(), want)):
				t.Errorf("%s: %s = %v, want %q", c.name, who, err, want)
			}
		}

		check("the live tree's smoke", c.state.liveTreeRefusal(), c.liveTree)
		check("accept-run", c.state.acceptRefusal(), c.accept)
		check("a full run", c.state.fullRefusal(false, []string{"w1"}), c.full)
		check("a --shared-db full run", c.state.fullRefusal(true, nil), c.fullSh)
	}
}

func TestReadBusySeesOthersLocksNotItsOwn(t *testing.T) {
	root := t.TempDir()
	frontend := filepath.Join(root, "frontend")

	err := os.MkdirAll(frontend, 0o755)
	if err != nil {
		t.Fatal(err)
	}

	now := time.Now()

	// This process holding the live tree's worker lock is not "another run".
	release := holdLiveE2ELock(frontend, ".e2e-lock.w1", now)

	s := readBusy(root)
	if s.Full != nil || len(s.Locks) != 0 {
		t.Fatalf("its own lock read as busy: %+v", s)
	}

	release()

	_, err = os.Stat(filepath.Join(frontend, ".e2e-lock.w1"))
	if !os.IsNotExist(err) {
		t.Errorf("the lock was not released: %v", err)
	}

	// Another live process (the test's parent) holding the smoke lock, and a dead one holding w2's.
	other := os.Getppid()

	err = os.WriteFile(filepath.Join(frontend, ".e2e-lock"), []byte(`{"pid":`+strconv.Itoa(other)+`,"startedAt":"x"}`), 0o644)
	if err != nil {
		t.Fatal(err)
	}

	err = os.WriteFile(filepath.Join(frontend, ".e2e-lock.w2"), []byte(`{"pid":2147483632,"startedAt":"x"}`), 0o644)
	if err != nil {
		t.Fatal(err)
	}

	err = os.MkdirAll(reportDir(root), 0o755)
	if err != nil {
		t.Fatal(err)
	}

	b, err := json.Marshal(fullRunLock{PID: other, Started: now, Copy: "D:/c", Workers: []string{"w1"}})
	if err != nil {
		t.Fatal(err)
	}

	err = os.WriteFile(fullLockPath(root), b, 0o644)
	if err != nil {
		t.Fatal(err)
	}

	s = readBusy(root)
	if s.Locks[".e2e-lock"] == nil || s.Locks[".e2e-lock.w2"] != nil || len(s.Locks) != 1 {
		t.Errorf("locks %v — want the live .e2e-lock only (w2's pid is dead)", s.Locks)
	}

	if s.Full == nil || s.Full.Shared || strings.Join(s.Full.Workers, " ") != "w1" {
		t.Errorf("the full run %+v", s.Full)
	}

	// A live isolated full run does not stop the live tree's smoke; the live smoke lock does.
	err = refuseIfBusy(root)
	if err == nil || !strings.Contains(err.Error(), "frontend/.e2e-lock") {
		t.Errorf("refuseIfBusy = %v", err)
	}

	err = os.Remove(filepath.Join(frontend, ".e2e-lock"))
	if err != nil {
		t.Fatal(err)
	}

	err = refuseIfBusy(root)
	if err != nil {
		t.Errorf("an isolated full run must not stop smoke / affected --run: %v", err)
	}

	err = refuseFullIfBusy(root, false, []string{"w1"})
	if err == nil || !strings.Contains(err.Error(), "a full run is live") {
		t.Errorf("a second full run must refuse: %v", err)
	}
}

// What the tester measured on worker w1 (e2e_report/tester/20261117-133040-acceptance-correct-received-count-restock.md
// and the reports before it): the restock family at ~1680 s of spec time — correct count 88 s, lost 121, cancel 157,
// edit 646, raise 245, accept 361, receive 62 — plus restock.spec.ts and restock_references_in_use.spec.ts (~63 s in the
// last full run): 1743 s, over the family's fixed 1500 s. The order acceptance specs beside them
// (20261117-145552…165554): create ~430 s, return-and-stock ~230 s, … — 1116 s in one ordinary batch, over its 590 s.
var measured75 = map[string]float64{
	"a_warehouse_picker_needs_no_two_letters.spec.ts": 6,
	"auth.spec.ts":                                           19,
	"bundles.spec.ts":                                        18,
	"expenses.spec.ts":                                       19,
	"finance_metrics.spec.ts":                                11,
	"financial_accounts.spec.ts":                             42,
	"order_selling_wants_to_create.spec.ts":                  430,
	"order_selling_wants_to_create_debt_limit.spec.ts":       98,
	"order_selling_wants_to_create_return_and_stock.spec.ts": 230,
	"order_warehouse_wants_to_confirm.spec.ts":               39,
	"order_warehouse_wants_to_hand_over.spec.ts":             214,
	"order_warehouse_wants_to_pick.spec.ts":                  105,
	"orders.spec.ts":                                         243,
	"products.spec.ts":                                       27,
	"restock.spec.ts":                                        50,
	"restock_references_in_use.spec.ts":                      13,
	"restock_selling_wants_to_cancel.spec.ts":                157,
	"restock_selling_wants_to_edit.spec.ts":                  646,
	"restock_selling_wants_to_raise.spec.ts":                 245,
	"restock_selling_wants_to_report_lost.spec.ts":           121,
	"restock_warehouse_wants_to_accept.spec.ts":              361,
	"restock_warehouse_wants_to_correct_count.spec.ts":       88,
	"restock_warehouse_wants_to_receive.spec.ts":             62,
}

// measuredRepo is a checkout whose last full run recorded measured75 — one test a spec, so no time is rescaled.
func measuredRepo(t *testing.T) (string, []string) {
	t.Helper()

	files := map[string]string{}
	rec := &RunRecord{ID: "20261117-133040", Kind: "full", E2E: &E2EResult{Specs: map[string]*SpecResult{}}}

	var specs []string

	for s, secs := range measured75 {
		files["frontend/e2e/"+s] = "test(\"x\", async () => {});\n"
		rec.E2E.Specs[s] = &SpecResult{Counts: Counts{Passed: 1}, Secs: secs}
		specs = append(specs, s)
	}

	sort.Strings(specs)

	root := fakeRepo(t, files)

	err := writeJSON(filepath.Join(reportDir(root), "runs", rec.ID, "run.json"), rec)
	if err != nil {
		t.Fatal(err)
	}

	return root, specs
}

// batchHolding is the index of the batch that runs spec.
func batchHolding(t *testing.T, batches [][]string, spec string) int {
	t.Helper()

	for i, b := range batches {
		if contains(b, spec) {
			return i
		}
	}

	t.Fatalf("no batch runs %s: %v", spec, batches)

	return -1
}

// #75: a batch's cap follows what its specs were measured to take — three times it, never under the old fixed cap —
// so the restock family (1743 s) and the order acceptance specs' batch (1116 s) no longer outgrow 1500 s / 590 s.
func TestOneWorkerCapsGrowWithTheMeasuredBatch(t *testing.T) {
	root, specs := measuredRepo(t)

	p, err := planWorkers(root, specs, 1, "", func(int) bool { return false })
	if err != nil {
		t.Fatal(err)
	}

	w := p.Workers[0]

	// The batches are the single-database ones, unchanged: the family still runs together, the order specs in an
	// ordinary batch of six, orders.spec.ts alone.
	if got, want := w.Batches, planBatches(specs, batchSize); len(got) != len(want) {
		t.Fatalf("batches %v, want %v", got, want)
	}

	fam := batchHolding(t, w.Batches, "restock_selling_wants_to_edit.spec.ts")
	ord := batchHolding(t, w.Batches, "order_selling_wants_to_create.spec.ts")
	alone := batchHolding(t, w.Batches, "orders.spec.ts")
	small := batchHolding(t, w.Batches, "auth.spec.ts")

	if len(w.Batches[fam]) != 9 || len(w.Batches[ord]) != 6 || len(w.Batches[alone]) != 1 {
		t.Fatalf("the family (9), the order specs (6) and orders.spec.ts alone: %v", w.Batches)
	}

	cases := []struct {
		name     string
		i        int
		measured float64
		want     time.Duration
	}{
		{"the restock family", fam, 1743, 5229 * time.Second},
		{"the order acceptance specs", ord, 1116, 3348 * time.Second},
		{"orders.spec.ts alone", alone, 243, 729 * time.Second},
		{"a short batch", small, 115, batchCap},
	}

	for _, c := range cases {
		if w.BatchSecs[c.i] != c.measured {
			t.Errorf("%s: estimated %.0f s, want the recorded %.0f s", c.name, w.BatchSecs[c.i], c.measured)
		}

		got := p.batchCap(w, c.i)
		if got != c.want {
			t.Errorf("%s: cap %s, want %s (3× %.0f s, at least %s)", c.name, got, c.want, c.measured, capFor(w.Batches[c.i]))
		}

		if got <= time.Duration(c.measured)*time.Second {
			t.Errorf("%s: cap %s would stop a batch that takes its measured %.0f s", c.name, got, c.measured)
		}
	}

	// The fixed caps these replace would have stopped both mid-run.
	if capFor(w.Batches[fam]) != longSpecCap || longSpecCap >= 1743*time.Second ||
		capFor(w.Batches[ord]) != batchCap || batchCap >= 1116*time.Second {
		t.Error("the measured family / order batch no longer outgrow their fixed caps — the case this test pins is gone")
	}

	var out bytes.Buffer

	p.print(&out, specs)

	if !strings.Contains(out.String(), "restock_warehouse_wants_to_receive.spec.ts (62s)  · about 1743s · cap 1h27m9s") {
		t.Errorf("the plan does not show the family batch's estimate and cap:\n%s", out.String())
	}
}

// The --shared-db batches are capped the same way.
func TestSharedDBCapsGrowWithTheMeasuredBatch(t *testing.T) {
	root, _ := measuredRepo(t)
	noListeners(t)

	plan, err := planFull(root, fullOptions{SharedDB: true}, time.Date(2026, 11, 18, 12, 0, 0, 0, time.Local))
	if err != nil {
		t.Fatal(err)
	}

	if len(plan.BatchCaps) != len(plan.Batches) {
		t.Fatalf("%d caps for %d batches", len(plan.BatchCaps), len(plan.Batches))
	}

	fam := batchHolding(t, plan.Batches, "restock_selling_wants_to_edit.spec.ts")
	ord := batchHolding(t, plan.Batches, "order_selling_wants_to_create.spec.ts")

	if b := plan.sharedBatch(fam); b.Cap != 5229*time.Second || b.N != fam+1 || len(b.Specs) != 9 {
		t.Errorf("the family's --shared-db batch: b%d cap %s, %d specs — want cap 1h27m9s, 9 specs", b.N, b.Cap, len(b.Specs))
	}

	if plan.sharedCap(ord) != 3348*time.Second {
		t.Errorf("the order specs' --shared-db batch: cap %s, want 55m48s", plan.sharedCap(ord))
	}

	fp, err := takeFingerprint(root)
	if err != nil {
		t.Fatal(err)
	}

	var out bytes.Buffer

	plan.print(&out, fp, nil)

	if !strings.Contains(out.String(), "restock_warehouse_wants_to_receive.spec.ts  · cap 1h27m9s") {
		t.Errorf("the --shared-db plan does not show the family batch's cap:\n%s", out.String())
	}
}

// The dry runs — what the tester reads before a run — print the cap each batch will run under: the full run's
// family batch, and affected --run's long spec alone (the edit spec, 646 s: over the 590 s it got before #75).
func TestDryRunsPrintTheMeasuredCaps(t *testing.T) {
	root, _ := measuredRepo(t)
	noListeners(t)

	out, err := runSan(t, root, "test", "full", "--dry-run", "--skip", "go", "--skip", "stories")
	if err != nil || !strings.Contains(out, "restock_warehouse_wants_to_receive.spec.ts (62s)  · about 1743s · cap 1h27m9s") ||
		!strings.Contains(out, "order_warehouse_wants_to_pick.spec.ts (105s)  · about 1116s · cap 55m48s") {
		t.Errorf("full --dry-run: %v\n%s", err, out)
	}

	out, err = runSan(t, root, "test", "affected", "--files", "frontend/e2e/restock_selling_wants_to_edit.spec.ts",
		"--run", "--dry-run")
	if err != nil || !strings.Contains(out, "(cap 32m18s)") || !strings.Contains(out, "restock_selling_wants_to_edit.spec.ts") {
		t.Errorf("affected --run --dry-run: %v\n%s", err, out)
	}
}
