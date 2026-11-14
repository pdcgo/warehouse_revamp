package main

import (
	"context"
	"io"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"testing"
)

// The fixtures in testdata/load_retry are real:
//
//	stories_20261114-100420.txt   the Storybook log of the first full run on a frozen copy (e2e_report/runs/20261114-100420),
//	                              copied byte for byte: 8 suites that failed to import, EmptyHint's 3 stories whose only
//	                              error is a dynamic import's fetch failure, an unhandled "Cannot connect to the iframe"
//	                              for supplier-discover, and Search's "Product code and name" timing out in 15000 ms
//	                              (.txt, not .log: the fingerprint skips *.log, and a fixture is a source file)
//	                              — and its `Test Files` line counts 358 of 387 files: 29 never ran (the browser pool
//	                              stopped the run at the iframe error); firstRunAsIfEveryFileRan mends that line for the
//	                              tests of how each failure is sorted
//	stories_20261114-131538.txt   a later full run's Storybook log (e2e_report/runs/20261114-131538), byte for byte: only
//	                              load failures and an unhandled iframe error — re-run 7/7 green and counted green, while
//	                              32 of its 387 files never ran (`6 failed | 348 passed | 1 skipped (387)`)
//	stories_rerun_green.txt       accept-run's re-run of Logo.stories.tsx alone in the live tree, 2026-11-14 11:10
//	pw_*.json                     Playwright 1.61 JSON reports of a probe batch a_ok / b_broken / c_ok.spec.ts with
//	                              b_broken failing to load three ways (a missing import, a syntax error, a throw while
//	                              evaluated) — and one whose GLOBAL SETUP threw instead

func fixture(t *testing.T, name string) string {
	t.Helper()

	b, err := os.ReadFile(filepath.Join("testdata", "load_retry", name))
	if err != nil {
		t.Fatal(err)
	}

	return string(b)
}

// firstRunAsIfEveryFileRan is the first full run's log with its `Test Files` line made whole (every file counted):
// the real run stopped 29 files short, which alone makes it red (TestClassifyVitestFilesThatNeverRan); the tests of how
// each failure is sorted, and of accept-run, read this one.
func firstRunAsIfEveryFileRan(t *testing.T) string {
	t.Helper()

	const cut, whole = "Test Files  10 failed | 347 passed | 1 skipped (387)", "Test Files  10 failed | 376 passed | 1 skipped (387)"

	log := fixture(t, "stories_20261114-100420.txt")
	if !strings.Contains(log, cut) {
		t.Fatal("the fixture changed")
	}

	return strings.Replace(log, cut, whole, 1)
}

// loadsOf20261114 are the files of the first full run that failed only to LOAD, in the order the log names them.
var loadsOf20261114 = []string{
	"src/components/badges/SettlementSourceBadge.stories.tsx",
	"src/components/chrome/ColorModeToggle.stories.tsx",
	"src/components/chrome/Logo.stories.tsx",
	"src/pages/restock-form/index.stories.tsx",
	"src/pages/supplier-discover-detail/index.stories.tsx",
	"src/components/chrome/StatsToggle.stories.tsx",
	"src/pages/products/index.stories.tsx",
	"src/features/orders/form/WarehouseBand.stories.tsx",
	"src/components/feedback/EmptyHint.stories.tsx",
	"src/pages/supplier-discover/index.stories.tsx",
}

const searchStory = "src/pages/product-discover/stories/Search.stories.tsx"

func TestClassifyVitestTheFirstFullRun(t *testing.T) {
	c := classifyVitest(firstRunAsIfEveryFileRan(t), 1, false)

	if got := c.loadFiles(); !reflect.DeepEqual(got, loadsOf20261114) {
		t.Errorf("load files\n got %v\nwant %v", got, loadsOf20261114)
	}

	if len(c.Check) != 1 || c.Check[0].File != searchStory || c.Check[0].Why != "Test timed out in 15000ms." ||
		!reflect.DeepEqual(c.Check[0].Tests, []string{"Product code and name"}) {
		t.Errorf("the Search timeout is a CHECK failure by the rule: %+v", c.Check)
	}

	if len(c.Unattributed) > 0 {
		t.Errorf("every failure of the run names its file: %v", c.Unattributed)
	}

	empty, kind := c.find("src/components/feedback/EmptyHint.stories.tsx")
	if kind != "load" || len(empty.Tests) != 3 || !strings.Contains(empty.Why, "@storybook_react-dom-shim.js") {
		t.Errorf("EmptyHint's stories failed only on a dynamic import — load: %s %+v", kind, empty)
	}

	iframe, kind := c.find("src/pages/supplier-discover/index.stories.tsx")
	if kind != "load" || !strings.Contains(iframe.Why, sigIframe) {
		t.Errorf("the unhandled iframe error is supplier-discover's load failure: %s %+v", kind, iframe)
	}

	if c.retriable() {
		t.Error("a check failed — the run cannot turn green by re-running its load failures")
	}
}

// TestClassifyVitestFilesThatNeverRan: vitest's browser pool stops the whole run at the first file that errors, so
// the files still queued sit in the `Test Files` total and in none of its counts. Re-running the load-failed files
// would leave those untested and call the run green — 20261114-131538's Storybook part was (re-run 7/7 green).
func TestClassifyVitestFilesThatNeverRan(t *testing.T) {
	c := classifyVitest(fixture(t, "stories_20261114-131538.txt"), 1, false)

	if len(c.Load) == 0 || len(c.Check) != 0 {
		t.Fatalf("its failures are all loads (with the iframe error): load %d check %d %+v", len(c.Load), len(c.Check), c)
	}

	if len(c.Unattributed) != 1 || !strings.Contains(c.Unattributed[0], "vitest ran 355 of 387 story files — 32 never ran") {
		t.Errorf("32 files never ran — red: %v", c.Unattributed)
	}

	if c.retriable() {
		t.Error("a run that dropped files cannot turn green by re-running its load failures")
	}

	c = classifyVitest(fixture(t, "stories_20261114-100420.txt"), 1, false)
	if len(c.Unattributed) != 1 || !strings.Contains(c.Unattributed[0], "29 never ran") {
		t.Errorf("the first full run stopped 29 files short: %v", c.Unattributed)
	}

	for _, tc := range []struct {
		line string
		ran  int
		ok   bool
	}{
		{" Test Files  386 passed | 1 skipped (387)", 387, true},
		{" Test Files  4 failed | 354 passed | 1 skipped | 2 todo (387)", 361, true},
		{"\x1b[2m Test Files \x1b[22m \x1b[1m\x1b[31m3 failed\x1b[39m\x1b[22m\x1b[2m | \x1b[22m\x1b[1m\x1b[32m8 passed\x1b[39m" +
			"\x1b[22m\x1b[90m (11)\x1b[39m", 11, true},
		{" Test Files  0 passed", 0, false},
	} {
		ran, _, ok := vitestFilesRan(" RUN  v4.1.10\n\n" + tc.line + "\n")
		if ran != tc.ran || ok != tc.ok {
			t.Errorf("%q: ran %d ok %v, want %d %v", tc.line, ran, ok, tc.ran, tc.ok)
		}
	}
}

// vitestLog wraps failure blocks in the frame vitest prints around them.
func vitestLog(failedFiles, failedTests int, sections string) string {
	return " RUN  v4.1.10 D:/x/frontend\n\n" + sections + "\n\n Test Files  " +
		strconv.Itoa(failedFiles) + " failed | 10 passed (" + strconv.Itoa(failedFiles+10) + ")\n      Tests  " +
		strconv.Itoa(failedTests) + " failed | 50 passed (" + strconv.Itoa(failedTests+50) + ")\n"
}

func TestClassifyVitestIsConservative(t *testing.T) {
	sep := "⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/2]⎯\n"
	tests := "⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯\n\n"
	suites := "⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯\n\n"
	unhandled := "⎯⎯⎯⎯⎯⎯ Unhandled Errors ⎯⎯⎯⎯⎯⎯\n\nVitest caught 1 unhandled error during the test run.\n\n" +
		"⎯⎯⎯⎯⎯⎯ Unhandled Error ⎯⎯⎯⎯⎯⎯⎯\n"

	cases := []struct {
		name  string
		log   string
		exit  int
		cap   bool
		load  int
		check int
		unatt int
	}{
		{"a dynamic import failure beside an assertion is a check", vitestLog(1, 1, tests+
			" FAIL  |storybook (chromium)| src/a/A.stories.tsx > Opens\nTypeError: \n"+
			"Failed to fetch dynamically imported module: http://localhost:6106/x.js\nAssertionError: expected 1 to be 2\n"+sep),
			1, false, 0, 1, 0},
		{"a story's dynamic import failure alone is a load", vitestLog(1, 1, tests+
			" FAIL  |storybook (chromium)| src/a/A.stories.tsx > Opens\nTypeError: \n"+
			"Click to debug the error directly in Storybook: http://localhost:6006/?path=/story/a\n\n"+
			"Failed to fetch dynamically imported module: http://localhost:6106/x.js?v=1\n"+sep),
			1, false, 1, 0, 0},
		{"a suite failing in a hook is a check", vitestLog(1, 0, suites+
			" FAIL  |storybook (chromium)| src/a/A.stories.tsx [ src/a/A.stories.tsx ]\nError: beforeAll hook failed\n"+sep),
			1, false, 0, 1, 0},
		{"a timeout is a check", vitestLog(1, 1, tests+
			" FAIL  |storybook (chromium)| src/a/A.stories.tsx > Opens\nError: \nTest timed out in 15000ms.\n"+sep),
			1, false, 0, 1, 0},
		{"one load story and one failed story make the FILE a check", vitestLog(1, 2, tests+
			" FAIL  |storybook (chromium)| src/a/A.stories.tsx > Opens\nTypeError: \n"+
			"Failed to fetch dynamically imported module: http://localhost:6106/x.js\n"+sep+"\n"+
			" FAIL  |storybook (chromium)| src/a/A.stories.tsx > Saves\nAssertionError: expected 1 to be 2\n"+
			"⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/2]⎯\n"), 1, false, 0, 1, 0},
		{"an unhandled error naming no file is unattributed", vitestLog(0, 0, unhandled+
			"Error: socket hang up\n ❯ node_modules/x.js:1:1\n⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯\n") + "     Errors  1 error\n",
			1, false, 0, 0, 1},
		{"an unhandled error naming a file, not the iframe, is a check", vitestLog(0, 0, unhandled+
			"Error: Failed to run the test D:/x/frontend/src/a/A.stories.tsx.\nCaused by: Error: out of memory\n"+
			"⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯\n") + "     Errors  1 error\n", 1, false, 0, 1, 0},
		{"more failed files counted than named is unattributed", vitestLog(2, 0, suites+
			" FAIL  |storybook (chromium)| src/a/A.stories.tsx [ src/a/A.stories.tsx ]\n"+
			"Error: Failed to import test file D:/x/frontend/src/a/A.stories.tsx\n"+sep), 1, false, 1, 0, 1},
		{"files that never ran are unattributed", strings.Replace(vitestLog(1, 0, suites+
			" FAIL  |storybook (chromium)| src/a/A.stories.tsx [ src/a/A.stories.tsx ]\n"+
			"Error: Failed to import test file D:/x/frontend/src/a/A.stories.tsx\n"+sep), "10 passed (11)", "7 passed (11)", 1),
			1, false, 1, 0, 1},
		{"a cap hit is unattributed", " RUN  v4.1.10\n ❯ src/a/A.stories.tsx (3 tests)\n", 124, true, 0, 0, 1},
		{"no summary and no failure is unattributed", " RUN  v4.1.10\nError: Browser connection was closed\n", 1, false,
			0, 0, 1},
	}

	for _, tc := range cases {
		c := classifyVitest(tc.log, tc.exit, tc.cap)
		if len(c.Load) != tc.load || len(c.Check) != tc.check || len(c.Unattributed) != tc.unatt {
			t.Errorf("%s: load %d check %d unattributed %d, want %d %d %d\n%+v", tc.name, len(c.Load), len(c.Check),
				len(c.Unattributed), tc.load, tc.check, tc.unatt, c)
		}
	}
}

// loadOnlyLog is the first full run's log without the Search timeout: only load failures are left.
func loadOnlyLog(t *testing.T) string {
	t.Helper()

	log := firstRunAsIfEveryFileRan(t)

	start := strings.Index(log, " FAIL  |storybook (chromium)| "+searchStory+" > Product code and name")
	end := strings.Index(log[start:], "[7/12]⎯")

	if start < 0 || end < 0 {
		t.Fatal("the fixture changed")
	}

	log = log[:start] + log[start+end+len("[7/12]⎯"):]

	return strings.Replace(log, "Test Files  10 failed | 376 passed", "Test Files  9 failed | 377 passed", 1)
}

func TestJudgeStoryRerun(t *testing.T) {
	r := &Rerun{}
	judgeStoryRerun(r, fixture(t, "stories_rerun_green.txt"))

	if !r.Green || r.Passed != 5 || r.Result != "✓ 5 passed" {
		t.Errorf("a green one-file run: %+v", r)
	}

	r = &Rerun{Exit: 1}
	judgeStoryRerun(r, loadOnlyLog(t))

	if r.Green || !strings.Contains(r.Result, "failed to load again") {
		t.Errorf("failing to load on the re-run is red: %+v", r)
	}

	r = &Rerun{Exit: 1}
	judgeStoryRerun(r, fixture(t, "stories_20261114-100420.txt"))

	if r.Green || !strings.Contains(r.Result, "4 failed") {
		t.Errorf("a failed check on the re-run is red: %+v", r)
	}

	r = &Rerun{Exit: 0}
	judgeStoryRerun(r, " RUN  v4.1.10\n\n Test Files  0 passed\n")

	if r.Green {
		t.Errorf("a re-run that ran no test is not green: %+v", r)
	}
}

func writeLog(t *testing.T, log string) string {
	t.Helper()

	p := filepath.Join(t.TempDir(), "stories.log")

	err := os.WriteFile(p, []byte(log), 0o644)
	if err != nil {
		t.Fatal(err)
	}

	return p
}

// countingRunner is a storyRunner that records each file it ran; red names files it fails.
func countingRunner(calls map[string]int, red map[string]bool) storyRunner {
	return func(_ context.Context, file, logPath string) *Rerun {
		calls[file]++

		r := &Rerun{File: file, Log: logPath}
		if red[file] {
			r.Exit = 1
			r.Result = "✗ failed to load again — a second load failure is red"
		} else {
			r.Green, r.Passed, r.Result = true, 3, "✓ 3 passed"
		}

		return r
	}
}

func TestRerunStoryLoadsRunsEachLoadFailedFileOnce(t *testing.T) {
	// The first full run as it was: a check failed (Search), so nothing is re-run — it is red.
	calls := map[string]int{}
	p := &PartResult{Exit: 1, Failed: 4, Log: writeLog(t, fixture(t, "stories_20261114-100420.txt"))}
	rec := &RunRecord{Stories: p}
	rec.Reruns = rerunStoryLoads(context.Background(), p, t.TempDir(), "the frozen copy", countingRunner(calls, nil), io.Discard)

	if len(calls) != 0 || len(rec.Reruns) != 0 || rec.storiesGreen() {
		t.Fatalf("a run with a failed check re-runs nothing and stays red: %v", calls)
	}

	if p.Classes == nil || len(p.Classes.Load) != 10 || len(p.Classes.Check) != 1 {
		t.Errorf("the part keeps its failures per file: %+v", p.Classes)
	}

	// Load failures only: each file once, by itself; all green → green.
	calls = map[string]int{}
	p = &PartResult{Exit: 1, Failed: 3, Log: writeLog(t, loadOnlyLog(t))}
	rec = &RunRecord{Stories: p}
	rec.Reruns = rerunStoryLoads(context.Background(), p, t.TempDir(), "the frozen copy", countingRunner(calls, nil), io.Discard)

	if len(calls) != 10 {
		t.Fatalf("10 load-failed files, %d run: %v", len(calls), calls)
	}

	for f, n := range calls {
		if n != 1 {
			t.Errorf("%s ran %d times, want once", f, n)
		}
	}

	if calls[searchStory] != 0 {
		t.Error("the Search story is not in this log")
	}

	if !rec.storiesGreen() || len(rec.Reruns) != 10 || rec.Reruns[0].Kind != "load" || rec.Reruns[0].Where != "the frozen copy" ||
		!strings.Contains(rec.Reruns[0].Why, sigImport) {
		t.Errorf("every load failure green on its one re-run → green: %+v", rec.Reruns[0])
	}

	// One file fails to load again: red, and it is NOT run a third time.
	calls = map[string]int{}
	p = &PartResult{Exit: 1, Failed: 3, Log: writeLog(t, loadOnlyLog(t))}
	rec = &RunRecord{Stories: p}
	logo := "src/components/chrome/Logo.stories.tsx"
	rec.Reruns = rerunStoryLoads(context.Background(), p, t.TempDir(), "the frozen copy",
		countingRunner(calls, map[string]bool{logo: true}), io.Discard)

	if rec.storiesGreen() || calls[logo] != 1 {
		t.Errorf("a second load failure is red and never retried: green=%v calls=%d", rec.storiesGreen(), calls[logo])
	}
}

func TestClassifyPlaywrightLoad(t *testing.T) {
	specs := []string{"a_ok.spec.ts", "b_broken.spec.ts", "c_ok.spec.ts"}
	dir := t.TempDir()

	read := func(name string) *playwrightSummary {
		p := filepath.Join(dir, name)

		err := os.WriteFile(p, []byte(fixture(t, name)), 0o644)
		if err != nil {
			t.Fatal(err)
		}

		rep, err := parsePlaywrightJSON(p)
		if err != nil {
			t.Fatal(err)
		}

		return rep
	}

	for _, name := range []string{"pw_missing_import.json", "pw_syntax_error.json", "pw_throw_on_load.json"} {
		load, ok := classifyPlaywrightLoad(specs, read(name))
		if !ok || len(load) != 1 || load[0].File != "b_broken.spec.ts" || !strings.HasPrefix(load[0].Why, "failed to load: ") {
			t.Errorf("%s: b_broken.spec.ts failed to load: %v %+v", name, ok, load)
		}
	}

	if _, ok := classifyPlaywrightLoad(specs, read("pw_global_setup.json")); ok {
		t.Error("the global setup throwing is not a spec's load failure")
	}

	if _, ok := classifyPlaywrightLoad([]string{"a_ok.spec.ts", "c_ok.spec.ts"}, read("pw_missing_import.json")); ok {
		t.Error("an error naming a spec outside the batch is not this batch's load failure")
	}

	rep := read("pw_missing_import.json")
	rep.Loaded = true

	if _, ok := classifyPlaywrightLoad(specs, rep); ok {
		t.Error("a report whose suites loaded is not a load failure")
	}

	rep = read("pw_missing_import.json")
	rep.Counts.Passed = 1

	if _, ok := classifyPlaywrightLoad(specs, rep); ok {
		t.Error("a report that ran a test is not a load failure")
	}
}

// fakeBatches is a batchRunner: each fresh batch passes, except specs in red, whose batch fails to load again
// (the missing-import report written beside its log).
func fakeBatches(t *testing.T, dir string, calls *[][]string, red map[string]bool) batchRunner {
	return func(_ context.Context, b *BatchResult, seat e2eSeat) error {
		*calls = append(*calls, append([]string(nil), b.Specs...))
		b.Log = filepath.Join(dir, b.name()+".log")
		b.specs = map[string]*SpecResult{}

		for _, s := range b.Specs {
			if red[s] {
				b.Exit = 1

				err := os.WriteFile(jsonPathOf(b), []byte(fixture(t, "pw_missing_import.json")), 0o644)
				if err != nil {
					t.Fatal(err)
				}

				return nil
			}
		}

		for _, s := range b.Specs {
			b.specs[s] = &SpecResult{Counts: Counts{Passed: 2}, Secs: 3}
			b.Counts.add(Counts{Passed: 2})
		}

		return nil
	}
}

func loadFailedE2E(t *testing.T) (*E2EResult, string) {
	t.Helper()

	dir := t.TempDir()
	b := &BatchResult{N: 2, Worker: "w1", Specs: []string{"a_ok.spec.ts", "b_broken.spec.ts", "c_ok.spec.ts"}, Exit: 1,
		Log: filepath.Join(dir, "w1-b2.log")}

	err := os.WriteFile(jsonPathOf(b), []byte(fixture(t, "pw_missing_import.json")), 0o644)
	if err != nil {
		t.Fatal(err)
	}

	ok := &BatchResult{N: 1, Worker: "w1", Specs: []string{"auth.spec.ts"}, Counts: Counts{Passed: 9}}

	return &E2EResult{Batches: []*BatchResult{ok, b}, Specs: map[string]*SpecResult{}}, dir
}

func TestRerunE2ELoadsRunsEachSpecOnce(t *testing.T) {
	e, dir := loadFailedE2E(t)

	if e.green() {
		t.Fatal("a batch that failed to load is red before its re-run")
	}

	var calls [][]string

	seat := func(w string) e2eSeat { return e2eSeat{Worker: w} }
	reruns := rerunE2ELoads(context.Background(), e, seat, "the frozen copy", fakeBatches(t, dir, &calls, nil), io.Discard)

	want := [][]string{{"b_broken.spec.ts"}, {"a_ok.spec.ts", "c_ok.spec.ts"}}
	if !reflect.DeepEqual(calls, want) {
		t.Fatalf("the load-failed spec alone, then the rest once: %v", calls)
	}

	if !e.green() || len(reruns) != 3 || e.Batches[2].RerunOf != "w1-b2" || e.Batches[2].name() != "w1-rerun1" {
		t.Fatalf("green after its fresh batches: green=%v reruns=%d batches=%+v", e.green(), len(reruns), e.Batches)
	}

	kinds := map[string]string{}
	for _, r := range reruns {
		kinds[r.File] = r.Kind
	}

	if kinds["b_broken.spec.ts"] != "load" || kinds["a_ok.spec.ts"] != "never-ran" || e.total().Passed != 9+6 {
		t.Errorf("kinds %v, total %v", kinds, e.total())
	}

	// A spec of the load-failed batch with no fresh batch (the run was cut off before it) leaves it red.
	e.Batches = e.Batches[:len(e.Batches)-1]
	if e.green() {
		t.Error("a load-failed batch counts green only when every one of its specs ran again")
	}

	// Failing to load again: red, and not run a third time.
	e, dir = loadFailedE2E(t)
	calls = nil
	reruns = rerunE2ELoads(context.Background(), e, seat, "the frozen copy",
		fakeBatches(t, dir, &calls, map[string]bool{"b_broken.spec.ts": true}), io.Discard)

	if e.green() || len(calls) != 2 || !strings.Contains(reruns[0].Result, "failed to load again") {
		t.Errorf("a second load failure is red, never retried: green=%v calls=%v %+v", e.green(), calls, reruns[0])
	}

	// A batch that failed a test: nothing is re-run.
	e, dir = loadFailedE2E(t)
	e.Batches[0].Counts.Failed, e.Batches[0].Exit = 1, 1
	calls = nil

	if rerunE2ELoads(context.Background(), e, seat, "the frozen copy", fakeBatches(t, dir, &calls, nil), io.Discard) != nil ||
		len(calls) != 0 {
		t.Errorf("a failed check re-runs nothing: %v", calls)
	}
}

func TestNormStoryPath(t *testing.T) {
	for in, want := range map[string]string{
		"src/a/A.stories.tsx": "src/a/A.stories.tsx",
		"D:/hermes/cache/scratch/san_frozen_1114/frontend/src/pages/supplier-discover/index.stories.tsx.": "src/pages/supplier-discover/index.stories.tsx",
		`D:\pdcgo\warehouse_revamp\frontend\src\a\A.stories.tsx`:                                          "src/a/A.stories.tsx",
		"frontend/src/a/A.stories.tsx":                                                                    "src/a/A.stories.tsx",
	} {
		if got := normStoryPath(in); got != want {
			t.Errorf("%s → %s, want %s", in, got, want)
		}
	}
}
