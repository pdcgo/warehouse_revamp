package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/urfave/cli/v3"
)

// `san test accept-run <stamp>` — making an EXISTING full run the green baseline when its only failures were LOAD
// failures (a-file-that-fails-to-load-is-re-run-once): the run that came before the load retry was built, or one
// whose re-runs could not run. It
//
//	verifies   the run is a whole full run (not partial, not stopped), go test green, the e2e with 0 failed tests, and
//	           every Storybook / e2e failure in it a LOAD failure by the classifier (test_retry.go) — or a Storybook
//	           file named with --rerun and a --reason (the owner's word: only for a run the owner made the baseline)
//	re-runs    each of those files ONCE, by itself, NOW, in the live tree
//	moves      e2e_report/last_green.json to THAT run's fingerprint (runs/<stamp>/fingerprint.json — never today's
//	           tree) when every re-run is green, and its .proto files to last_green_proto/
//	records    the acceptance — files, why, each result, whether each file still reads as the run tested it — in the
//	           run's run.json and summary.md, and in latest.md
//
// It refuses, changing nothing, while any check failure remains.

// Acceptance is one `san test accept-run` that re-ran files of an ended run.
type Acceptance struct {
	At              time.Time `json:"at"`
	Command         string    `json:"command"`
	Where           string    `json:"where"`            // the live tree
	TreeFingerprint string    `json:"tree_fingerprint"` // the live tree's when the files were re-run
	Reason          string    `json:"reason,omitempty"` // why the files named with --rerun could be re-run
	Named           []string  `json:"named,omitempty"`  // the files named with --rerun
	Reruns          []*Rerun  `json:"reruns"`
	Green           bool      `json:"green"`
	MovedGreen      bool      `json:"moved_last_green"`
}

// acceptRequest is what accept-run was asked.
type acceptRequest struct {
	Stamp  string
	Named  []string // --rerun: Storybook files whose CHECK failure the owner lets re-run
	Reason string   // --reason
}

// plannedRerun is one file accept-run will re-run.
type plannedRerun struct {
	File string
	Kind string // load, named
	Why  string
}

// acceptPlan is what accept-run will do once the run passed every check.
type acceptPlan struct {
	Run     *RunRecord
	Dir     string
	Fp      *Fingerprint
	Classes *FailureClass  // the Storybook failures per file (nil when Storybook was green)
	Stories []plannedRerun // the story files to re-run
	E2E     []*BatchResult // the load-failed e2e batches (LoadFailed set) to re-run in fresh batches
	Notes   []string
}

func refused(format string, a ...any) error {
	return fmt.Errorf("refused: "+format, a...)
}

// runFile is a file a run recorded by its absolute path — or, when the checkout has moved, the same name in dir.
func runFile(dir, recorded string) string {
	if recorded != "" {
		_, err := os.Stat(recorded)
		if err == nil {
			return recorded
		}
	}

	return filepath.Join(dir, filepath.Base(filepath.FromSlash(strings.ReplaceAll(recorded, `\`, "/"))))
}

// planAccept checks a run against every rule accept-run has and says what it would re-run; it changes nothing.
func planAccept(rep string, req acceptRequest) (*acceptPlan, error) {
	if req.Stamp == "" {
		return nil, errors.New("name the run: san test accept-run <stamp> (a folder of e2e_report/runs/)")
	}

	dir := filepath.Join(rep, "runs", req.Stamp)

	rec, err := readRun(filepath.Join(dir, "run.json"))
	if err != nil {
		return nil, refused("no run %s in e2e_report/runs (%v)", req.Stamp, err)
	}

	p := &acceptPlan{Run: rec, Dir: dir}

	switch {
	case rec.Kind != "full":
		return nil, refused("%s is a %s run — only a full run can be the baseline", rec.ID, rec.Kind)
	case rec.Partial:
		return nil, refused("%s is a partial run (%s) — it never becomes the baseline", rec.ID, rec.PartialWhy)
	case rec.Stopped != "":
		return nil, refused("%s stopped early (%s) — run it again", rec.ID, rec.Stopped)
	case rec.accepted() != nil:
		return nil, refused("%s was already accepted on %s", rec.ID, rec.accepted().At.Format("2006-01-02 15:04"))
	case len(rec.Acceptances) > 0:
		return nil, refused("an earlier accept-run of %s (%s) had a red re-run — each file is re-run once, a second "+
			"failure is red: run the full suites again", rec.ID, rec.Acceptances[0].At.Format("2006-01-02 15:04"))
	case rec.Green:
		return nil, refused("%s is already green — it moved last_green.json when it ran", rec.ID)
	case rec.Go == nil:
		return nil, refused("%s has no go test part", rec.ID)
	case !rec.Go.green():
		return nil, refused("go test is not green in %s (%s) — a failed check is never re-run", rec.ID, partVerdict(rec.Go))
	case rec.E2E == nil || len(rec.E2E.Batches) == 0:
		return nil, refused("%s has no e2e part", rec.ID)
	case rec.Stories == nil:
		return nil, refused("%s has no Storybook part", rec.ID)
	}

	for _, x := range rec.Reruns {
		if !x.Green {
			return nil, refused("%s re-ran %s inside the run and it went %s — a second load failure is red", rec.ID, x.File,
				x.Result)
		}
	}

	fp, err := readFingerprint(filepath.Join(dir, "fingerprint.json"))
	if err != nil {
		return nil, refused("%s has no fingerprint.json — nothing to make the baseline (%v)", rec.ID, err)
	}

	p.Fp = fp

	err = p.planE2E()
	if err != nil {
		return nil, err
	}

	err = p.planStories(req)
	if err != nil {
		return nil, err
	}

	if len(p.Stories) == 0 && len(p.E2E) == 0 {
		return nil, refused("%s has nothing to re-run, yet it is not green — read its summary.md", rec.ID)
	}

	return p, nil
}

// planE2E: 0 failed tests, and every red batch one that failed only to load.
func (p *acceptPlan) planE2E() error {
	e := p.Run.E2E

	if t := e.total(); t.Failed > 0 {
		var failures []string
		for _, b := range e.Batches {
			failures = append(failures, b.Failures...)
		}

		return refused("the e2e has %d failed tests (%s) — a failed check is never re-run", t.Failed,
			strings.Join(failures, "; "))
	}

	for _, b := range e.Batches {
		if b.passed() {
			continue
		}

		switch {
		case b.RerunOf != "":
			return refused("the in-run re-run %s is red — a second load failure is red", b.name())
		case len(b.LoadFailed) > 0 && e.rerunCovers(b):
			continue // judged by its fresh batches, each checked here too
		case b.CapHit:
			return refused("the e2e batch %s hit its cap — a timeout, not a load failure", b.name())
		}

		rep, err := parsePlaywrightJSON(runFile(p.Dir, jsonPathOf(b)))
		if err != nil {
			return refused("the e2e batch %s exited %d and its JSON report cannot be read (%v) — red", b.name(), b.Exit, err)
		}

		load, ok := classifyPlaywrightLoad(b.Specs, rep)
		if !ok {
			return refused("the e2e batch %s exited %d with no failed test and no load error naming only its specs — red",
				b.name(), b.Exit)
		}

		c := *b
		c.LoadFailed = load
		p.E2E = append(p.E2E, &c)
	}

	return nil
}

// planStories: every Storybook failure a load failure, or a file the owner named with --rerun and a reason.
func (p *acceptPlan) planStories(req acceptRequest) error {
	rec := p.Run

	named := map[string]bool{}

	var namedOrder []string

	for _, n := range req.Named {
		f := normStoryPath(n)
		if f != "" && !named[f] {
			named[f] = true
			namedOrder = append(namedOrder, f)
		}
	}

	if len(named) > 0 && strings.TrimSpace(req.Reason) == "" {
		return refused("--rerun needs --reason — the owner's word for re-running a file whose CHECK failed")
	}

	if rec.storiesGreen() {
		if len(named) > 0 {
			return refused("%s: Storybook is green in %s — nothing to re-run", strings.Join(namedOrder, ", "), rec.ID)
		}

		return nil
	}

	if rec.Stories.CapHit {
		return refused("Storybook hit its cap in %s — the run did not finish", rec.ID)
	}

	b, err := os.ReadFile(runFile(p.Dir, rec.Stories.Log))
	if err != nil {
		return refused("the Storybook log of %s cannot be read (%v)", rec.ID, err)
	}

	c := classifyVitest(string(b), rec.Stories.Exit, rec.Stories.CapHit)
	p.Classes = c

	if len(c.Unattributed) > 0 {
		return refused("Storybook failures no file can be named for: %s — red", strings.Join(c.Unattributed, "; "))
	}

	for _, f := range namedOrder {
		ff, kind := c.find(f)
		if ff == nil {
			return refused("%s did not fail in %s — --rerun names only a file that failed", f, rec.ID)
		}

		if kind == "load" {
			p.Notes = append(p.Notes, f+" is a load failure — re-run as one; --rerun was not needed for it")
		}
	}

	var unnamed []string

	for _, f := range c.Check {
		if !named[f.File] {
			unnamed = append(unnamed, fmt.Sprintf("%s (%s)", f.File, f.Why))
		}
	}

	if len(unnamed) > 0 {
		return refused("Storybook CHECK failures remain (never re-run by the rule): %s — only on the owner's word that "+
			"this run is the baseline: --rerun <file> --reason \"<their words>\"", strings.Join(unnamed, "; "))
	}

	for _, f := range c.Load {
		p.Stories = append(p.Stories, plannedRerun{File: f.File, Kind: "load", Why: f.Why})
	}

	for _, f := range c.Check {
		p.Stories = append(p.Stories, plannedRerun{File: f.File, Kind: "named",
			Why: fmt.Sprintf("named with --rerun: %s (failed in the run: %s)", strings.TrimSpace(req.Reason), f.Why)})
	}

	return nil
}

func (p *acceptPlan) print(out io.Writer, frontend string) {
	rec := p.Run

	fmt.Fprintf(out, "accept-run %s — %s\n", rec.ID, runLine(rec))
	fmt.Fprintf(out, "  fingerprint  %s (%d files) — what last_green.json would become\n", rec.Fingerprint, len(p.Fp.Files))
	fmt.Fprintf(out, "  go           %s\n", partVerdict(rec.Go))
	fmt.Fprintf(out, "  e2e          %s", rec.E2E.total())

	if len(p.E2E) > 0 {
		fmt.Fprintf(out, " — %d batches failed only to load", len(p.E2E))
	}

	fmt.Fprintln(out)
	fmt.Fprintf(out, "  stories      %s", partVerdict(rec.Stories))

	if p.Classes != nil {
		fmt.Fprintf(out, " — per file: %d failed to load, %d failed a check", len(p.Classes.Load), len(p.Classes.Check))
	}

	fmt.Fprintln(out)

	for _, s := range p.Stories {
		fmt.Fprintf(out, "    %-5s  %s — %s\n", s.Kind, s.File, s.Why)
	}

	for _, b := range p.E2E {
		for _, f := range b.LoadFailed {
			fmt.Fprintf(out, "    load   %s (%s) — %s\n", f.File, b.name(), f.Why)
		}
	}

	for _, n := range p.Notes {
		fmt.Fprintf(out, "  note         %s\n", n)
	}

	files := len(p.Stories)
	for _, b := range p.E2E {
		files += len(b.Specs)
	}

	fmt.Fprintf(out, "  re-run       %d files, each ONCE by itself, now, in the live tree (%s)\n", files, frontend)
}

// acceptExec runs the re-runs; tests replace it.
type acceptExec struct {
	Story storyRunner
	E2E   func(logDir string) batchRunner
	Busy  func() error
}

// liveAcceptExec re-runs in the live tree: vitest on one story file, Playwright on :8081/:5175 like a level-2 run.
func liveAcceptExec(root string) acceptExec {
	frontend := filepath.Join(root, "frontend")

	return acceptExec{
		Story: vitestFileRunner(frontend),
		E2E: func(logDir string) batchRunner {
			return playwrightBatchRunner(frontend, []string{frontend}, logDir)
		},
		Busy: func() error { return readBusy(root).acceptRefusal() },
	}
}

// runAccept is `san test accept-run`: plan, re-run, and on all green move last_green.json to the run's fingerprint.
func runAccept(ctx context.Context, root string, req acceptRequest, dryRun bool, exec acceptExec, command string,
	out io.Writer) (*Acceptance, error) {
	rep := reportDir(root)
	frontend := filepath.Join(root, "frontend")

	p, err := planAccept(rep, req)
	if err != nil {
		return nil, err
	}

	p.print(out, frontend)

	if dryRun {
		fmt.Fprintln(out, "\n(dry run: nothing re-run, last_green.json not moved)")

		return nil, nil
	}

	if exec.Busy != nil {
		err = exec.Busy()
		if err != nil {
			return nil, err
		}
	}

	now := time.Now()
	logDir := filepath.Join(p.Dir, "accept-"+stamp(now))

	err = os.MkdirAll(logDir, 0o755)
	if err != nil {
		return nil, err
	}

	cur, err := takeFingerprint(root)
	if err != nil {
		return nil, err
	}

	a := &Acceptance{At: now, Command: command, Where: "the live tree", TreeFingerprint: cur.Sum(),
		Reason: strings.TrimSpace(req.Reason)}

	for _, n := range req.Named {
		a.Named = append(a.Named, normStoryPath(n))
	}

	fmt.Fprintf(out, "\n→ re-running in the live tree (fingerprint now %s; the run tested %s)\n", cur.Sum(), p.Run.Fingerprint)

	for i, s := range p.Stories {
		if ctx.Err() != nil {
			break
		}

		r := exec.Story(ctx, s.File, filepath.Join(logDir, fmt.Sprintf("stories-%d.log", i+1)))
		r.Part, r.File, r.Kind, r.Why, r.Where = "stories", s.File, s.Kind, s.Why, a.Where
		r.SameAsRun = sameFile(p.Fp, cur, "frontend/"+s.File)
		a.Reruns = append(a.Reruns, r)

		fmt.Fprintf(out, "  %s %s\n", r.Result, s.File)
	}

	n := 0

	for _, b := range p.E2E {
		if ctx.Err() != nil {
			break
		}

		_, rs := runE2ERerunGroups(ctx, b, singleSeat(), a.Where, &n, exec.E2E(logDir), out)

		for _, r := range rs {
			r.SameAsRun = sameFile(p.Fp, cur, "frontend/e2e/"+r.File)
		}

		a.Reruns = append(a.Reruns, rs...)
	}

	a.Green = ctx.Err() == nil && len(a.Reruns) > 0

	for _, r := range a.Reruns {
		a.Green = a.Green && r.Green
	}

	rec := p.Run

	if a.Green {
		err = moveLastGreen(rep, p.Dir, p.Fp, rec.ID)
		if err != nil {
			return a, err
		}

		a.MovedGreen = true
		rec.Green = true
		rec.MovedGreen = true

		if p.Classes != nil {
			rec.Stories.Classes = p.Classes
		}
	}

	rec.Acceptances = append(rec.Acceptances, a)

	err = writeJSON(filepath.Join(p.Dir, "run.json"), rec)
	if err != nil {
		return a, err
	}

	err = os.WriteFile(filepath.Join(p.Dir, "summary.md"), []byte(runSummary(rec)), 0o644)
	if err != nil {
		return a, err
	}

	m, err := measure(root, measureOptions{})
	if err == nil {
		err = recordMeasurement(m)
	}

	if err != nil {
		return a, err
	}

	fmt.Fprintf(out, "\n%s\n", acceptanceLine(a, rec))

	if !a.Green {
		return a, fmt.Errorf("not accepted — a re-run is red; last_green.json not moved (e2e_report/runs/%s/summary.md)", rec.ID)
	}

	return a, nil
}

// moveLastGreen makes a run's fingerprint (and its .proto files) the baseline.
func moveLastGreen(rep, dir string, fp *Fingerprint, run string) error {
	lg := *fp
	lg.Run = run

	err := writeJSON(filepath.Join(rep, "last_green.json"), &lg)
	if err != nil {
		return err
	}

	_ = os.RemoveAll(filepath.Join(rep, "last_green_proto"))

	return copyDirFiles(filepath.Join(dir, "proto"), filepath.Join(rep, "last_green_proto", "proto"))
}

// sameFile says whether a file reads now as a fingerprint recorded it (nil when the run did not fingerprint it).
func sameFile(run, cur *Fingerprint, path string) *bool {
	was, ok := run.Files[path]
	if !ok {
		return nil
	}

	same := cur.Files[path] == was

	return &same
}

// acceptanceLine is one acceptance in one paragraph — for latest.md and the command's last line.
func acceptanceLine(a *Acceptance, rec *RunRecord) string {
	load, named, never, green := 0, 0, 0, 0

	for _, r := range a.Reruns {
		switch r.Kind {
		case "load":
			load++
		case "named":
			named++
		case "never-ran":
			never++
		}

		if r.Green {
			green++
		}
	}

	var b strings.Builder

	if a.Green {
		fmt.Fprintf(&b, "**Accepted** %s by `san test accept-run`: %d files re-run once each in %s, all green — %d load "+
			"failures", a.At.Format("2006-01-02 15:04"), len(a.Reruns), a.Where, load)
	} else {
		fmt.Fprintf(&b, "**Not accepted** %s (`san test accept-run`): %d of %d files re-run in %s green — %d load failures",
			a.At.Format("2006-01-02 15:04"), green, len(a.Reruns), a.Where, load)
	}

	if never > 0 {
		fmt.Fprintf(&b, ", %d specs that never ran", never)
	}

	if named > 0 {
		fmt.Fprintf(&b, ", %d named with --rerun (reason: %s)", named, a.Reason)
	}

	b.WriteString(".")

	if a.MovedGreen {
		fmt.Fprintf(&b, " last_green.json is run %s's fingerprint `%s` — not the tree's at acceptance (`%s`).", rec.ID,
			rec.Fingerprint, a.TreeFingerprint)
	} else {
		b.WriteString(" last_green.json was not moved.")
	}

	return b.String()
}

// acceptanceMarkdown is an acceptance's section in the run's summary.md.
func acceptanceMarkdown(a *Acceptance, rec *RunRecord) string {
	var b strings.Builder

	title := "Accepted"
	if !a.Green {
		title = "Not accepted"
	}

	fmt.Fprintf(&b, "\n## %s %s — `san test accept-run`\n\n", title, a.At.Format("2006-01-02 15:04"))
	fmt.Fprintf(&b, "`%s`\n\n%s\n\n", a.Command, acceptanceLine(a, rec))

	if a.Reason != "" {
		fmt.Fprintf(&b, "Reason given for the files named with `--rerun`: %s\n\n", a.Reason)
	}

	b.WriteString(rerunTable(a.Reruns, true))
	fmt.Fprintf(&b, "\nLogs: `accept-%s/` beside this file.\n", stamp(a.At))

	return b.String()
}

// ── the command ───────────────────────────────────────────────────────────────────────────────────

func testAcceptRunCommand() *cli.Command {
	return &cli.Command{
		Name: "accept-run",
		Usage: "make an ended full run the green baseline when its only failures were LOAD failures: re-run each such " +
			"file once now, in this tree; when all are green last_green.json moves to THAT run's fingerprint",
		ArgsUsage: "<run stamp, a folder of e2e_report/runs/>",
		Flags: []cli.Flag{
			&cli.StringSliceFlag{Name: "rerun", Aliases: []string{"rerun-passed"}, Usage: "also re-run this Storybook " +
				"file (from frontend/) whose failure is a CHECK failure — only on the owner's word that this run is the " +
				"baseline; repeatable; needs --reason"},
			&cli.StringFlag{Name: "reason", Usage: "why the files named with --rerun may be re-run — recorded in run.json, " +
				"summary.md and latest.md"},
			&cli.BoolFlag{Name: "dry-run", Usage: "check the run and print what would be re-run; re-run nothing, move nothing"},
		},
		Action: func(ctx context.Context, cmd *cli.Command) error {
			root, err := testRoot()
			if err != nil {
				return err
			}

			req := acceptRequest{Stamp: cmd.Args().First(), Named: cmd.StringSlice("rerun"), Reason: cmd.String("reason")}

			command := "san test accept-run " + req.Stamp
			for _, n := range req.Named {
				command += " --rerun " + n
			}

			if req.Reason != "" {
				command += fmt.Sprintf(" --reason %q", req.Reason)
			}

			_, err = runAccept(ctx, root, req, cmd.Bool("dry-run"), liveAcceptExec(root), command, cmd.Root().Writer)

			return err
		},
	}
}
