package main

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// PARALLEL WORKERS for the full e2e (`san test full --workers N`, backlog #51 — the "afterwards" of
// the-full-e2e-waits-for-a-measured-yes). The suite used to run name-ordered on ONE test database in ten batches,
// ~33–35 min. Now N workers run at once, each a whole Playwright run of its own with its OWN of everything a run
// touches — so no worker can see, reset or be pushed another's data:
//
//	database   warehouse_test_w1 …, each batch's a fresh CLONE of warehouse_test_tpl, which is migrated and seeded
//	           once per run (templateSteps — the steps e2e/global-setup.ts runs, against the template)
//	ports      API 8181…, UI 5181… — a port another program holds is skipped, never killed
//	events     the Pub/Sub emulator project warehouse-e2e-w1 …, its push subscriptions pointed at the worker's own API
//	the rest   its run lock (.e2e-lock.w1), output folder (test-results/w1), Vite cache (node_modules/.vite-e2e-w1)
//
// The specs are shared out LONGEST FIRST (each to the worker with the least work so far) by the per-spec times the
// last full runs recorded (e2e_report/runs/*/run.json), an old e2e_batches.sh summary.txt (--times), or the spec's
// test count. Inside a worker they still run in NAME order, in batches of up to six on one database each — so every
// "named to sort after orders.spec.ts" rule still holds there. Specs that must share ONE database (one reads what an
// earlier one wrote) are listed in frontend/e2e/coupled.txt and travel as one unit: same worker, same batch, in order.
//
// N=3 by default — measured on this machine 2026-11-14 (docs/tools/san.md#test-full): 31.8 GB RAM, ~18.7 GB free
// idle; 8 cores / 16 threads; one worker (Go API + Vite + Chromium + Playwright) peaks at about 1.5 GB.

const (
	defaultWorkers = 3
	maxWorkers     = 6

	templateDB       = "warehouse_test_tpl"
	workerAPIPortMin = 8181
	workerUIPortMin  = 5181
	workerPortSpan   = 40 // how far past the first port a worker's port is looked for

	// batchOverhead is what a worker's batch costs beside its tests: the clone, the topics, the API and Vite starting
	// (Vite's cache cold in a fresh copy), the sign-in saved, the teardown — 30–34 s on the 3-worker subset run of
	// 2026-11-14.
	batchOverhead = 32 * time.Second
	// singleBatchOverhead is the same for a single-run batch, which migrates instead of cloning: the 2026-11-13 run's
	// ten batches took 2063 s, their tests about 1810 s.
	singleBatchOverhead = 25 * time.Second
	// templateCost is migrating and seeding the template once per run — 15 s measured on 2026-11-14.
	templateCost = 20 * time.Second
	// secsPerTest is a test's time when nothing better is known (the 2026-11-13 run: ~2000 s over ~313 tests).
	secsPerTest = 6.5
	// parallelSlowdown is how much slower a spec runs beside the other workers than alone (CPU shared): ×1.1 over the
	// 3-worker subset run of 2026-11-14 (orders.spec.ts ×1.02, the small specs ×1.3 — their first test also warms
	// Vite's cold cache).
	parallelSlowdown = 1.2
	// workerBatchCapMin is a worker batch's least cap; a longer estimate gets three times its estimate.
	workerBatchCapMin = batchCap
)

// specUnit is what is placed on a worker: one spec, or the coupled specs that must share one database, name-ordered.
type specUnit struct {
	Specs []string
	Secs  float64
}

func (u specUnit) name() string {
	return strings.Join(u.Specs, "+")
}

// e2eWorker is one worker of a parallel run: where it lives, and what it runs.
type e2eWorker struct {
	Name    string     `json:"name"`
	DB      string     `json:"db"`
	APIPort int        `json:"api_port"`
	UIPort  int        `json:"ui_port"`
	Project string     `json:"pubsub_project"`
	Units   []specUnit `json:"-"`
	Batches [][]string `json:"batches"`
	// BatchSecs is each batch's estimated test time, before the batch overhead and the parallel slowdown.
	BatchSecs []float64 `json:"batch_secs"`
	Secs      int       `json:"secs,omitempty"` // how long it actually took
}

// estimate is the worker's wall time: its batches' tests (slowed by the workers beside it) plus each batch's overhead.
func (w *e2eWorker) estimate(workers int) time.Duration {
	slow := 1.0
	if workers > 1 {
		slow = parallelSlowdown
	}

	var secs float64
	for _, s := range w.BatchSecs {
		secs += s * slow
	}

	return time.Duration(secs*float64(time.Second)) + time.Duration(len(w.Batches))*batchOverhead
}

// env is the environment that makes a Playwright run this worker (frontend/e2e/env.ts reads it).
func (w *e2eWorker) env() []string {
	return []string{
		"E2E_WORKER=" + w.Name,
		"E2E_API_PORT=" + strconv.Itoa(w.APIPort),
		"E2E_UI_PORT=" + strconv.Itoa(w.UIPort),
		"E2E_DB_NAME=" + w.DB,
		"E2E_DB_TEMPLATE=" + templateDB,
		"E2E_PUBSUB_PROJECT=" + w.Project,
		// The single run's CI overrides would send every worker to one address: each worker binds its own port.
		"E2E_API_ADDR=localhost:" + strconv.Itoa(w.APIPort),
		"E2E_PUSH_BASE_URL=http://host.docker.internal:" + strconv.Itoa(w.APIPort),
	}
}

// ── per-spec times ─────────────────────────────────────────────────────────────────────────────────

// specTime is what one spec is expected to take, and where that came from.
type specTime struct {
	Secs   float64
	Source string // "run <id>", "summary.txt", "restock.spec.ts's rate", "N tests"
}

var testCallRe = regexp.MustCompile("(?m)(?:^|[^.\\w])test(?:\\.(?:fail|skip|only|fixme))?\\(\\s*[\"'`]")

// countTests is how many tests a spec file declares by its test( calls — an undercount where a loop declares one
// test per role; testCounts asks Playwright instead and keeps this only as the fallback.
func countTests(frontend, spec string) int {
	b, err := os.ReadFile(filepath.Join(frontend, "e2e", spec))
	if err != nil {
		return 0
	}

	return len(testCallRe.FindAllIndex(b, -1))
}

// recordedTime is one spec's time as a run recorded it, with how many tests it had then.
type recordedTime struct {
	Secs   float64
	Tests  int
	Source string
}

// recordedTimes reads the per-spec times of the recorded full runs, newest first (a spec keeps its newest).
func recordedTimes(rep string) map[string]recordedTime {
	out := map[string]recordedTime{}

	entries, err := os.ReadDir(filepath.Join(rep, "runs"))
	if err != nil {
		return out
	}

	sort.Slice(entries, func(i, j int) bool { return entries[i].Name() > entries[j].Name() })

	for _, e := range entries {
		rec, err := readRun(filepath.Join(rep, "runs", e.Name(), "run.json"))
		if err != nil || rec.E2E == nil || len(rec.Workers) > defaultWorkers {
			// More workers than the default share the CPU so thinly that their times say little about a spec
			// (five workers ran the restock specs about twice as slow, 2026-11-14).
			continue
		}

		// A parallel run's times carry its CPU sharing; the estimate adds it back for the run it plans.
		slow := 1.0
		if len(rec.Workers) > 1 {
			slow = parallelSlowdown
		}

		for name, s := range rec.E2E.Specs {
			tests := s.Passed + s.Failed + s.Flaky + s.Skipped
			if _, seen := out[name]; seen || tests == 0 || s.Secs <= 0 {
				continue
			}

			out[name] = recordedTime{Secs: s.Secs / slow, Tests: tests, Source: "run " + rec.ID}
		}
	}

	return out
}

var (
	summaryBatchRe = regexp.MustCompile(`^b(\d+) exit=\S+ secs=(\d+) specs=\s*(.*)$`)
	logTestRe      = regexp.MustCompile(`^\[\d+/\d+\] \[chromium\] › e2e[\\/](\S+\.spec\.ts):`)
)

// summaryTimes reads an old e2e_batches.sh summary.txt: each batch's seconds, shared among its specs by the tests
// each ran (counted from the b<N>.log beside it, else from the spec file), after the batch's own overhead.
func summaryTimes(path, frontend string) (map[string]recordedTime, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}

	defer func() { _ = f.Close() }()

	out := map[string]recordedTime{}
	sc := bufio.NewScanner(f)

	for sc.Scan() {
		m := summaryBatchRe.FindStringSubmatch(strings.TrimSpace(sc.Text()))
		if m == nil {
			continue
		}

		secs, _ := strconv.Atoi(m[2])
		specs := strings.Fields(m[3])
		tests := testsInLog(filepath.Join(filepath.Dir(path), "b"+m[1]+".log"))

		total := 0

		for _, s := range specs {
			if tests[s] == 0 {
				tests[s] = countTests(frontend, s)
			}

			total += tests[s]
		}

		run := math.Max(float64(secs)-singleBatchOverhead.Seconds(), float64(secs)/2)

		// No log and no file to count tests in: an even share, its test count unknown (so never scaled).
		if total == 0 {
			for _, s := range specs {
				out[s] = recordedTime{Secs: run / float64(len(specs)), Source: "summary.txt"}
			}

			continue
		}

		for _, s := range specs {
			out[s] = recordedTime{Secs: run * float64(tests[s]) / float64(total), Tests: tests[s], Source: "summary.txt"}
		}
	}

	return out, sc.Err()
}

// testsInLog counts the tests a Playwright line-reporter log ran, per spec.
func testsInLog(path string) map[string]int {
	out := map[string]int{}

	b, err := os.ReadFile(path)
	if err != nil {
		return out
	}

	for _, line := range strings.Split(string(b), "\n") {
		m := logTestRe.FindStringSubmatch(strings.TrimSpace(line))
		if m != nil {
			out[m[1]]++
		}
	}

	return out
}

var listLineRe = regexp.MustCompile(`^\s*\[chromium\] › (\S+\.spec\.ts):\d+:\d+ › `)

// testCounts asks Playwright how many tests each spec holds (`--list` starts no server and runs no setup); a spec
// it cannot tell (Playwright failed) falls back to its test( calls.
func testCounts(ctx context.Context, frontend string, specs []string) map[string]int {
	out := map[string]int{}

	logPath := filepath.Join(os.TempDir(), fmt.Sprintf("san_list_%d.log", os.Getpid()))
	defer func() { _ = os.Remove(logPath) }()

	res, err := runCapped(ctx, frontend, playwrightArgv(frontend, "--list"), nil, logPath, 2*time.Minute, nil)
	if err == nil && res.Exit == 0 {
		b, _ := os.ReadFile(logPath)

		for _, line := range strings.Split(string(b), "\n") {
			m := listLineRe.FindStringSubmatch(strings.TrimRight(line, "\r"))
			if m != nil {
				out[filepath.Base(filepath.FromSlash(m[1]))]++
			}
		}
	}

	for _, s := range specs {
		if out[s] == 0 {
			out[s] = countTests(frontend, s)
		}
	}

	return out
}

// estimateSpecTimes says how long each spec takes: the newest recorded run, else an old summary.txt (--times), else
// the per-test rate of the spec it was split from (restock_x.spec.ts ← restock.spec.ts), else its test count. A
// recorded time is scaled by the tests the file holds NOW (counts) when they differ (a spec that grew or was split).
func estimateSpecTimes(root string, specs []string, timesFile string, counts map[string]int) (map[string]specTime, error) {
	frontend := filepath.Join(root, "frontend")
	rec := recordedTimes(reportDir(root))
	sum := map[string]recordedTime{}

	if timesFile != "" {
		var err error

		sum, err = summaryTimes(timesFile, frontend)
		if err != nil {
			return nil, fmt.Errorf("--times %s: %w", timesFile, err)
		}

		for k, v := range sum {
			if _, ok := rec[k]; !ok {
				rec[k] = v
			}
		}
	}

	out := map[string]specTime{}

	for _, s := range specs {
		tests, known := counts[s]
		if !known {
			tests = countTests(frontend, s)
		}

		r, ok := rec[s]

		switch {
		case ok && (r.Tests == tests || r.Tests == 0 || tests == 0):
			out[s] = specTime{Secs: r.Secs, Source: r.Source}
		case ok:
			out[s] = specTime{Secs: r.Secs * float64(tests) / float64(r.Tests), Source: fmt.Sprintf("%s, scaled %d→%d tests", r.Source, r.Tests, tests)}
		default:
			if parent, pr, found := parentRate(s, counts, rec, sum); found && tests > 0 {
				out[s] = specTime{Secs: pr * float64(tests), Source: fmt.Sprintf("%d tests at %s's rate", tests, parent)}

				continue
			}

			n := tests
			if n == 0 {
				n = 1
			}

			out[s] = specTime{Secs: secsPerTest * float64(n), Source: fmt.Sprintf("%d tests × %.1fs", n, secsPerTest)}
		}
	}

	return out, nil
}

// parentRate finds the spec a split file came from (restock_x.spec.ts ← restock.spec.ts) and its seconds per test —
// from a record of the parent BEFORE the split (more tests than it holds now: the whole file's rate), else any record.
func parentRate(spec string, counts map[string]int, sources ...map[string]recordedTime) (string, float64, bool) {
	base := strings.TrimSuffix(spec, ".spec.ts")

	for i := strings.LastIndex(base, "_"); i > 0; i = strings.LastIndex(base[:i], "_") {
		parent := base[:i] + ".spec.ts"

		var fallback *recordedTime

		for _, src := range sources {
			r, ok := src[parent]
			if !ok || r.Tests == 0 {
				continue
			}

			if r.Tests > counts[parent] {
				return parent, r.Secs / float64(r.Tests), true
			}

			if fallback == nil {
				fallback = &r
			}
		}

		if fallback != nil {
			return parent, fallback.Secs / float64(fallback.Tests), true
		}
	}

	return "", 0, false
}

// ── coupled specs ─────────────────────────────────────────────────────────────────────────────────

// readCoupled reads frontend/e2e/coupled.txt: one group per line, the specs that must share ONE database
// (name-ordered, one worker, one batch); `#` starts a comment. A missing file is no groups.
func readCoupled(root string) ([][]string, error) {
	f, err := os.Open(filepath.Join(root, "frontend", "e2e", "coupled.txt"))
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}

	if err != nil {
		return nil, err
	}

	defer func() { _ = f.Close() }()

	return parseCoupled(f)
}

func parseCoupled(r io.Reader) ([][]string, error) {
	var groups [][]string

	seen := map[string]int{}
	sc := bufio.NewScanner(r)
	n := 0

	for sc.Scan() {
		n++

		line, _, _ := strings.Cut(sc.Text(), "#")

		specs := strings.Fields(line)
		if len(specs) == 0 {
			continue
		}

		if len(specs) == 1 {
			return nil, fmt.Errorf("coupled.txt line %d: a group needs two specs or more, got %q", n, specs[0])
		}

		for _, s := range specs {
			if !strings.HasSuffix(s, ".spec.ts") {
				return nil, fmt.Errorf("coupled.txt line %d: %q is not a spec file", n, s)
			}

			if prev, dup := seen[s]; dup {
				return nil, fmt.Errorf("coupled.txt line %d: %s is already in the group of line %d — merge the two lines", n, s, prev)
			}

			seen[s] = n
		}

		groups = append(groups, specs)
	}

	return groups, sc.Err()
}

// groupUnits makes the units to place: each coupled group whose specs are in the run as one unit (its specs that are
// not in the run are left out), every other spec on its own.
func groupUnits(specs []string, coupled [][]string, times map[string]specTime) []specUnit {
	in := map[string]bool{}
	for _, s := range specs {
		in[s] = true
	}

	placed := map[string]bool{}

	var units []specUnit

	for _, g := range coupled {
		var u specUnit

		for _, s := range g {
			if in[s] && !placed[s] {
				u.Specs = append(u.Specs, s)
				u.Secs += times[s].Secs
				placed[s] = true
			}
		}

		if len(u.Specs) > 0 {
			sort.Strings(u.Specs)
			units = append(units, u)
		}
	}

	for _, s := range specs {
		if !placed[s] {
			units = append(units, specUnit{Specs: []string{s}, Secs: times[s].Secs})
			placed[s] = true
		}
	}

	return units
}

// assignWorkers shares the units out longest first, each to the worker with the least work so far (ties: the
// lower worker) — the classic LPT schedule, within 4/3 of the best possible. Each worker's units come back in name
// order, as they will run.
func assignWorkers(units []specUnit, n int) [][]specUnit {
	if n < 1 {
		n = 1
	}

	order := append([]specUnit(nil), units...)
	sort.SliceStable(order, func(i, j int) bool {
		if order[i].Secs != order[j].Secs {
			return order[i].Secs > order[j].Secs
		}

		return order[i].name() < order[j].name()
	})

	out := make([][]specUnit, n)
	load := make([]float64, n)

	for _, u := range order {
		best := 0

		for w := 1; w < n; w++ {
			if load[w] < load[best] {
				best = w
			}
		}

		out[best] = append(out[best], u)
		load[best] += u.Secs + batchOverhead.Seconds()/batchSize
	}

	for _, us := range out {
		sort.Slice(us, func(i, j int) bool { return us[i].Specs[0] < us[j].Specs[0] })
	}

	return out
}

// workerBatches cuts one worker's units, name-ordered, into batches of up to size specs — a unit is never cut, and
// orders.spec.ts still runs alone. Each batch is one Playwright run on one fresh clone of the template.
func workerBatches(units []specUnit, size int) ([][]string, []float64) {
	var batches [][]string

	var secs []float64

	var cur []string

	var curSecs float64

	flush := func() {
		if len(cur) > 0 {
			batches = append(batches, cur)
			secs = append(secs, curSecs)
		}

		cur, curSecs = nil, 0
	}

	for _, u := range units {
		alone := len(u.Specs) == 1 && aloneSpecs[u.Specs[0]]

		if alone || len(cur)+len(u.Specs) > size {
			flush()
		}

		cur = append(cur, u.Specs...)
		curSecs += u.Secs

		if alone {
			flush()
		}
	}

	flush()

	return batches, secs
}

// ── the plan ──────────────────────────────────────────────────────────────────────────────────────

// workerPlan is how a parallel e2e will run.
type workerPlan struct {
	Workers []*e2eWorker
	Times   map[string]specTime
	Coupled [][]string
	Skipped []string // ports passed over because another program holds them
}

// wall is the e2e part's estimated wall time: the template once, then the slowest worker.
func (p *workerPlan) wall() time.Duration {
	var longest time.Duration

	for _, w := range p.Workers {
		e := w.estimate(len(p.Workers))
		if e > longest {
			longest = e
		}
	}

	return templateCost + longest
}

// singleWall is the same specs' estimated wall time as today's single-database batches (--workers 1).
func (p *workerPlan) singleWall(specs []string) time.Duration {
	var secs float64

	for _, s := range specs {
		secs += p.Times[s].Secs
	}

	// Each of today's batches pays its own start: servers, and the migrations a worker's clone replaces.
	batches := planBatches(specs, batchSize)

	return time.Duration(secs*float64(time.Second)) + time.Duration(len(batches))*singleBatchOverhead
}

// portBusy says whether a program that is not this checkout's e2e holds a port (nil: anything listening).
type portBusy func(port int) bool

// planWorkers shares specs out over n workers and picks each worker's database, ports and events project.
func planWorkers(root string, specs []string, n int, timesFile string, busy portBusy) (*workerPlan, error) {
	if n < 1 || n > maxWorkers {
		return nil, fmt.Errorf("--workers %d: want 1 to %d", n, maxWorkers)
	}

	times, err := estimateSpecTimes(root, specs, timesFile, testCounts(context.Background(), filepath.Join(root, "frontend"), specs))
	if err != nil {
		return nil, err
	}

	coupled, err := readCoupled(root)
	if err != nil {
		return nil, err
	}

	p := &workerPlan{Times: times, Coupled: coupled}

	apis, uis, skipped, err := pickWorkerPorts(n, busy)
	if err != nil {
		return nil, err
	}

	p.Skipped = skipped

	for i, units := range assignWorkers(groupUnits(specs, coupled, times), n) {
		w := &e2eWorker{
			Name:    fmt.Sprintf("w%d", i+1),
			DB:      fmt.Sprintf("%s_w%d", testDBName, i+1),
			APIPort: apis[i],
			UIPort:  uis[i],
			Project: fmt.Sprintf("warehouse-e2e-w%d", i+1),
			Units:   units,
		}
		w.Batches, w.BatchSecs = workerBatches(units, batchSize)
		p.Workers = append(p.Workers, w)
	}

	return p, nil
}

// pickWorkerPorts gives worker i the API port 8181+k and the UI port 5181+k for the next k at which neither is held
// by another program. Ports this checkout's own e2e left behind count as free (the run stops those first).
func pickWorkerPorts(n int, busy portBusy) (apis, uis []int, skipped []string, err error) {
	for k := 0; len(apis) < n; k++ {
		if k >= workerPortSpan {
			return nil, nil, skipped, fmt.Errorf("no free port pair for %d workers in %d–%d / %d–%d", n,
				workerAPIPortMin, workerAPIPortMin+workerPortSpan-1, workerUIPortMin, workerUIPortMin+workerPortSpan-1)
		}

		api, ui := workerAPIPortMin+k, workerUIPortMin+k

		if busy != nil && (busy(api) || busy(ui)) {
			skipped = append(skipped, fmt.Sprintf(":%d/:%d", api, ui))

			continue
		}

		apis = append(apis, api)
		uis = append(uis, ui)
	}

	return apis, uis, skipped, nil
}

// foreignPortBusy is the live portBusy: a listener that is not one of this checkout's e2e servers.
func foreignPortBusy(frontends []string) portBusy {
	return func(port int) bool {
		for _, pid := range listeners(port) {
			if !ownServer(cmdlineOf(pid), frontends) {
				return true
			}
		}

		return false
	}
}

func (p *workerPlan) print(out io.Writer, specs []string) {
	fmt.Fprintf(out, "               %d workers at once, each its OWN database (a clone of %s), API and UI ports and "+
		"events project;\n               inside a worker: name order, batches of up to %d specs, each on a fresh clone\n",
		len(p.Workers), templateDB, batchSize)
	fmt.Fprintf(out, "       tpl  %s — migrated + seeded once (db reset-test, migrate up-all, region load-seed, seed root), "+
		"about %s\n", templateDB, templateCost)

	if len(p.Skipped) > 0 {
		fmt.Fprintf(out, "       ports passed over (held by another program, never killed): %s\n", strings.Join(p.Skipped, " "))
	}

	for _, w := range p.Workers {
		fmt.Fprintf(out, "       %s  db %s · API :%d · UI :%d · events %s · %d specs in %d batches · about %s\n", w.Name, w.DB,
			w.APIPort, w.UIPort, w.Project, countSpecs(w.Batches), len(w.Batches), roundMin(w.estimate(len(p.Workers))))

		for i, b := range w.Batches {
			var parts []string
			for _, s := range b {
				parts = append(parts, fmt.Sprintf("%s (%.0fs)", s, p.Times[s].Secs))
			}

			fmt.Fprintf(out, "           b%d  %s\n", i+1, strings.Join(parts, " "))
		}
	}

	if len(p.Coupled) > 0 {
		fmt.Fprintf(out, "       coupled (one database, one batch — frontend/e2e/coupled.txt):")

		for _, g := range p.Coupled {
			fmt.Fprintf(out, " [%s]", strings.Join(g, " "))
		}

		fmt.Fprintln(out)
	} else {
		fmt.Fprintln(out, "       coupled      none listed (frontend/e2e/coupled.txt) — every spec is placed on its own")
	}

	fmt.Fprintf(out, "       e2e wall     about %s with %d workers (the template, then the slowest worker; ×%.1f for the "+
		"shared CPU) — vs about %s as --workers 1 batches (~35 min measured before the split)\n",
		roundMin(p.wall()), len(p.Workers), parallelSlowdown, roundMin(p.singleWall(specs)))

	srcs := map[string]int{}

	for _, s := range specs {
		src := p.Times[s].Source
		if strings.HasPrefix(src, "run ") {
			src = "a recorded full run"
		} else if strings.Contains(src, "'s rate") {
			src = "the rate of the spec it was split from"
		} else if strings.Contains(src, " tests × ") {
			src = "its test count"
		}

		srcs[src]++
	}

	var parts []string
	for k, v := range srcs {
		parts = append(parts, fmt.Sprintf("%d from %s", v, k))
	}

	sort.Strings(parts)
	fmt.Fprintf(out, "       times        %s\n", strings.Join(parts, ", "))
}

func countSpecs(batches [][]string) int {
	n := 0
	for _, b := range batches {
		n += len(b)
	}

	return n
}

func roundMin(d time.Duration) string {
	m := d.Minutes()
	if m < 10 {
		return fmt.Sprintf("%.1f min", m)
	}

	return fmt.Sprintf("%.0f min", m)
}

// ── the template ──────────────────────────────────────────────────────────────────────────────────

var rootPasswordRe = regexp.MustCompile(`export const ROOT_PASSWORD = "([^"]+)"`)

// e2eRootPassword reads the e2e root password from frontend/e2e/global-setup.ts — the one place it is written.
func e2eRootPassword(frontend string) (string, error) {
	b, err := os.ReadFile(filepath.Join(frontend, "e2e", "global-setup.ts"))
	if err != nil {
		return "", err
	}

	m := rootPasswordRe.FindSubmatch(b)
	if m == nil {
		return "", errors.New("frontend/e2e/global-setup.ts: no `export const ROOT_PASSWORD = \"…\"` to seed the template's root with")
	}

	return string(m[1]), nil
}

var dbnameRe = regexp.MustCompile(`dbname=\S+`)

// dsnWithDB is a key=value DSN pointed at another database.
func dsnWithDB(dsn, name string) string {
	if dbnameRe.MatchString(dsn) {
		return dbnameRe.ReplaceAllString(dsn, "dbname="+name)
	}

	return dsn + " dbname=" + name
}

// templateSteps are the commands that make the template — e2e/global-setup.ts's own steps (reset, every service's
// migrations in the contract order, the tiny region fixture, root's password), run once from the copy's backend/
// against warehouse_test_tpl. A worker's setup then only clones it.
func templateSteps(adminDSN, password string) [][]string {
	dsn := dsnWithDB(adminDSN, templateDB)
	san := []string{"go", "run", "../tools/san"}

	return [][]string{
		append(append([]string{}, san...), "db", "reset-test", "--name", templateDB, "--admin-dsn", adminDSN),
		append(append([]string{}, san...), "migrate", "up-all", "--dsn", dsn),
		append(append([]string{}, san...), "region", "load-seed", "--file", "../frontend/e2e/fixtures/regions.csv", "--dsn", dsn),
		append(append([]string{}, san...), "seed", "root", "--password", password, "--dsn", dsn),
	}
}

// prepareTemplate runs templateSteps in the copy, logging to template.log.
func prepareTemplate(ctx context.Context, copyRoot, dir string, out io.Writer) error {
	password, err := e2eRootPassword(filepath.Join(copyRoot, "frontend"))
	if err != nil {
		return err
	}

	start := time.Now()
	logPath := filepath.Join(dir, "template.log")

	for i, argv := range templateSteps(localDSN(), password) {
		res, err := runCapped(ctx, filepath.Join(copyRoot, "backend"), argv, nil,
			filepath.Join(dir, fmt.Sprintf("template-%d.log", i+1)), 10*time.Minute, nil)
		if err != nil {
			return err
		}

		if res.Exit != 0 || res.CapHit {
			return fmt.Errorf("the template step %q failed (exit %d) — %s", strings.Join(argv[3:5], " "), res.Exit,
				filepath.ToSlash(filepath.Join(reportFolder, "runs", filepath.Base(dir), fmt.Sprintf("template-%d.log", i+1))))
		}
	}

	_ = os.WriteFile(logPath, fmt.Appendf(nil, "template %s ready in %s\n", templateDB, time.Since(start).Round(time.Second)), 0o644)
	fmt.Fprintf(out, "  template %s ready in %s\n", templateDB, time.Since(start).Round(time.Second))

	return nil
}

// dropTemplate removes the template after the run.
func dropTemplate(ctx context.Context, copyRoot, dir string) {
	argv := []string{"go", "run", "../tools/san", "db", "drop-test", "--name", templateDB, "--admin-dsn", localDSN()}
	_, _ = runCapped(ctx, filepath.Join(copyRoot, "backend"), argv, nil, filepath.Join(dir, "template-drop.log"), 2*time.Minute, nil)
}

// ── the run ───────────────────────────────────────────────────────────────────────────────────────

// runWorkers runs every worker's batches at once in the copy's frontend and returns every batch, worker by worker.
// A worker stops at its first infrastructure failure (a port taken by another program, Docker gone); the others go on.
func runWorkers(ctx context.Context, frontend string, frontends []string, plan *workerPlan, dir string,
	out io.Writer) ([]*BatchResult, []string) {
	var mu sync.Mutex

	say := func(format string, a ...any) {
		mu.Lock()
		defer mu.Unlock()

		fmt.Fprintf(out, format, a...)
	}

	results := make([][]*BatchResult, len(plan.Workers))
	stops := make([]string, len(plan.Workers))

	var wg sync.WaitGroup

	for wi, w := range plan.Workers {
		wg.Add(1)

		go func() {
			defer wg.Done()

			start := time.Now()
			lock := ".e2e-lock." + w.Name
			ports := []int{w.APIPort, w.UIPort}

			for i, specs := range w.Batches {
				if ctx.Err() != nil {
					break
				}

				foreign := cleanupRun(frontend, lock, ports, frontends, true, io.Discard)

				err := preflightE2E(foreign)
				if err != nil {
					stops[wi] = w.Name + ": " + err.Error()

					break
				}

				b := &BatchResult{N: i + 1, Worker: w.Name, Specs: specs}
				b.Cap = time.Duration(math.Max(workerBatchCapMin.Seconds(), 3*w.BatchSecs[i])) * time.Second

				say("→ %s b%d %s\n", w.Name, b.N, strings.Join(specs, " "))

				err = runPlaywrightBatch(ctx, frontend, b, "", dir, nil, w.env()...)
				if err != nil {
					stops[wi] = w.Name + ": " + err.Error()

					break
				}

				results[wi] = append(results[wi], b)

				verdict := "✓"
				if b.Exit != 0 || b.CapHit || b.Counts.Failed > 0 {
					verdict = "✗"

					_ = copyDirFiles(filepath.Join(frontend, "test-results", w.Name),
						filepath.Join(dir, "failures", fmt.Sprintf("%s-b%d", w.Name, b.N)))
				}

				capNote := ""
				if b.CapHit {
					capNote = " CAP HIT — a timeout, not a failure: re-run that batch's specs alone"
				}

				say("  %s %s b%d exit=%d %ds %s%s\n", verdict, w.Name, b.N, b.Exit, b.Secs, b.Counts, capNote)

				for _, f := range b.Failures {
					say("      ✗ %s\n", f)
				}
			}

			cleanupRun(frontend, lock, ports, frontends, true, io.Discard)

			w.Secs = int(time.Since(start).Seconds())
			say("  %s done in %s\n", w.Name, time.Since(start).Round(time.Second))
		}()
	}

	wg.Wait()

	var all []*BatchResult
	for _, r := range results {
		all = append(all, r...)
	}

	var stopped []string

	for _, s := range stops {
		if s != "" {
			stopped = append(stopped, s)
		}
	}

	return all, stopped
}
