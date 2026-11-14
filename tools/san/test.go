package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/urfave/cli/v3"
)

// `san test` — measured testing (the-full-e2e-waits-for-a-measured-yes, backlog #49).
//
// MACHINE commands (docs/tools/san.md, "Two shapes"): they never ask which database. The e2e they
// run uses its own test database (warehouse_test) through Playwright's setup, as it always did — except the full run,
// which tests a frozen copy on databases and ports of its own (warehouse_test_go, warehouse_test_w1, :8181/:5181, a
// Storybook port of its own), so the live tree's tests go on beside it.
//
//	go run ./tools/san test measure     the files now vs the last green full run: areas, risk, due?
//	go run ./tools/san test affected    the e2e specs the change reaches, and the smoke set
//	go run ./tools/san test smoke       run the smoke set (~5 flows, under 5 min)
//	go run ./tools/san test full        the full go test, Storybook and e2e on a frozen copy
//	go run ./tools/san test report      latest.md and the recent runs
//	go run ./tools/san test slice       log the files this slice changed
//	go run ./tools/san test accept-run  make an ended full run the baseline when it only failed to LOAD files
func testCommand() *cli.Command {
	return &cli.Command{
		Name:  "test",
		Usage: "measured testing: measure the change, run the affected specs and the smoke set, the full suites when due",
		Commands: []*cli.Command{
			testMeasureCommand(),
			testAffectedCommand(),
			testSmokeCommand(),
			testFullCommand(),
			testReportCommand(),
			testSliceCommand(),
			testAcceptRunCommand(),
		},
	}
}

// testRoot is the checkout, found fresh from the working directory (not cached: tests change it).
func testRoot() (string, error) {
	return findRepoRoot()
}

func sinceFlag() cli.Flag {
	return &cli.StringFlag{
		Name: "since",
		Usage: "with no green baseline yet: count files modified after this time instead — " +
			"\"2006-01-02 15:04\", RFC 3339, or a file whose modification time is used (an old run's summary.txt)",
	}
}

// parseSince reads --since.
func parseSince(v string) (time.Time, error) {
	if v == "" {
		return time.Time{}, nil
	}

	for _, layout := range []string{time.RFC3339, "2006-01-02 15:04:05", "2006-01-02 15:04", "2006-01-02T15:04", "2006-01-02"} {
		t, err := time.ParseInLocation(layout, v, time.Local)
		if err == nil {
			return t, nil
		}
	}

	info, err := os.Stat(v)
	if err == nil {
		return info.ModTime(), nil
	}

	return time.Time{}, fmt.Errorf("--since %q: not a time (2006-01-02 15:04) and not a file", v)
}

func testMeasureCommand() *cli.Command {
	return &cli.Command{
		Name: "measure",
		Usage: "fingerprint the source files and compare them with e2e_report/last_green.json: the areas changed, " +
			"their risk, whether the full run is due or overdue, and the one-line ask",
		Flags: []cli.Flag{
			&cli.BoolFlag{Name: "ready", Usage: "work is about to be reported ready: any change makes the full run due"},
			&cli.BoolFlag{Name: "end-of-day", Usage: "the day is ending: a due full run still unanswered is overdue"},
			sinceFlag(),
		},
		Action: func(ctx context.Context, cmd *cli.Command) error {
			root, err := testRoot()
			if err != nil {
				return err
			}

			since, err := parseSince(cmd.String("since"))
			if err != nil {
				return err
			}

			m, err := measure(root, measureOptions{Ready: cmd.Bool("ready"), EndOfDay: cmd.Bool("end-of-day"), Since: since})
			if err != nil {
				return err
			}

			m.print(cmd.Root().Writer)

			return recordMeasurement(m)
		},
	}
}

// changedFiles is the change the affected finder traces: --files, else the diff with the last green
// run, else --since.
func changedFiles(root, files string, since time.Time) ([]string, string, error) {
	if files != "" {
		var out []string

		for _, f := range strings.Split(files, ",") {
			f = filepath.ToSlash(strings.TrimSpace(f))
			if f != "" {
				out = append(out, f)
			}
		}

		return out, "--files", nil
	}

	cur, err := takeFingerprint(root)
	if err != nil {
		return nil, "", err
	}

	base, err := readFingerprint(filepath.Join(reportDir(root), "last_green.json"))

	switch {
	case err == nil:
		return diffFingerprints(base, cur).All(), "since the last green run, " + base.TakenAt.Format("2006-01-02 15:04"), nil
	case !errors.Is(err, fs.ErrNotExist):
		return nil, "", err
	case since.IsZero():
		return nil, "", errors.New("no green baseline (e2e_report/last_green.json) to compare with — pass --since <time> " +
			"(files modified after it) or --files a,b")
	}

	d, err := diffSince(root, cur, since)
	if err != nil {
		return nil, "", err
	}

	return d.All(), "modified since " + since.Format("2006-01-02 15:04") + ", no green baseline yet", nil
}

func testAffectedCommand() *cli.Command {
	return &cli.Command{
		Name: "affected",
		Usage: "the e2e specs that call a changed RPC, open a changed page or use a changed component — " +
			"and the smoke set; --run runs them",
		Flags: []cli.Flag{
			sinceFlag(),
			&cli.StringFlag{Name: "files", Usage: "trace these repo-relative files (comma-separated) instead of the measured change"},
			&cli.BoolFlag{Name: "run", Usage: "run the affected specs and the smoke set here, in batches (orders alone, the restock family together)"},
			&cli.BoolFlag{Name: "dry-run", Usage: "with --run: print the Playwright batches, run nothing"},
		},
		Action: func(ctx context.Context, cmd *cli.Command) error {
			root, err := testRoot()
			if err != nil {
				return err
			}

			out := cmd.Root().Writer

			since, err := parseSince(cmd.String("since"))
			if err != nil {
				return err
			}

			changed, source, err := changedFiles(root, cmd.String("files"), since)
			if err != nil {
				return err
			}

			res, err := findAffected(root, changed)
			if err != nil {
				return err
			}

			flows, err := readSmoke(root)
			if errors.Is(err, fs.ErrNotExist) {
				return errNoSmoke
			}

			if err != nil {
				return err
			}

			printAffected(out, res, flows, len(changed), source)

			if !cmd.Bool("run") {
				fmt.Fprintln(out, "\nrun them: go run ./tools/san test affected --run")

				return nil
			}

			whole := map[string]bool{}
			for s := range res.Specs {
				whole[s] = true
			}

			batches := smokeBatches(flows, whole)

			fmt.Fprintln(out)

			if cmd.Bool("dry-run") {
				fmt.Fprintln(out, "affected --run — the plan (dry run: nothing runs)")
				printSmokePlan(out, root, nil, batches)

				return nil
			}

			return reportLevel2(ctx, root, "affected", batches, 0, out)
		},
	}
}

// reportLevel2 runs level-2 batches and prints the verdict; a red run is an error (exit 1).
func reportLevel2(ctx context.Context, root, kind string, batches []level2Batch, limit time.Duration, out io.Writer) error {
	if limit == 0 {
		limit = 24 * time.Hour
	}

	rec, err := runLevel2(ctx, root, kind, batches, limit, out)
	if rec != nil {
		fmt.Fprintf(out, "\n%s\n", runLine(rec))

		for _, b := range rec.E2E.Batches {
			for _, f := range b.Failures {
				fmt.Fprintf(out, "  ✗ %s\n", f)
			}
		}
	}

	if err != nil {
		return err
	}

	if !rec.Green {
		return fmt.Errorf("%s run is not green — e2e_report/level2/%s/summary.md", kind, rec.ID)
	}

	return nil
}

func testSmokeCommand() *cli.Command {
	return &cli.Command{
		Name:  "smoke",
		Usage: "run the smoke set — about five key flows from frontend/e2e/smoke.txt, under 5 minutes, in this working tree",
		Flags: []cli.Flag{
			&cli.BoolFlag{Name: "dry-run", Usage: "print the flows and the Playwright command, and check every entry still names one test"},
		},
		Action: func(ctx context.Context, cmd *cli.Command) error {
			root, err := testRoot()
			if err != nil {
				return err
			}

			out := cmd.Root().Writer

			flows, err := readSmoke(root)
			if errors.Is(err, fs.ErrNotExist) {
				return errNoSmoke
			}

			if err != nil {
				return err
			}

			batches := smokeBatches(flows, nil)

			if cmd.Bool("dry-run") {
				fmt.Fprintln(out, "smoke — the plan (dry run: nothing runs)")
				printSmokePlan(out, root, flows, batches)

				return listSmoke(ctx, root, flows, out)
			}

			return reportLevel2(ctx, root, "smoke", batches, smokeCap, out)
		},
	}
}

func testFullCommand() *cli.Command {
	return &cli.Command{
		Name: "full",
		Usage: "the full go test, Storybook and e2e on a frozen copy of the folder — run it only when measured due " +
			"and the owner said yes; last_green.json moves only when all of it is green",
		Flags: []cli.Flag{
			&cli.BoolFlag{Name: "dry-run", Usage: "print the plan — the copy, every step and batch — and run nothing"},
			&cli.BoolFlag{Name: "keep-copy", Usage: "keep the frozen copy afterwards (to debug a failure in the files tested)"},
			&cli.StringFlag{Name: "copy-dir", Usage: "where the frozen copy goes (default: the system temp folder)"},
			&cli.StringSliceFlag{Name: "spec", Usage: "only these e2e spec files — a partial run, never moves last_green"},
			&cli.StringSliceFlag{Name: "story", Usage: "only these story files (paths from frontend/) — partial"},
			&cli.StringSliceFlag{Name: "go", Usage: "only these go packages (./backend/services/x/...) — partial"},
			&cli.StringSliceFlag{Name: "skip", Usage: "skip a part: go, stories or e2e — partial"},
			&cli.IntFlag{Name: "workers", Value: defaultWorkers, Usage: "e2e workers, each with its own database (a " +
				"clone of a template), API and UI ports and events project — 1 (the default) runs the name-ordered " +
				"batches on warehouse_test_w1, :8181/:5181, so the live tree's tests go on beside it"},
			&cli.BoolFlag{Name: "shared-db", Hidden: true, Usage: "the old single-database e2e on warehouse_test, " +
				":8081/:5175 — it blocks smoke, affected --run and Go DB tests in the live tree while it runs"},
			&cli.StringFlag{Name: "times", Usage: "an old e2e_batches.sh summary.txt (its b<N>.log beside it) to read " +
				"per-spec times from, for specs no recorded run timed — the workers' balancing and the estimate"},
		},
		Action: func(ctx context.Context, cmd *cli.Command) error {
			root, err := testRoot()
			if err != nil {
				return err
			}

			out := cmd.Root().Writer

			opts := fullOptions{
				DryRun:   cmd.Bool("dry-run"),
				KeepCopy: cmd.Bool("keep-copy"),
				CopyDir:  cmd.String("copy-dir"),
				Specs:    cmd.StringSlice("spec"),
				Stories:  cmd.StringSlice("story"),
				GoPkgs:   cmd.StringSlice("go"),
				Skip:     cmd.StringSlice("skip"),
				Workers:  int(cmd.Int("workers")),
				Times:    cmd.String("times"),
				SharedDB: cmd.Bool("shared-db"),
			}

			if opts.Workers < 1 || opts.Workers > maxWorkers {
				return fmt.Errorf("--workers %d: want 1 to %d", opts.Workers, maxWorkers)
			}

			if opts.SharedDB && opts.Workers > 1 {
				return fmt.Errorf("--shared-db runs the e2e on the one warehouse_test — it takes no --workers %d", opts.Workers)
			}

			for _, s := range opts.Skip {
				if s != "go" && s != "stories" && s != "e2e" {
					return fmt.Errorf("--skip %q: want go, stories or e2e", s)
				}
			}

			if !opts.DryRun {
				rec, err := runFull(ctx, root, opts, out)
				if err != nil {
					return err
				}

				if !rec.Green {
					return fmt.Errorf("the full run is not green — e2e_report/runs/%s/summary.md", rec.ID)
				}

				return nil
			}

			plan, err := planFull(root, opts, time.Now())
			if err != nil {
				return err
			}

			m, err := measure(root, measureOptions{})
			if err != nil {
				return err
			}

			fmt.Fprintln(out, "(dry run: nothing is copied or run)")
			plan.print(out, m.Current, m)

			if busy := refuseFullIfBusy(root, plan.Shared, plan.workerNames()); busy != nil {
				fmt.Fprintf(out, "\n⚠ it would not start now: %v\n", busy)
			}

			return nil
		},
	}
}

func testReportCommand() *cli.Command {
	return &cli.Command{
		Name:  "report",
		Usage: "print e2e_report/latest.md and the recent full and level-2 runs",
		Flags: []cli.Flag{
			&cli.IntFlag{Name: "runs", Value: 5, Usage: "how many recent runs of each kind to list"},
		},
		Action: func(ctx context.Context, cmd *cli.Command) error {
			root, err := testRoot()
			if err != nil {
				return err
			}

			return printReport(root, cmd.Root().Writer, int(cmd.Int("runs")))
		},
	}
}

func testSliceCommand() *cli.Command {
	return &cli.Command{
		Name:      "slice",
		Usage:     "append the files changed since the last mark to e2e_report/slice_log.md, so a failure traces to its slice",
		ArgsUsage: "<what the slice did>",
		Action: func(ctx context.Context, cmd *cli.Command) error {
			what := strings.TrimSpace(strings.Join(cmd.Args().Slice(), " "))
			if what == "" {
				return errors.New(`name the slice: san test slice "restock layout pass"`)
			}

			root, err := testRoot()
			if err != nil {
				return err
			}

			return markSlice(root, what, cmd.Root().Writer)
		},
	}
}
