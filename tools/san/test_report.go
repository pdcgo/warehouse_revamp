package main

import (
	"encoding/json"
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

// e2e_report/ — the record the measurement reads and every run writes, at the repo root and
// gitignored (the-full-e2e-waits-for-a-measured-yes):
//
//	last_green.json        the fingerprint the last all-green full run tested (moves only when green)
//	last_green_proto/      that run's .proto files, so measure can tell a field made required
//	latest.md              the last result, and whether today's files are covered
//	runs/<stamp>/          one full run: run.json, summary.md, fingerprint.json, the logs, failures/
//	level2/<stamp>-<kind>/ one smoke or affected run
//	slice_log.md           the files each slice changed (san test slice), so a failure traces to a slice
//	slice_mark.json        the fingerprint at the last slice mark
//	state.json             when the full run first became due (the overdue rule)
//	.full_run.lock         a live full run (pid)

const reportFolder = "e2e_report"

func reportDir(root string) string {
	return filepath.Join(root, reportFolder)
}

// stamp names a run folder; it sorts by time.
func stamp(t time.Time) string {
	return t.Format("20060102-150405")
}

// RunRecord is one run, as run.json keeps it.
type RunRecord struct {
	ID                 string       `json:"id"`
	Kind               string       `json:"kind"` // full, smoke, affected
	Started            time.Time    `json:"started"`
	Finished           time.Time    `json:"finished"`
	Secs               int          `json:"secs"`
	Partial            bool         `json:"partial,omitempty"`
	PartialWhy         string       `json:"partial_why,omitempty"`
	Fingerprint        string       `json:"fingerprint"`
	Green              bool         `json:"green"`
	MovedGreen         bool         `json:"moved_last_green,omitempty"`
	Go                 *PartResult  `json:"go,omitempty"`
	Stories            *PartResult  `json:"stories,omitempty"`
	E2E                *E2EResult   `json:"e2e,omitempty"`
	AreasSincePrevious []string     `json:"areas_since_previous,omitempty"`
	FilesSincePrevious int          `json:"files_since_previous,omitempty"`
	SlicesSincePrev    []string     `json:"slices_since_previous,omitempty"`
	CopyDir            string       `json:"copy_dir,omitempty"`
	Workers            []*e2eWorker `json:"workers,omitempty"` // a parallel e2e's workers: database, ports, project
	Stopped            string       `json:"stopped,omitempty"` // why the run stopped early
	// Reruns are the files re-run once inside this run because they failed to LOAD
	// (a-file-that-fails-to-load-is-re-run-once): which, why, and how each went.
	Reruns []*Rerun `json:"reruns,omitempty"`
	// Acceptances are `san test accept-run` attempts on this run after it ended; a green one made it the baseline.
	Acceptances []*Acceptance `json:"acceptances,omitempty"`
}

// accepted is the green acceptance that made this run the baseline, if any.
func (r *RunRecord) accepted() *Acceptance {
	for _, a := range r.Acceptances {
		if a.Green {
			return a
		}
	}

	return nil
}

// PartResult is the go test or the Storybook run.
type PartResult struct {
	Exit     int      `json:"exit"`
	Secs     int      `json:"secs"`
	CapHit   bool     `json:"cap_hit,omitempty"`
	Passed   int      `json:"passed"`
	Failed   int      `json:"failed"`
	Failures []string `json:"failures,omitempty"`
	Log      string   `json:"log"`
	// Where it ran: the go test's own database, the Storybook run's vitest browser port.
	Where string `json:"where,omitempty"`
	// Classes sorts a failed Storybook run's failures per file into load and check failures.
	Classes *FailureClass `json:"failure_classes,omitempty"`
}

func (p *PartResult) green() bool {
	return p != nil && p.Exit == 0 && p.Failed == 0 && !p.CapHit
}

// E2EResult is every batch of a Playwright run, and the per-spec totals.
type E2EResult struct {
	Batches []*BatchResult         `json:"batches"`
	Specs   map[string]*SpecResult `json:"specs"`
}

// BatchResult is one Playwright invocation.
type BatchResult struct {
	N        int           `json:"n"`
	Worker   string        `json:"worker,omitempty"` // the parallel worker that ran it (w1), "" for the single run
	Cap      time.Duration `json:"cap,omitempty"`    // its own time cap, when not capFor's
	Specs    []string      `json:"specs"`
	Exit     int           `json:"exit"`
	Secs     int           `json:"secs"`
	CapHit   bool          `json:"cap_hit,omitempty"`
	Counts   Counts        `json:"counts"`
	Failures []string      `json:"failures,omitempty"`
	Log      string        `json:"log"`
	// RerunOf names the batch whose load failure this fresh batch re-runs (w1-b2); empty for a planned batch.
	RerunOf string `json:"rerun_of,omitempty"`
	// LoadFailed are the specs that failed to LOAD, stopping the batch before any test; set when it was re-run.
	LoadFailed []FileFailure `json:"load_failed,omitempty"`

	specs map[string]*SpecResult // this batch's per-spec totals, merged into E2EResult.Specs
}

// name is how the batch is called in the logs and the summary: b2, w1-b2, a re-run's w1-rerun1.
func (b *BatchResult) name() string {
	n := fmt.Sprintf("b%d", b.N)
	if b.RerunOf != "" {
		n = fmt.Sprintf("rerun%d", b.N)
	}

	if b.Worker != "" {
		n = b.Worker + "-" + n
	}

	return n
}

// passed says whether every test of the batch ran and passed.
func (b *BatchResult) passed() bool {
	return b.Exit == 0 && !b.CapHit && b.Counts.Failed == 0 && b.Counts.DidNotRun == 0
}

// Counts are a run's test outcomes.
type Counts struct {
	Passed    int `json:"passed"`
	Failed    int `json:"failed"`
	Skipped   int `json:"skipped"`
	Flaky     int `json:"flaky"`
	DidNotRun int `json:"did_not_run,omitempty"`
}

func (c *Counts) add(o Counts) {
	c.Passed += o.Passed
	c.Failed += o.Failed
	c.Skipped += o.Skipped
	c.Flaky += o.Flaky
	c.DidNotRun += o.DidNotRun
}

func (c Counts) String() string {
	s := fmt.Sprintf("%d passed", c.Passed)

	if c.Failed > 0 {
		s += fmt.Sprintf(", %d failed", c.Failed)
	}

	if c.Flaky > 0 {
		s += fmt.Sprintf(", %d flaky", c.Flaky)
	}

	if c.Skipped > 0 {
		s += fmt.Sprintf(", %d skipped", c.Skipped)
	}

	if c.DidNotRun > 0 {
		s += fmt.Sprintf(", %d did not run", c.DidNotRun)
	}

	return s
}

// SpecResult is one spec file's tests across the run.
type SpecResult struct {
	Counts
	Secs float64 `json:"secs"`
}

func (e *E2EResult) total() Counts {
	var c Counts

	for _, b := range e.Batches {
		c.add(b.Counts)
	}

	return c
}

// green says whether every batch passed — a batch that failed only to LOAD counting by its fresh re-run batches.
func (e *E2EResult) green() bool {
	if e == nil || len(e.Batches) == 0 {
		return false
	}

	for _, b := range e.Batches {
		if b.RerunOf == "" && len(b.LoadFailed) > 0 {
			if !e.rerunCovers(b) {
				return false
			}

			continue
		}

		if !b.passed() {
			return false
		}
	}

	return true
}

// rerunCovers says whether every spec of a load-failed batch ran again in a fresh batch (each judged on its own).
func (e *E2EResult) rerunCovers(b *BatchResult) bool {
	covered := map[string]bool{}

	for _, r := range e.Batches {
		if r.RerunOf == b.name() {
			for _, s := range r.Specs {
				covered[s] = true
			}
		}
	}

	for _, s := range b.Specs {
		if !covered[s] {
			return false
		}
	}

	return true
}

// lastRun is the newest recorded full run (runs/*/run.json); partial ones only when asked.
func lastRun(rep string, includePartial bool) (*RunRecord, error) {
	entries, err := os.ReadDir(filepath.Join(rep, "runs"))
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}

	if err != nil {
		return nil, err
	}

	sort.Slice(entries, func(i, j int) bool { return entries[i].Name() > entries[j].Name() })

	for _, e := range entries {
		rec, err := readRun(filepath.Join(rep, "runs", e.Name(), "run.json"))
		if err != nil {
			continue
		}

		if rec.Partial && !includePartial {
			continue
		}

		return rec, nil
	}

	return nil, nil
}

func readRun(path string) (*RunRecord, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	var rec RunRecord

	err = json.Unmarshal(b, &rec)
	if err != nil {
		return nil, err
	}

	return &rec, nil
}

// lastLevel2 is the newest smoke or affected run.
func lastLevel2(rep string) (*RunRecord, error) {
	entries, err := os.ReadDir(filepath.Join(rep, "level2"))
	if errors.Is(err, fs.ErrNotExist) {
		return nil, nil
	}

	if err != nil {
		return nil, err
	}

	sort.Slice(entries, func(i, j int) bool { return entries[i].Name() > entries[j].Name() })

	for _, e := range entries {
		rec, err := readRun(filepath.Join(rep, "level2", e.Name(), "run.json"))
		if err == nil {
			return rec, nil
		}
	}

	return nil, nil
}

// testState is what the overdue rule remembers between measurements.
type testState struct {
	DueSince time.Time `json:"due_since,omitzero"`
}

func readTestState(rep string) (testState, error) {
	var s testState

	b, err := os.ReadFile(filepath.Join(rep, "state.json"))
	if errors.Is(err, fs.ErrNotExist) {
		return s, nil
	}

	if err != nil {
		return s, err
	}

	err = json.Unmarshal(b, &s)

	return s, err
}

// recordMeasurement keeps when the full run became due, and rewrites latest.md.
func recordMeasurement(m *Measurement) error {
	rep := reportDir(m.Root)

	state := testState{}
	if m.Due {
		state.DueSince = m.DueSince
	}

	err := writeJSON(filepath.Join(rep, "state.json"), state)
	if err != nil {
		return err
	}

	return writeLatest(m)
}

// writeLatest is latest.md: the last full result, the last green, whether the files now are covered.
func writeLatest(m *Measurement) error {
	rep := reportDir(m.Root)

	var b strings.Builder

	fmt.Fprintf(&b, "# e2e_report — latest\n\n_Written %s by `san test`. Gitignored; nothing here is committed._\n\n",
		time.Now().Format("2006-01-02 15:04"))

	last, err := lastRun(rep, true)
	if err != nil {
		return err
	}

	b.WriteString("## The last full run\n\n")

	if last == nil {
		b.WriteString("None recorded yet.\n\n")
	} else {
		fmt.Fprintf(&b, "%s\n\n", runLine(last))
	}

	b.WriteString("## The last green full run\n\n")

	if m.Baseline == nil {
		b.WriteString("None — no `last_green.json`. A full run is due.\n\n")
	} else {
		fmt.Fprintf(&b, "%s (run %s), %d files.\n\n", m.Baseline.TakenAt.Format("2006-01-02 15:04"), m.Baseline.Run,
			len(m.Baseline.Files))

		rec, err := readRun(filepath.Join(rep, "runs", m.Baseline.Run, "run.json"))
		if err == nil {
			if a := rec.accepted(); a != nil {
				fmt.Fprintf(&b, "%s\n\n", acceptanceLine(a, rec))
			}

			if len(rec.Reruns) > 0 {
				fmt.Fprintf(&b, "Re-run inside the run after a load failure: %d files (a-file-that-fails-to-load-is-re-run-once) "+
					"— `runs/%s/summary.md`.\n\n", len(rec.Reruns), rec.ID)
			}
		}
	}

	b.WriteString("## Are today's files covered?\n\n")

	switch {
	case m.Baseline != nil && m.Diff.Empty():
		b.WriteString("**Covered** — every source file is the one the last green full run tested.\n\n")
	default:
		fmt.Fprintf(&b, "**Not covered** — %d files in %d areas differ from the last green full run.\n\n",
			m.Diff.Count(), m.countingAreas())

		for _, a := range m.Areas {
			fmt.Fprintf(&b, "- %s (%s): %s\n", a.Name, a.Risk, strings.Join(a.Files, ", "))
		}

		if len(m.Areas) > 0 {
			b.WriteString("\n")
		}
	}

	switch {
	case m.Overdue:
		fmt.Fprintf(&b, "**Full run OVERDUE** — %s\n\n> %s\n\n", strings.Join(m.Why, "; "), m.Ask())
	case m.Due:
		fmt.Fprintf(&b, "**Full run due** — %s\n\n> %s\n\n", strings.Join(m.Why, "; "), m.Ask())
	default:
		b.WriteString("Full run not due.\n\n")
	}

	l2, err := lastLevel2(rep)
	if err != nil {
		return err
	}

	b.WriteString("## The last smoke / affected run\n\n")

	if l2 == nil {
		b.WriteString("None recorded yet.\n")
	} else {
		fmt.Fprintf(&b, "%s\n", runLine(l2))
	}

	err = os.MkdirAll(rep, 0o755)
	if err != nil {
		return err
	}

	return os.WriteFile(filepath.Join(rep, "latest.md"), []byte(b.String()), 0o644)
}

// runLine is one run in one line.
func runLine(r *RunRecord) string {
	verdict := "GREEN"
	if !r.Green {
		verdict = "RED"
	}

	if r.Stopped != "" {
		verdict = "STOPPED (" + r.Stopped + ")"
	}

	if a := r.accepted(); a != nil {
		verdict = fmt.Sprintf("GREEN (accepted %s by san test accept-run — %d files re-run in %s)",
			a.At.Format("2006-01-02 15:04"), len(a.Reruns), a.Where)
	}

	partial := ""
	if r.Partial {
		partial = " · partial (" + r.PartialWhy + ") — never moves last_green"
	}

	var parts []string

	if r.Go != nil {
		parts = append(parts, fmt.Sprintf("go %s", partVerdict(r.Go)))
	}

	if r.Stories != nil {
		parts = append(parts, fmt.Sprintf("stories %s", partVerdict(r.Stories)))
	}

	if r.E2E != nil {
		parts = append(parts, fmt.Sprintf("e2e %s", r.E2E.total()))
	}

	if len(r.Reruns) > 0 {
		green := 0

		for _, x := range r.Reruns {
			if x.Green {
				green++
			}
		}

		parts = append(parts, fmt.Sprintf("re-run after a load failure %d/%d green", green, len(r.Reruns)))
	}

	dir := "runs"
	if r.Kind != "full" {
		dir = "level2"
	}

	return fmt.Sprintf("%s %s · %s · %s · %s · `%s/%s`%s", r.Kind, r.Started.Format("2006-01-02 15:04"), verdict,
		(time.Duration(r.Secs) * time.Second).String(), strings.Join(parts, " · "), dir, r.ID, partial)
}

func partVerdict(p *PartResult) string {
	switch {
	case p.CapHit:
		return fmt.Sprintf("CAP HIT after %ds", p.Secs)
	case p.green():
		return fmt.Sprintf("✓ %d passed", p.Passed)
	default:
		return fmt.Sprintf("✗ %d failed (exit %d)", p.Failed, p.Exit)
	}
}

// ── the slice log ─────────────────────────────────────────────────────────────────────────────────

// markSlice appends the files changed since the previous mark (or the last green) to slice_log.md, so a
// later failure is traced to the slice that changed its files — without git.
func markSlice(root, what string, out io.Writer) error {
	rep := reportDir(root)

	cur, err := takeFingerprint(root)
	if err != nil {
		return err
	}

	prev, err := readFingerprint(filepath.Join(rep, "slice_mark.json"))
	from := "the previous slice mark"

	if errors.Is(err, fs.ErrNotExist) {
		prev, err = readFingerprint(filepath.Join(rep, "last_green.json"))
		from = "the last green full run"
	}

	if err != nil && !errors.Is(err, fs.ErrNotExist) {
		return err
	}

	var b strings.Builder

	fmt.Fprintf(&b, "## %s · %s\n\n", time.Now().Format("2006-01-02 15:04"), what)

	if prev == nil {
		fmt.Fprintf(&b, "First mark: no earlier mark or green run to compare with (%d files fingerprinted, %s).\n\n",
			len(cur.Files), cur.Sum())
		fmt.Fprintf(out, "slice marked — first mark, %d files fingerprinted\n", len(cur.Files))
	} else {
		d := diffFingerprints(prev, cur)

		fmt.Fprintf(&b, "Since %s (%s → %s): %d changed, %d added, %d deleted.\n\n", from, prev.Sum(), cur.Sum(),
			len(d.Changed), len(d.Added), len(d.Deleted))

		for _, p := range d.Changed {
			fmt.Fprintf(&b, "- changed `%s`\n", p)
		}

		for _, p := range d.Added {
			fmt.Fprintf(&b, "- added `%s`\n", p)
		}

		for _, p := range d.Deleted {
			fmt.Fprintf(&b, "- deleted `%s`\n", p)
		}

		b.WriteString("\n")
		fmt.Fprintf(out, "slice marked — %d files since %s, appended to %s\n", d.Count(), from,
			filepath.ToSlash(filepath.Join(reportFolder, "slice_log.md")))
	}

	err = os.MkdirAll(rep, 0o755)
	if err != nil {
		return err
	}

	f, err := os.OpenFile(filepath.Join(rep, "slice_log.md"), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}

	_, err = f.WriteString(b.String())
	if err != nil {
		_ = f.Close()

		return err
	}

	err = f.Close()
	if err != nil {
		return err
	}

	return writeJSON(filepath.Join(rep, "slice_mark.json"), cur)
}

// slicesSince lists the slice log's headings written after t.
func slicesSince(rep string, t time.Time) []string {
	b, err := os.ReadFile(filepath.Join(rep, "slice_log.md"))
	if err != nil {
		return nil
	}

	var out []string

	for _, line := range strings.Split(string(b), "\n") {
		rest, ok := strings.CutPrefix(line, "## ")
		if !ok {
			continue
		}

		when, what, _ := strings.Cut(rest, " · ")

		at, err := time.ParseInLocation("2006-01-02 15:04", when, time.Local)
		if err != nil || !at.After(t.Add(-time.Minute)) {
			continue
		}

		out = append(out, when+" · "+what)
	}

	return out
}

// printReport is `san test report`: latest.md, then the recent runs.
func printReport(root string, out io.Writer, n int) error {
	rep := reportDir(root)

	b, err := os.ReadFile(filepath.Join(rep, "latest.md"))
	if errors.Is(err, fs.ErrNotExist) {
		fmt.Fprintln(out, "no e2e_report/latest.md yet — run: go run ./tools/san test measure")
	} else if err != nil {
		return err
	} else {
		_, err = out.Write(b)
		if err != nil {
			return err
		}
	}

	for _, kind := range []string{"runs", "level2"} {
		entries, err := os.ReadDir(filepath.Join(rep, kind))
		if errors.Is(err, fs.ErrNotExist) {
			continue
		}

		if err != nil {
			return err
		}

		sort.Slice(entries, func(i, j int) bool { return entries[i].Name() > entries[j].Name() })

		fmt.Fprintf(out, "\n## %s/ (newest first)\n\n", kind)

		for i, e := range entries {
			if i == n {
				break
			}

			rec, err := readRun(filepath.Join(rep, kind, e.Name(), "run.json"))
			if err != nil {
				fmt.Fprintf(out, "- %s (no run.json — a run that died before it ended)\n", e.Name())

				continue
			}

			fmt.Fprintf(out, "- %s\n", runLine(rec))
		}
	}

	return nil
}
