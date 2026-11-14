package main

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

// The SMOKE SET and the level-2 runs (the-full-e2e-waits-for-a-measured-yes): about five key flows —
// sign in, place an order, accept a restock, a transfer, accept a return — kept under 5 minutes, run
// with the affected specs after every slice. The flows are a checked-in list of real test titles,
// frontend/e2e/smoke.txt, so a renamed test fails `san test smoke --dry-run` instead of silently
// leaving a flow out.

const smokeCap = 10 * time.Minute

type smokeEntry struct {
	Spec   string
	Titles []string // describe titles, then the test's own
}

type smokeFlow struct {
	Name    string
	Entries []smokeEntry
}

func (f smokeFlow) entryNames() []string {
	var out []string

	for _, e := range f.Entries {
		out = append(out, e.Spec+" › "+e.Titles[len(e.Titles)-1])
	}

	return out
}

// readSmoke reads frontend/e2e/smoke.txt: "## <flow>" headings, each followed by
// "<spec file> › [<describe> › …] <test title>" lines.
func readSmoke(root string) ([]smokeFlow, error) {
	f, err := os.Open(filepath.Join(root, "frontend", "e2e", "smoke.txt"))
	if err != nil {
		return nil, err
	}

	defer func() { _ = f.Close() }()

	return parseSmoke(f)
}

func parseSmoke(r io.Reader) ([]smokeFlow, error) {
	var flows []smokeFlow

	sc := bufio.NewScanner(r)
	n := 0

	for sc.Scan() {
		n++
		line := strings.TrimSpace(sc.Text())

		switch {
		case line == "" || strings.HasPrefix(line, "#") && !strings.HasPrefix(line, "## "):
			continue
		case strings.HasPrefix(line, "## "):
			flows = append(flows, smokeFlow{Name: strings.TrimSpace(strings.TrimPrefix(line, "## "))})
		default:
			parts := strings.Split(line, " › ")
			if len(parts) < 2 || !strings.HasSuffix(parts[0], ".spec.ts") {
				return nil, fmt.Errorf("smoke.txt line %d: want \"<file>.spec.ts › <test title>\", got %q", n, line)
			}

			if len(flows) == 0 {
				return nil, fmt.Errorf("smoke.txt line %d: a test before the first \"## <flow>\" heading", n)
			}

			for i := range parts {
				parts[i] = strings.TrimSpace(parts[i])
			}

			flows[len(flows)-1].Entries = append(flows[len(flows)-1].Entries, smokeEntry{Spec: parts[0], Titles: parts[1:]})
		}
	}

	return flows, sc.Err()
}

// grep is the entry as a Playwright --grep alternative. Playwright matches it against
// "<project> <file> <describe…> <title> <@tags>", joined by spaces.
func (e smokeEntry) grep() string {
	parts := []string{regexp.QuoteMeta(e.Spec)}
	for _, t := range e.Titles {
		parts = append(parts, regexp.QuoteMeta(t))
	}

	return strings.Join(parts, " ") + `(?: @\S+)*$`
}

// wholeSpecGrep matches every test of a spec file.
func wholeSpecGrep(spec string) string {
	return `(?:^|\s)` + regexp.QuoteMeta(spec) + ` `
}

// level2Batch is one Playwright invocation of a level-2 run.
type level2Batch struct {
	Specs []string
	Grep  string // empty: every test of the specs
}

// smokeBatches puts the smoke set (and any whole specs) into batches, each limited to its entries by
// --grep. orders.spec.ts always runs alone (it counts every order root can see); the restock family
// (restock.spec.ts and its split restock_*.spec.ts) together on its own only when its specs run whole — the
// smoke set's one restock test is short, and every extra batch costs a server start and a database reset.
func smokeBatches(flows []smokeFlow, whole map[string]bool) []level2Batch {
	greps := map[string][]string{}

	var specs []string

	for _, f := range flows {
		for _, e := range f.Entries {
			if _, ok := greps[e.Spec]; !ok {
				specs = append(specs, e.Spec)
			}

			greps[e.Spec] = append(greps[e.Spec], e.grep())
		}
	}

	for spec := range whole {
		if _, ok := greps[spec]; !ok {
			specs = append(specs, spec)
			greps[spec] = nil
		}
	}

	var out []level2Batch

	alone := map[string]bool{"orders.spec.ts": true}
	wholeRestock := func(s string) bool { return restockFamily(s) && whole[s] }

	for _, batch := range planBatchesWith(specs, batchSize, alone, wholeRestock) {
		b := level2Batch{Specs: batch}

		var alts []string

		allWhole := true

		for _, s := range batch {
			if whole[s] {
				alts = append(alts, wholeSpecGrep(s))

				continue
			}

			allWhole = false
			alts = append(alts, greps[s]...)
		}

		if !allWhole {
			b.Grep = "(?:" + strings.Join(alts, "|") + ")"
		}

		out = append(out, b)
	}

	return out
}

// listSmoke asks Playwright which tests the smoke set selects (--list starts no server) and checks
// every entry matches exactly one test.
func listSmoke(ctx context.Context, root string, flows []smokeFlow, out io.Writer) error {
	frontend := filepath.Join(root, "frontend")
	batches := smokeBatches(flows, nil)

	var listed []string

	for i, b := range batches {
		args := append(append([]string{}, b.Specs...), "--list")
		if b.Grep != "" {
			args = append(args, "--grep", b.Grep)
		}

		logPath := filepath.Join(os.TempDir(), fmt.Sprintf("san_smoke_list_%d_%d.log", os.Getpid(), i))

		res, err := runCapped(ctx, frontend, playwrightArgv(frontend, args...), nil, logPath, 2*time.Minute, nil)
		if err != nil {
			return err
		}

		b, _ := os.ReadFile(logPath)
		_ = os.Remove(logPath)

		if res.Exit != 0 {
			return fmt.Errorf("playwright --list failed (exit %d):\n%s", res.Exit, b)
		}

		for _, line := range strings.Split(string(b), "\n") {
			line = strings.TrimSpace(line)
			if strings.Contains(line, " › ") && strings.HasPrefix(line, "[") {
				listed = append(listed, line)
			}
		}
	}

	var missing []string

	for _, f := range flows {
		for _, e := range f.Entries {
			tail := " › " + strings.Join(e.Titles, " › ")
			n := 0

			for _, l := range listed {
				if strings.Contains(l, e.Spec+":") && strings.HasSuffix(l, tail) {
					n++
				}
			}

			if n != 1 {
				missing = append(missing, fmt.Sprintf("%s › %s (matches %d tests)", e.Spec, strings.Join(e.Titles, " › "), n))
			}
		}
	}

	fmt.Fprintf(out, "  playwright --list: %d tests selected\n", len(listed))

	if len(missing) > 0 {
		return fmt.Errorf("smoke.txt names tests Playwright does not list exactly once — renamed or moved?\n  %s",
			strings.Join(missing, "\n  "))
	}

	fmt.Fprintln(out, "  every entry matches exactly one test ✓")

	return nil
}

// printSmokePlan writes what a smoke run would do.
func printSmokePlan(out io.Writer, root string, flows []smokeFlow, batches []level2Batch) {
	frontend := filepath.Join(root, "frontend")

	for _, f := range flows {
		fmt.Fprintf(out, "  %s\n", f.Name)

		for _, e := range f.Entries {
			fmt.Fprintf(out, "      %s › %s\n", e.Spec, strings.Join(e.Titles, " › "))
		}
	}

	fmt.Fprintln(out)

	for i, b := range batches {
		args := append([]string{}, b.Specs...)
		if b.Grep != "" {
			args = append(args, "--grep", fmt.Sprintf("%q", b.Grep))
		}

		fmt.Fprintf(out, "  b%d  (cap %s) %s\n", i+1, capFor(b.Specs), strings.Join(playwrightArgv(frontend, args...), " "))
	}
}

// runLevel2 runs level-2 batches in THIS working tree and records them in e2e_report/level2/.
func runLevel2(ctx context.Context, root, kind string, batches []level2Batch, limit time.Duration,
	out io.Writer) (*RunRecord, error) {
	err := refuseIfBusy(root)
	if err != nil {
		return nil, err
	}

	frontend := filepath.Join(root, "frontend")
	frontends := []string{frontend}

	foreign := cleanupE2E(frontend, frontends, false, out)

	err = preflightE2E(foreign)
	if err != nil {
		return nil, err
	}

	fp, err := takeFingerprint(root)
	if err != nil {
		return nil, err
	}

	start := time.Now()
	rec := &RunRecord{ID: stamp(start) + "-" + kind, Kind: kind, Started: start, Fingerprint: fp.Sum(),
		E2E: &E2EResult{Specs: map[string]*SpecResult{}}}
	dir := filepath.Join(reportDir(root), "level2", rec.ID)

	err = os.MkdirAll(dir, 0o755)
	if err != nil {
		return nil, err
	}

	deadline := start.Add(limit)

	for i, lb := range batches {
		b := &BatchResult{N: i + 1, Specs: lb.Specs}
		fmt.Fprintf(out, "→ b%d %s\n", b.N, strings.Join(lb.Specs, " "))

		err = runPlaywrightBatch(ctx, frontend, b, lb.Grep, dir, out)

		rec.E2E.Batches = append(rec.E2E.Batches, b)
		mergeSpecs(rec.E2E, b)

		if err != nil {
			rec.Stopped = err.Error()

			break
		}

		cleanupE2E(frontend, frontends, false, io.Discard)

		if time.Now().After(deadline) && i+1 < len(batches) {
			rec.Stopped = fmt.Sprintf("over the %s budget after b%d", limit, b.N)

			break
		}
	}

	rec.Finished = time.Now()
	rec.Secs = int(rec.Finished.Sub(start).Seconds())
	rec.Green = rec.Stopped == "" && rec.E2E.green()

	err = writeJSON(filepath.Join(dir, "run.json"), rec)
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

	return rec, err
}

// mergeSpecs adds a batch's per-spec totals to the run's.
func mergeSpecs(e *E2EResult, b *BatchResult) {
	for name, s := range b.specs {
		cur := e.Specs[name]
		if cur == nil {
			cur = &SpecResult{}
			e.Specs[name] = cur
		}

		cur.Counts.add(s.Counts)
		cur.Secs += s.Secs
	}
}

// runSummary is a run's summary.md: the verdict, each batch, each spec's result and time, the failures.
func runSummary(r *RunRecord) string {
	var b strings.Builder

	fmt.Fprintf(&b, "# %s run %s\n\n%s\n\n", r.Kind, r.ID, runLine(r))
	fmt.Fprintf(&b, "Fingerprint tested: `%s`\n\n", r.Fingerprint)

	if len(r.AreasSincePrevious) > 0 {
		fmt.Fprintf(&b, "Areas changed since the previous run (%d files): %s\n\n", r.FilesSincePrevious,
			strings.Join(r.AreasSincePrevious, ", "))
	}

	if len(r.SlicesSincePrev) > 0 {
		b.WriteString("Slices logged since the previous run:\n\n")

		for _, s := range r.SlicesSincePrev {
			fmt.Fprintf(&b, "- %s\n", s)
		}

		b.WriteString("\n")
	}

	for _, part := range []struct {
		name string
		p    *PartResult
	}{{"go test", r.Go}, {"Storybook", r.Stories}} {
		if part.p == nil {
			continue
		}

		fmt.Fprintf(&b, "## %s — %s in %s\n\n", part.name, partVerdict(part.p), time.Duration(part.p.Secs)*time.Second)

		if part.p.Where != "" {
			fmt.Fprintf(&b, "Ran on %s.\n\n", part.p.Where)
		}

		for _, f := range part.p.Failures {
			fmt.Fprintf(&b, "- %s\n", f)
		}

		fmt.Fprintf(&b, "\nLog: `%s`\n\n", filepath.Base(part.p.Log))

		if c := part.p.Classes; c != nil {
			b.WriteString(failureClassMarkdown(c))
		}
	}

	if r.E2E != nil {
		fmt.Fprintf(&b, "## e2e — %s\n\n", r.E2E.total())

		if len(r.Workers) > 0 {
			b.WriteString("| worker | database | API | UI | events project | batches | time |\n| --- | --- | --- | --- | --- | --- | --- |\n")

			for _, w := range r.Workers {
				fmt.Fprintf(&b, "| %s | %s | :%d | :%d | %s | %d | %ds |\n", w.Name, w.DB, w.APIPort, w.UIPort, w.Project,
					len(w.Batches), w.Secs)
			}

			b.WriteString("\n")
		}

		b.WriteString("| batch | exit | time | result | specs |\n| --- | --- | --- | --- | --- |\n")

		for _, bt := range r.E2E.Batches {
			exit := fmt.Sprint(bt.Exit)
			if bt.CapHit {
				exit = "CAP HIT"
			}

			name := bt.name()
			if bt.RerunOf != "" {
				name += " (re-runs " + bt.RerunOf + ")"
			} else if len(bt.LoadFailed) > 0 {
				name += " (failed to load — re-run)"
			}

			fmt.Fprintf(&b, "| %s | %s | %ds | %s | %s |\n", name, exit, bt.Secs, bt.Counts, strings.Join(bt.Specs, " "))
		}

		names := make([]string, 0, len(r.E2E.Specs))
		for n := range r.E2E.Specs {
			names = append(names, n)
		}

		sort.Strings(names)

		b.WriteString("\n| spec | result | time |\n| --- | --- | --- |\n")

		for _, n := range names {
			s := r.E2E.Specs[n]
			fmt.Fprintf(&b, "| %s | %s | %.0fs |\n", n, s.Counts, s.Secs)
		}

		var failures []string
		for _, bt := range r.E2E.Batches {
			failures = append(failures, bt.Failures...)
		}

		if len(failures) > 0 {
			b.WriteString("\n### Failures\n\n")

			for _, f := range failures {
				fmt.Fprintf(&b, "- %s\n", f)
			}

			b.WriteString("\nTraces and screenshots: `failures/b<N>/` (a worker's: `failures/w<K>-b<N>/`) beside this file (full runs).\n")
		}
	}

	if len(r.Reruns) > 0 {
		b.WriteString("\n## Re-run once — a file that failed to load (a-file-that-fails-to-load-is-re-run-once)\n\n")
		b.WriteString(rerunTable(r.Reruns, false))
	}

	for _, a := range r.Acceptances {
		b.WriteString(acceptanceMarkdown(a, r))
	}

	return b.String()
}

// failureClassMarkdown lists a failed Storybook run's failures per file: load (re-run once) or check (never).
func failureClassMarkdown(c *FailureClass) string {
	var b strings.Builder

	fmt.Fprintf(&b, "Per file: %d failed to load, %d failed a check", len(c.Load), len(c.Check))

	if len(c.Unattributed) > 0 {
		fmt.Fprintf(&b, ", %d not attributable to a file", len(c.Unattributed))
	}

	b.WriteString(" (a-file-that-fails-to-load-is-re-run-once):\n\n")

	for _, f := range c.Load {
		fmt.Fprintf(&b, "- load · `%s` — %s\n", f.File, f.Why)
	}

	for _, f := range c.Check {
		fmt.Fprintf(&b, "- check · `%s` — %s\n", f.File, f.Why)
	}

	for _, u := range c.Unattributed {
		fmt.Fprintf(&b, "- unattributed — %s\n", u)
	}

	b.WriteString("\n")

	return b.String()
}

// rerunTable is the re-runs as a markdown table.
func rerunTable(reruns []*Rerun, withSame bool) string {
	var b strings.Builder

	if withSame {
		b.WriteString("| part | file | kind | why | same file as the run tested | result | log |\n| --- | --- | --- | --- | --- | --- | --- |\n")
	} else {
		b.WriteString("| part | file | kind | why | where | result | log |\n| --- | --- | --- | --- | --- | --- | --- |\n")
	}

	for _, x := range reruns {
		col := x.Where
		if x.Worker != "" {
			col += " (" + x.Worker + ", " + x.Batch + ")"
		}

		if withSame {
			col = "unknown"
			if x.SameAsRun != nil && *x.SameAsRun {
				col = "yes"
			} else if x.SameAsRun != nil {
				col = "**no** — the file changed since"
			}
		}

		fmt.Fprintf(&b, "| %s | `%s` | %s | %s | %s | %s | `%s` |\n", x.Part, x.File, x.Kind,
			strings.ReplaceAll(x.Why, "|", "\\|"), col, x.Result, filepath.Base(x.Log))
	}

	return b.String()
}

// errNoSmoke explains a missing list.
var errNoSmoke = errors.New("frontend/e2e/smoke.txt is missing — the smoke set is a checked-in list of test titles")
