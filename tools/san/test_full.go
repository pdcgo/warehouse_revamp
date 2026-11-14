package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// The FULL RUN (level 3 of the-full-e2e-waits-for-a-measured-yes): the full go test, the full
// Storybook run and the full e2e — on a FROZEN COPY of the working folder, so the files tested are the
// files fingerprinted and work goes on in the real folder while it runs. last_green.json moves only
// when every part is green.
//
// The copy is everything a test reads, minus what is built: no .git, no build output, no e2e_report.
// frontend/node_modules is HARD-LINKED file by file (copied where the volume differs), so nothing is
// installed twice and an `npm install` in the real folder mid-run does not reach the copy — except
// Vite's and Vitest's caches (.vite, .vitest, .cache), which the copy starts empty, so a running dev
// server's cache is never rewritten under it.
//
// Not junctions: a junctioned package resolves to its real path in the live folder, which Vite's
// server.fs.allow refuses to serve to the Storybook test browser (the addon's setup file) — the copy
// must hold its packages inside itself. Hard links need one volume, so the copy goes beside the
// checkout by default (<parent>/.san_frozen/), not into the system temp folder.

const (
	goTestCap    = 30 * time.Minute
	storybookCap = 20 * time.Minute
	copyMarker   = ".san_frozen_copy"
)

// copySkipDirs are never copied, wherever they sit.
var copySkipDirs = map[string]bool{
	".git": true, "node_modules": true, ".venv": true, "graphify-out": true, "development_data": true,
	reportFolder: true, "test-results": true, "playwright-report": true, "storybook-static": true,
	"dist": true, ".san": true, ".vite": true, ".cache": true, "__screenshots__": true,
	".auth": true, // frontend/e2e/.auth — the live tree's saved sign-ins; a run's setup saves its own
}

// nodeModulesOwn are node_modules entries the copy keeps for itself instead of joining — and every .vite-* (a parallel
// e2e worker's own Vite cache, node_modules/.vite-e2e-w1): Vite rewrites a cache file in place, which through a hard
// link would rewrite the live folder's too.
var nodeModulesOwn = map[string]bool{".vite": true, ".vitest": true, ".cache": true}

func nodeModulesOwnEntry(name string) bool {
	return nodeModulesOwn[name] || strings.HasPrefix(name, ".vite-")
}

func copySkipFile(rel, name string) bool {
	return name == ".git" || name == ".e2e-lock" || strings.HasPrefix(name, ".e2e-lock.") || name == ".env" ||
		strings.HasPrefix(name, ".env.") ||
		strings.HasSuffix(name, ".exe") || strings.HasSuffix(name, ".tsbuildinfo") ||
		rel == "backend/bin" || strings.HasPrefix(rel, "backend/bin/")
}

// fullOptions are the flags of `san test full`.
type fullOptions struct {
	DryRun   bool
	KeepCopy bool
	CopyDir  string
	Specs    []string // only these e2e specs
	Stories  []string // only these story files
	GoPkgs   []string // only these go packages
	Skip     []string // go, stories, e2e
	Workers  int      // parallel e2e workers; 1 = today's name-ordered single-database batches
	Times    string   // an old e2e_batches.sh summary.txt to read per-spec times from
}

func (o fullOptions) skips(part string) bool {
	return contains(o.Skip, part)
}

// partial says whether the run tests less than everything — it is recorded, and never moves last_green.
func (o fullOptions) partial() (bool, string) {
	var why []string

	if len(o.Specs) > 0 {
		why = append(why, "--spec")
	}

	if len(o.Stories) > 0 {
		why = append(why, "--story")
	}

	if len(o.GoPkgs) > 0 {
		why = append(why, "--go")
	}

	for _, s := range o.Skip {
		why = append(why, "--skip "+s)
	}

	return len(why) > 0, strings.Join(why, ", ")
}

// fullPlan is what a full run will do.
type fullPlan struct {
	Root     string
	CopyDir  string
	GoArgv   []string
	Stories  []string    // vitest argv
	Batches  [][]string  // --workers 1: the single-database batches
	Workers  *workerPlan // --workers N > 1: the parallel plan
	Specs    []string
	Partial  bool
	Why      string
	Estimate time.Duration
}

func planFull(root string, opts fullOptions, now time.Time) (*fullPlan, error) {
	p := &fullPlan{Root: root}
	p.Partial, p.Why = opts.partial()

	p.CopyDir = opts.CopyDir
	if p.CopyDir == "" {
		p.CopyDir = filepath.Join(filepath.Dir(root), ".san_frozen", filepath.Base(root)+"-"+stamp(now))
	}

	if !opts.skips("go") {
		p.GoArgv = []string{"go", "test", "-count=1"}
		if len(opts.GoPkgs) > 0 {
			p.GoArgv = append(p.GoArgv, opts.GoPkgs...)
		} else {
			p.GoArgv = append(p.GoArgv, "./...")
		}
	}

	if !opts.skips("stories") {
		p.Stories = append([]string{"node", filepath.Join("node_modules", "vitest", "vitest.mjs"), "run",
			"--project=storybook"}, opts.Stories...)
	}

	if !opts.skips("e2e") {
		specs := opts.Specs
		if len(specs) == 0 {
			all, err := specFiles(filepath.Join(root, "frontend"))
			if err != nil {
				return nil, err
			}

			specs = all
		}

		p.Specs = specs

		if opts.Workers > 1 {
			frontends := []string{filepath.Join(root, "frontend"), filepath.Join(filepath.Dir(p.CopyDir))}

			wp, err := planWorkers(root, specs, opts.Workers, opts.Times, foreignPortBusy(frontends))
			if err != nil {
				return nil, err
			}

			p.Workers = wp
		} else {
			p.Batches = planBatches(specs, batchSize)
		}
	}

	p.Estimate = estimateDefault
	if p.Batches != nil {
		p.Estimate = estimateSingleDefault
	}

	last, err := lastRun(reportDir(root), false)
	if err == nil && last != nil && last.Secs > 0 {
		p.Estimate = time.Duration(last.Secs) * time.Second
	}

	if p.Workers != nil {
		// go test and Storybook as the last run took them (about ten minutes before any run), the copy, then the e2e.
		before := 10 * time.Minute
		if p.GoArgv == nil && p.Stories == nil {
			before = 0
		} else if last != nil && last.Go != nil && last.Stories != nil {
			before = time.Duration(last.Go.Secs+last.Stories.Secs) * time.Second
		}

		p.Estimate = before + time.Minute + p.Workers.wall()
	}

	return p, nil
}

func (p *fullPlan) print(out io.Writer, fp *Fingerprint, m *Measurement) {
	fmt.Fprintf(out, "full run — the plan\n\n")
	fmt.Fprintf(out, "  fingerprint  %d source files (%s)", len(fp.Files), fp.Sum())

	if m != nil {
		switch {
		case m.NoBaseline:
			fmt.Fprint(out, " — no green baseline yet")
		default:
			fmt.Fprintf(out, " — %d changed since the last green run", m.Diff.Count())
		}
	}

	fmt.Fprintln(out)
	fmt.Fprintf(out, "  copy         %s → %s\n", p.Root, p.CopyDir)
	fmt.Fprintf(out, "               without .git, build output, e2e_report; generated code kept;\n")
	fmt.Fprintf(out, "               frontend/node_modules hard-linked file by file (its .vite/.vitest/.cache the copy's own, empty)\n")
	fmt.Fprintf(out, "  locks        e2e_report/.full_run.lock, and the live frontend/.e2e-lock (a Playwright run here refuses meanwhile)\n")

	step := 1

	if p.GoArgv != nil {
		fmt.Fprintf(out, "  %d go         %s   (in the copy, cap %s)\n", step, strings.Join(p.GoArgv, " "), goTestCap)
		step++
	}

	if p.Stories != nil {
		fmt.Fprintf(out, "  %d stories    %s   (in the copy's frontend, cap %s)\n", step, strings.Join(p.Stories, " "), storybookCap)
		step++
	}

	if p.Workers != nil {
		fmt.Fprintf(out, "  %d e2e        %d specs on %d parallel workers\n", step, len(p.Specs), len(p.Workers.Workers))
		p.Workers.print(out, p.Specs)
		fmt.Fprintf(out, "               before each batch: stop that worker's own leftover servers on its two ports (never another "+
			"program's), check Docker and Postgres; afterwards the template is dropped\n")
	}

	if p.Batches != nil {
		fmt.Fprintf(out, "  %d e2e        %d batches, name-ordered, %d specs each; orders.spec.ts alone, the restock family "+
			"(restock*.spec.ts) together; cap %s (restock %s)\n", step, len(p.Batches), batchSize, batchCap, longSpecCap)

		for i, b := range p.Batches {
			fmt.Fprintf(out, "       b%-2d %s\n", i+1, strings.Join(b, " "))
		}

		fmt.Fprintf(out, "               before each batch: stop this checkout's leftover servers on :8081/:5175 (never another "+
			"program's), check Docker and Postgres\n")
	}

	fmt.Fprintf(out, "  record       e2e_report/runs/<stamp>/ (run.json, summary.md, fingerprint.json, logs, failures/), latest.md\n")

	if p.Partial {
		fmt.Fprintf(out, "  last green   NOT moved — a partial run (%s)\n", p.Why)
	} else {
		fmt.Fprintf(out, "  last green   e2e_report/last_green.json moves only when go, Storybook and every e2e batch are green\n")
	}

	fmt.Fprintf(out, "  estimate     about %d min\n", int(p.Estimate.Round(time.Minute)/time.Minute))
}

// ── the frozen copy ───────────────────────────────────────────────────────────────────────────────

// freezeCopy copies root into dst (which must not exist) and joins frontend/node_modules.
func freezeCopy(root, dst string) (files int, err error) {
	_, err = os.Stat(dst)
	if err == nil {
		return 0, fmt.Errorf("the copy folder %s already exists — pass another --copy-dir or remove it", dst)
	}

	err = os.MkdirAll(dst, 0o755)
	if err != nil {
		return 0, err
	}

	err = os.WriteFile(filepath.Join(dst, copyMarker), []byte(root+"\n"), 0o644)
	if err != nil {
		return 0, err
	}

	err = filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}

		rel := relSlash(root, p)
		if rel == "." {
			return nil
		}

		if d.IsDir() {
			if copySkipDirs[d.Name()] || rel == "backend/bin" {
				return filepath.SkipDir
			}

			return os.MkdirAll(filepath.Join(dst, filepath.FromSlash(rel)), 0o755)
		}

		if !d.Type().IsRegular() || copySkipFile(rel, d.Name()) {
			return nil
		}

		files++

		return copyFile(p, filepath.Join(dst, filepath.FromSlash(rel)))
	})
	if err != nil {
		return files, err
	}

	linked, err := linkNodeModules(filepath.Join(root, "frontend", "node_modules"), filepath.Join(dst, "frontend", "node_modules"))

	return files + linked, err
}

// linkNodeModules gives the copy its own frontend/node_modules: every file hard-linked to the live one
// (copied when the link fails — another volume), the caches left out.
func linkNodeModules(src, dst string) (int, error) {
	_, err := os.Stat(src)
	if errors.Is(err, fs.ErrNotExist) {
		return 0, errors.New("frontend/node_modules is missing — run go run ./tools/san dev setup (or npm install) first")
	}

	n := 0

	err = filepath.WalkDir(src, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}

		rel, err := filepath.Rel(src, p)
		if err != nil {
			return err
		}

		if rel != "." && nodeModulesOwnEntry(strings.Split(filepath.ToSlash(rel), "/")[0]) {
			if d.IsDir() {
				return filepath.SkipDir
			}

			return nil
		}

		target := filepath.Join(dst, rel)

		if d.IsDir() {
			return os.MkdirAll(target, 0o755)
		}

		// A link inside node_modules (an npm workspace) is not followed: it could lead anywhere.
		if !d.Type().IsRegular() {
			return nil
		}

		n++

		err = os.Link(p, target)
		if err != nil {
			return copyFile(p, target)
		}

		return nil
	})

	return n, err
}

// isLink says whether an entry is a junction or symlink — Go reports a junction as irregular.
func isLink(info fs.FileInfo) bool {
	return info.Mode()&(os.ModeSymlink|os.ModeIrregular) != 0
}

// removeCopy deletes a frozen copy — only a folder carrying the copy marker, and none holding a
// junction or symlink (a delete must never follow one into the live folder). Hard links are safe:
// removing one leaves the live file as it was.
func removeCopy(dir string) error {
	_, err := os.Stat(filepath.Join(dir, copyMarker))
	if err != nil {
		return fmt.Errorf("refusing to delete %s: it is not a frozen copy (no %s)", dir, copyMarker)
	}

	var links []string

	_ = filepath.WalkDir(dir, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}

		info, err := os.Lstat(p)
		if err == nil && p != dir && isLink(info) {
			links = append(links, p)
		}

		return nil
	})

	if len(links) > 0 {
		return fmt.Errorf("refusing to delete %s: %d junctions or symlinks in it (%s) — remove them by hand", dir,
			len(links), links[0])
	}

	err = os.RemoveAll(dir)
	if err != nil {
		return err
	}

	// The default .san_frozen folder beside the checkout goes too once it is empty — never another parent.
	if filepath.Base(filepath.Dir(dir)) == ".san_frozen" {
		_ = os.Remove(filepath.Dir(dir))
	}

	return nil
}

// ── the run ───────────────────────────────────────────────────────────────────────────────────────

// runFull runs the plan on a frozen copy and records it.
func runFull(ctx context.Context, root string, opts fullOptions, out io.Writer) (*RunRecord, error) {
	now := time.Now()

	plan, err := planFull(root, opts, now)
	if err != nil {
		return nil, err
	}

	err = refuseIfBusy(root)
	if err != nil {
		return nil, err
	}

	rep := reportDir(root)
	rec := &RunRecord{ID: stamp(now), Kind: "full", Started: now, Partial: plan.Partial, PartialWhy: plan.Why,
		CopyDir: plan.CopyDir}
	dir := filepath.Join(rep, "runs", rec.ID)

	err = os.MkdirAll(dir, 0o755)
	if err != nil {
		return nil, err
	}

	err = writeJSON(fullLockPath(root), fullRunLock{PID: os.Getpid(), Started: now, Copy: plan.CopyDir})
	if err != nil {
		return nil, err
	}

	defer func() { _ = os.Remove(fullLockPath(root)) }()

	liveFrontend := filepath.Join(root, "frontend")
	releaseLive := holdLiveE2ELock(liveFrontend, now)

	defer releaseLive()

	fp, err := takeFingerprint(root)
	if err != nil {
		return nil, err
	}

	rec.Fingerprint = fp.Sum()

	err = writeJSON(filepath.Join(dir, "fingerprint.json"), fp)
	if err != nil {
		return nil, err
	}

	prev, _ := lastRun(rep, true)
	if prev != nil {
		pfp, err := readFingerprint(filepath.Join(rep, "runs", prev.ID, "fingerprint.json"))
		if err == nil {
			d := diffFingerprints(pfp, fp)
			rec.FilesSincePrevious = d.Count()
			rec.AreasSincePrevious = areaNames(d)
		}

		rec.SlicesSincePrev = slicesSince(rep, prev.Started)
	}

	fmt.Fprintf(out, "→ copy %s → %s\n", root, plan.CopyDir)

	files, err := freezeCopy(root, plan.CopyDir)
	if err != nil {
		rec.Stopped = "the copy failed: " + err.Error()

		return finishFull(root, rec, dir, fp, plan, opts, out)
	}

	fmt.Fprintf(out, "  %d files copied in %s\n", files, time.Since(now).Round(time.Second))

	copyFrontend := filepath.Join(plan.CopyDir, "frontend")

	if plan.GoArgv != nil {
		rec.Go = runPart(ctx, plan.CopyDir, plan.GoArgv, filepath.Join(dir, "go.log"), goTestCap, "go", out)
	}

	if plan.Stories != nil && ctx.Err() == nil {
		rec.Stories = runPart(ctx, copyFrontend, plan.Stories, filepath.Join(dir, "stories.log"), storybookCap, "stories", out)
	}

	if plan.Workers != nil && ctx.Err() == nil {
		rec.E2E = &E2EResult{Specs: map[string]*SpecResult{}}
		rec.Workers = plan.Workers.Workers
		frontends := []string{copyFrontend, liveFrontend}

		fmt.Fprintf(out, "→ e2e on %d workers — the template %s first\n", len(plan.Workers.Workers), templateDB)

		err = prepareTemplate(ctx, plan.CopyDir, dir, out)
		if err != nil {
			rec.Stopped = err.Error()
		} else {
			batches, stopped := runWorkers(ctx, copyFrontend, frontends, plan.Workers, dir, out)

			for _, b := range batches {
				rec.E2E.Batches = append(rec.E2E.Batches, b)
				mergeSpecs(rec.E2E, b)
			}

			if len(stopped) > 0 {
				rec.Stopped = strings.Join(stopped, "; ")
			}
		}

		dropTemplate(context.WithoutCancel(ctx), plan.CopyDir, dir)
	}

	if plan.Batches != nil && ctx.Err() == nil {
		rec.E2E = &E2EResult{Specs: map[string]*SpecResult{}}
		frontends := []string{copyFrontend, liveFrontend}

		for i, specs := range plan.Batches {
			if ctx.Err() != nil {
				break
			}

			foreign := cleanupE2E(copyFrontend, frontends, true, out)

			err = preflightE2E(foreign)
			if err != nil {
				rec.Stopped = err.Error()

				break
			}

			b := &BatchResult{N: i + 1, Specs: specs}
			fmt.Fprintf(out, "→ e2e b%d %s\n", b.N, strings.Join(specs, " "))

			err = runPlaywrightBatch(ctx, copyFrontend, b, "", dir, nil)
			if err != nil {
				rec.Stopped = err.Error()

				break
			}

			rec.E2E.Batches = append(rec.E2E.Batches, b)
			mergeSpecs(rec.E2E, b)

			verdict := "✓"
			if b.Exit != 0 || b.CapHit || b.Counts.Failed > 0 {
				verdict = "✗"

				_ = copyDirFiles(filepath.Join(copyFrontend, "test-results"), filepath.Join(dir, "failures", fmt.Sprintf("b%d", b.N)))
			}

			capNote := ""
			if b.CapHit {
				capNote = " CAP HIT — a timeout, not a failure: re-run that spec alone"
			}

			fmt.Fprintf(out, "  %s b%d exit=%d %ds %s%s\n", verdict, b.N, b.Exit, b.Secs, b.Counts, capNote)

			for _, f := range b.Failures {
				fmt.Fprintf(out, "      ✗ %s\n", f)
			}
		}

		cleanupE2E(copyFrontend, frontends, true, io.Discard)
	}

	if ctx.Err() != nil && rec.Stopped == "" {
		rec.Stopped = "interrupted"
	}

	// The .proto files tested, kept for the next measurement — taken before the copy goes.
	_ = copyDirFiles(filepath.Join(plan.CopyDir, "proto"), filepath.Join(dir, "proto"))

	if !opts.KeepCopy {
		err = removeCopy(plan.CopyDir)
		if err != nil {
			fmt.Fprintf(out, "⚠ the copy was not removed: %v\n", err)
		}
	}

	return finishFull(root, rec, dir, fp, plan, opts, out)
}

// runPart runs go test or the Storybook run and reads its result.
func runPart(ctx context.Context, dir string, argv []string, logPath string, limit time.Duration, kind string,
	out io.Writer) *PartResult {
	fmt.Fprintf(out, "→ %s (cap %s)\n", strings.Join(argv, " "), limit)

	res, err := runCapped(ctx, dir, argv, nil, logPath, limit, nil)
	p := &PartResult{Exit: res.Exit, Secs: res.Secs, CapHit: res.CapHit, Log: logPath}

	if err != nil {
		p.Exit = -1
		p.Failures = []string{err.Error()}
	}

	b, _ := os.ReadFile(logPath)

	if kind == "go" {
		p.Passed, p.Failed, p.Failures = goTestCounts(string(b))
	} else {
		p.Passed, p.Failed, p.Failures = vitestCounts(string(b))
	}

	if p.Exit != 0 && p.Failed == 0 {
		p.Failed = 1
	}

	fmt.Fprintf(out, "  %s %s\n", partVerdict(p), filepath.Base(logPath))

	return p
}

// finishFull writes the record, moves last_green when everything is green, rewrites latest.md.
func finishFull(root string, rec *RunRecord, dir string, fp *Fingerprint, plan *fullPlan, opts fullOptions,
	out io.Writer) (*RunRecord, error) {
	rep := reportDir(root)

	rec.Finished = time.Now()
	rec.Secs = int(rec.Finished.Sub(rec.Started).Seconds())

	green := rec.Stopped == ""
	if plan.GoArgv != nil {
		green = green && rec.Go.green()
	}

	if plan.Stories != nil {
		green = green && rec.Stories.green()
	}

	if plan.Batches != nil || plan.Workers != nil {
		green = green && rec.E2E.green()
	}

	rec.Green = green

	if green && !rec.Partial {
		lg := *fp
		lg.Run = rec.ID

		err := writeJSON(filepath.Join(rep, "last_green.json"), &lg)
		if err != nil {
			return rec, err
		}

		_ = os.RemoveAll(filepath.Join(rep, "last_green_proto"))

		err = copyDirFiles(filepath.Join(dir, "proto"), filepath.Join(rep, "last_green_proto", "proto"))
		if err != nil {
			return rec, err
		}

		rec.MovedGreen = true
	}

	err := writeJSON(filepath.Join(dir, "run.json"), rec)
	if err != nil {
		return rec, err
	}

	err = os.WriteFile(filepath.Join(dir, "summary.md"), []byte(runSummary(rec)), 0o644)
	if err != nil {
		return rec, err
	}

	m, err := measure(root, measureOptions{})
	if err == nil {
		err = recordMeasurement(m)
	}

	fmt.Fprintf(out, "\n%s\n", runLine(rec))

	switch {
	case rec.MovedGreen:
		fmt.Fprintln(out, "last_green.json moved to this run's fingerprint")
	case rec.Partial:
		fmt.Fprintln(out, "a partial run — last_green.json not moved")
	default:
		fmt.Fprintln(out, "not green — last_green.json not moved; summary: "+filepath.ToSlash(filepath.Join(reportFolder, "runs", rec.ID, "summary.md")))
	}

	return rec, err
}

// holdLiveE2ELock writes the live tree's frontend/.e2e-lock with this process's pid, so a Playwright
// run started in the real folder while the copy's run holds the ports and the database refuses
// (e2e/lock.ts) instead of attaching to the copy's servers. The returned func removes it if still ours.
func holdLiveE2ELock(frontend string, now time.Time) func() {
	lock, err := readE2ELock(frontend)
	if err == nil && lock.PID > 0 && pidAlive(lock.PID) {
		return func() {}
	}

	path := filepath.Join(frontend, ".e2e-lock")

	err = os.WriteFile(path, fmt.Appendf(nil, `{"pid":%d,"startedAt":%q}`, os.Getpid(), now.UTC().Format(time.RFC3339)), 0o644)
	if err != nil {
		return func() {}
	}

	return func() {
		l, err := readE2ELock(frontend)
		if err == nil && l.PID == os.Getpid() {
			_ = os.Remove(path)
		}
	}
}

// areaNames is the areas a diff touches, by path.
func areaNames(d FileDiff) []string {
	seen := map[string]bool{}

	var out []string

	for _, p := range d.All() {
		a := classifyPath(p).Area
		if !seen[a] {
			seen[a] = true
			out = append(out, a)
		}
	}

	sort.Strings(out)

	return out
}
