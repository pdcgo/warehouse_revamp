package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/urfave/cli/v3"
)

// `san audit` — measurements of the running app that assert nothing (a measurement, not a test). Its own group, not
// `test`: `test` owns e2e_report/last_green.json and the fingerprints, and a measurement never moves them.
//
// `san audit frontend` (backlog #119, frontend-speed-is-measured-by-a-dev-tool) opens each audited screen of a
// PRODUCTION build in one headless Chromium, on a seat of its own (audit_frontend_seat.go), and counts per screen: the
// requests a load sends, the same RPC asked twice, the CORS pre-checks, the calls waiting on each other, the time until
// the screen is usable, and the requests one save fires (audit_frontend_measure.go) — and, on the big forms (P2, #125),
// React's commits and rendered components per keystroke while typing, and the commits that trail it
// (audit_frontend_typing.go). Go signs in, seeds, starts and stops the servers; frontend/scripts/speed-audit/run.mjs
// only measures.
//
//	--baseline   writes audits/frontend/<screen>.md and audits/frontend/baseline.json (committed); without it a run
//	             writes only its folder, e2e_report/frontend_audit/<stamp>/ — no committed churn
//	--screen s   only these screens (repeatable, or comma-separated)
//	--files a,b  only the screens these changed files reach (audit_frontend_files.go), then the Level 2 verdict
//	             against baseline.json (audit_frontend_verdict.go) — never writes it (#124)
//	--runs N     warm loads per screen (default 5; 1 beside a live full run — counts only)
//	--dry-run    the seat, the screens, the template and build caches, and whether it can start — touches nothing

func auditCommand() *cli.Command {
	return &cli.Command{
		Name:  "audit",
		Usage: "measure the running app — asserts nothing (frontend: requests, chains, time until usable)",
		Commands: []*cli.Command{
			auditFrontendCommand(),
		},
	}
}

func auditFrontendCommand() *cli.Command {
	return &cli.Command{
		Name:  "frontend",
		Usage: "open each audited screen of a production build in a browser on the audit's own seat, and count its requests",
		Flags: []cli.Flag{
			&cli.StringSliceFlag{Name: "screen", Usage: "only these screens (" + strings.Join(auditScreenNames(), ", ") + ")"},
			&cli.StringFlag{Name: "files", Usage: "only the screens these repo-relative files reach (comma-separated, as " +
				"`san test affected --files`), then the verdict against audits/frontend/baseline.json (the dev bot's Level 2 line)"},
			&cli.IntFlag{Name: "runs", Value: 5, Usage: "warm loads per screen, after one cold load (1 beside a full run)"},
			&cli.BoolFlag{Name: "baseline", Usage: "write audits/frontend/<screen>.md and baseline.json"},
			&cli.BoolFlag{Name: "dry-run", Usage: "print the seat, the screens and whether it can start; touch nothing"},
		},
		Action: func(ctx context.Context, cmd *cli.Command) error {
			root, err := testRoot()
			if err != nil {
				return err
			}

			var files []string

			if cmd.String("files") != "" {
				files, _, err = changedFiles(root, cmd.String("files"), time.Time{})
				if err != nil {
					return err
				}
			}

			return runAuditFrontend(ctx, root, auditOptions{
				Screens:  cmd.StringSlice("screen"),
				Files:    files,
				Runs:     int(cmd.Int("runs")),
				Baseline: cmd.Bool("baseline"),
				DryRun:   cmd.Bool("dry-run"),
			}, os.Stdout)
		},
	}
}

type auditOptions struct {
	Screens  []string
	Files    []string // --files: the screens they reach, and the verdict
	Runs     int
	Baseline bool
	DryRun   bool
}

// auditCosts is what each part of a run took (costs.json in the run folder).
type auditCosts struct {
	APIBuildSecs   float64            `json:"api_build_secs"`
	TemplateSecs   float64            `json:"template_secs"`
	TemplateKept   bool               `json:"template_kept"`
	SeedSecs       float64            `json:"seed_secs"`
	CloneSecs      float64            `json:"clone_secs"`
	ProdBuildSecs  float64            `json:"prod_build_secs"`
	ProdBuildKept  bool               `json:"prod_build_cached"`
	ServersSecs    float64            `json:"servers_secs"`
	DriverSecs     float64            `json:"driver_secs"`
	ScreenSecs     map[string]float64 `json:"screen_secs"`
	TotalSecs      float64            `json:"total_secs"`
	CountsOnly     bool               `json:"counts_only"`
	Beside         string             `json:"beside,omitempty"`
	WarmLoads      int                `json:"warm_loads"`
	ScreensMeasure int                `json:"screens"`
}

// auditRunner holds a run's servers so every exit path stops them.
type auditRunner struct {
	api, ui *auditServer
}

func (r *auditRunner) stop() {
	r.ui.stop()
	r.api.stop()
}

func runAuditFrontend(ctx context.Context, root string, opts auditOptions, out io.Writer) error {
	screens, err := auditScreensFor(root, opts, out)
	if err != nil {
		return err
	}

	if len(screens) == 0 {
		return nil // --files reached no audited screen: said so, nothing to measure
	}

	if opts.Runs < 1 {
		return errors.New("--runs must be at least 1")
	}

	frontends := []string{filepath.Join(root, "frontend")}

	seat, err := pickAuditSeat(foreignPortBusy(frontends))
	if err != nil {
		return err
	}

	beside := fullRunBeside(root)
	warm := opts.Runs
	if beside != "" {
		warm = 1
	}

	fp, err := auditTemplateFingerprint(root)
	if err != nil {
		return err
	}

	state := readAuditTemplateState(root)

	if opts.DryRun {
		return printAuditDryRun(ctx, root, seat, screens, fp, state, beside, warm, opts, out)
	}

	start := time.Now()
	costs := auditCosts{ScreenSecs: map[string]float64{}, CountsOnly: beside != "", Beside: beside, WarmLoads: warm,
		ScreensMeasure: len(screens)}

	dir := filepath.Join(auditDir(root), stamp(start))

	err = os.MkdirAll(dir, 0o755)
	if err != nil {
		return err
	}

	release, err := takeAuditLock(root, seat, out)
	if err != nil {
		return err
	}

	defer release()

	foreign := cleanupRun(reportDir(root), auditLockName, []int{seat.APIPort, seat.UIPort}, frontends, false, out)

	err = preflightE2E(foreign)
	if err != nil {
		return err
	}

	fmt.Fprintf(out, "frontend audit — %d screen(s), 1 cold + %d warm load(s) each · seat: %s (a clone of %s) · API :%d · "+
		"UI :%d · events %s\n", len(screens), warm, seat.DB, seat.Template, seat.APIPort, seat.UIPort, seat.Project)

	if beside != "" {
		fmt.Fprintf(out, "  beside %s — counts only: one warm load per screen, times recorded as noisy\n", beside)
	}

	for _, s := range seat.Skipped {
		fmt.Fprintf(out, "  skipped %s — another program holds it\n", s)
	}

	logw, err := os.Create(filepath.Join(dir, "setup.log"))
	if err != nil {
		return err
	}

	defer func() { _ = logw.Close() }()

	runner := &auditRunner{}
	defer runner.stop()

	t := time.Now()
	fmt.Fprintln(out, "→ the API binary (go build)")

	_, err = buildAuditAPI(ctx, root, dir)
	if err != nil {
		return err
	}

	costs.APIBuildSecs = time.Since(t).Seconds()

	exists, err := testDBExists(ctx, auditTemplateDB)
	if err != nil {
		return err
	}

	if state == nil || state.Fingerprint != fp || !exists || state.IDs == nil {
		t = time.Now()

		state, err = buildAuditTemplate(ctx, root, seat, fp, dir, logw, out)
		if err != nil {
			return err
		}

		costs.TemplateSecs = time.Since(t).Seconds()
		costs.SeedSecs = state.SeedSecs
	} else {
		costs.TemplateKept = true
		fmt.Fprintf(out, "→ the template %s kept (fingerprint %s, built %s)\n", auditTemplateDB, fp,
			state.Built.In(jakartaLocation()).Format("2006-01-02 15:04"))
	}

	t = time.Now()

	err = cloneAuditDB(ctx, logw)
	if err != nil {
		return err
	}

	costs.CloneSecs = time.Since(t).Seconds()
	fmt.Fprintf(out, "→ %s cloned from the template in %.1fs\n", auditDB, costs.CloneSecs)

	t = time.Now()

	build, err := ensureAuditBuild(ctx, root, seat.apiURL(), dir, out)
	if err != nil {
		return err
	}

	costs.ProdBuildSecs = time.Since(t).Seconds()
	costs.ProdBuildKept = build.Cached

	if build.Cached {
		fmt.Fprintf(out, "→ production build %s (cached)\n", build.Key)
	} else {
		fmt.Fprintf(out, "  production build %s in %.0fs\n", build.Key, build.Secs)
	}

	t = time.Now()

	runner.api, err = startAuditAPI(ctx, root, seat, auditDB, filepath.Join(dir, "api.log"))
	if err != nil {
		return err
	}

	err = ensureAuditEvents(ctx, seat, logw)
	if err != nil {
		return err
	}

	runner.ui, err = startAuditPreview(ctx, root, seat, build, filepath.Join(dir, "ui.log"))
	if err != nil {
		return err
	}

	costs.ServersSecs = time.Since(t).Seconds()
	fmt.Fprintf(out, "→ servers up in %.1fs (API pid %d, vite preview pid %d)\n", costs.ServersSecs, runner.api.pid(),
		runner.ui.pid())

	tokens := map[string]string{}

	for _, s := range screens {
		if tokens[s.Role] != "" {
			continue
		}

		username := "root"
		password := auditRootPassword

		if s.Role != "root" {
			username = state.IDs.Users[s.Role]
			password = auditUserPassword
		}

		tokens[s.Role], err = auditLogin(ctx, seat.apiURL(), username, password)
		if err != nil {
			return err
		}
	}

	plan := buildAuditPlan(seat, screens, state.IDs, tokens, warm, beside != "")
	planPath := filepath.Join(dir, "plan.json")
	resultsPath := filepath.Join(dir, "results.json")

	err = writeJSON(planPath, plan)
	if err != nil {
		return err
	}

	t = time.Now()
	fmt.Fprintf(out, "→ the browser (frontend/scripts/speed-audit/run.mjs), %d screen(s)\n", len(screens))

	frontend := filepath.Join(root, "frontend")
	argv := []string{"node", filepath.Join(frontend, "scripts", "speed-audit", "run.mjs"), "--plan", planPath, "--out",
		resultsPath}
	limit := auditDriverLimit(screens, warm)

	res, err := runCapped(ctx, frontend, argv, nil, filepath.Join(dir, "driver.log"), limit, out)
	if err != nil {
		return err
	}

	costs.DriverSecs = time.Since(t).Seconds()

	runner.stop()

	if res.Exit != 0 || res.CapHit {
		return fmt.Errorf("the driver failed (exit %d, cap hit %v) — %s", res.Exit, res.CapHit,
			filepath.ToSlash(filepath.Join(dir, "driver.log")))
	}

	raw, err := readAuditResults(resultsPath)
	if err != nil {
		return err
	}

	facts := auditFacts(root, build, state, beside != "", beside, warm)
	measures := measureAll(raw, screens, beside != "", facts.Date, appComponentNames(root))

	for _, r := range raw.Screens {
		costs.ScreenSecs[r.Name] = round1(r.Secs)
	}

	_ = runSanInProcess(context.WithoutCancel(ctx), logw, "db", "drop-test", "--name", auditDB)

	costs.TotalSecs = time.Since(start).Seconds()

	err = writeJSON(filepath.Join(dir, "costs.json"), costs)
	if err != nil {
		return err
	}

	err = writeJSON(filepath.Join(dir, "measures.json"), measures)
	if err != nil {
		return err
	}

	base := readAuditBaseline(root)

	err = os.WriteFile(filepath.Join(dir, "summary.md"), []byte(auditSummary(measures, base, costs, facts)), 0o644)
	if err != nil {
		return err
	}

	if opts.Baseline {
		err = writeAuditBaseline(root, measures, base, screens, facts)
		if err != nil {
			return err
		}
	}

	fmt.Fprintln(out)

	for _, m := range measures {
		fmt.Fprintln(out, "  "+auditSummaryLine(m))
	}

	if len(opts.Files) > 0 {
		err = writeAuditVerdict(dir, judgeAudit(measures, base, screens), out)
		if err != nil {
			return err
		}
	}

	where := filepath.ToSlash(filepath.Join(reportFolder, auditFolder, filepath.Base(dir), "summary.md"))
	if opts.Baseline {
		where += " · audits/frontend/ written"
	}

	fmt.Fprintf(out, "frontend audit: %d screen(s) in %s · %s\n", len(measures), time.Since(start).Round(time.Second), where)

	return nil
}

// auditDriverLimit is how long the driver may take: a minute a screen plus 25 s a load, and 30 s for each typing
// pass of a field (a fresh load, its setup — a product picked —, ten keys and the quiet).
func auditDriverLimit(screens []auditScreenDef, warm int) time.Duration {
	var limit time.Duration

	for _, s := range screens {
		limit += time.Minute + time.Duration(warm+1)*25*time.Second
		limit += time.Duration(len(s.Typing)*auditTypingPasses) * 30 * time.Second
	}

	return limit
}

// auditScreensFor is the screens a run measures: --files' reach (printed; none — nothing to measure), else --screen's.
func auditScreensFor(root string, opts auditOptions, out io.Writer) ([]auditScreenDef, error) {
	if len(opts.Files) == 0 {
		return pickAuditScreens(opts.Screens)
	}

	if len(opts.Screens) > 0 {
		return nil, errors.New("--files picks the screens itself: give --files or --screen, not both")
	}

	if opts.Baseline {
		return nil, errors.New("--files compares with audits/frontend/baseline.json and never writes it — re-take a " +
			"screen's baseline with --screen <name> --baseline")
	}

	fx, err := newAuditFileIndex(root, auditScreens, readAuditBaseline(root))
	if err != nil {
		return nil, err
	}

	reach := fx.reach(opts.Files)
	printAuditReach(out, reach)

	return reach.Screens, nil
}

// writeAuditVerdict prints the verdict and keeps it in the run folder (verdict.txt, verdict.json) — never in audits/.
func writeAuditVerdict(dir string, v auditVerdict, out io.Writer) error {
	fmt.Fprintln(out)
	fmt.Fprint(out, v.String())

	err := os.WriteFile(filepath.Join(dir, "verdict.txt"), []byte(v.String()), 0o644)
	if err != nil {
		return err
	}

	return writeJSON(filepath.Join(dir, "verdict.json"), v)
}

// buildAuditTemplate makes the template from scratch: its steps, then the audit's API served on it for the seed, the
// events settled, the API stopped (a database cannot be cloned while anything is connected to it), the state written.
func buildAuditTemplate(ctx context.Context, root string, seat *auditSeat, fp, dir string, logw, out io.Writer) (
	*auditTemplateState, error) {
	fmt.Fprintf(out, "→ the template %s (fingerprint %s): migrate up-all, regions, seed root, categories, the audit seed\n",
		auditTemplateDB, fp)

	start := time.Now()

	for _, argv := range auditTemplateSteps(root) {
		err := runSanInProcess(ctx, logw, argv...)
		if err != nil {
			return nil, fmt.Errorf("the template step %q: %w — %s", strings.Join(argv[:2], " "), err,
				filepath.ToSlash(filepath.Join(dir, "setup.log")))
		}
	}

	api, err := startAuditAPI(ctx, root, seat, auditTemplateDB, filepath.Join(dir, "api-template.log"))
	if err != nil {
		return nil, err
	}

	defer api.stop()

	err = ensureAuditEvents(ctx, seat, logw)
	if err != nil {
		return nil, err
	}

	seedStart := time.Now()

	ids, counts, err := seedAudit(ctx, seat.apiURL(), out)
	if err != nil {
		return nil, err
	}

	seedSecs := time.Since(seedStart).Seconds()

	api.stop()

	state := &auditTemplateState{Fingerprint: fp, Built: time.Now(), Secs: time.Since(start).Seconds(),
		SeedSecs: seedSecs, IDs: ids, Counts: counts}

	err = writeJSON(auditTemplateStatePath(root), state)
	if err != nil {
		return nil, err
	}

	fmt.Fprintf(out, "  template ready in %.0fs (seed %.0fs)\n", state.Secs, seedSecs)

	return state, nil
}

func readAuditResults(path string) (*auditRawResults, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("the driver wrote no results: %w", err)
	}

	var raw auditRawResults

	err = json.Unmarshal(b, &raw)
	if err != nil {
		return nil, fmt.Errorf("reading %s: %w", path, err)
	}

	return &raw, nil
}

// measureAll measures every screen the driver recorded, in the table's order. app are the component names frontend/src
// declares (appComponentNames) — a typing field's re-renderers are named among them too.
func measureAll(raw *auditRawResults, screens []auditScreenDef, noisy bool, date string,
	app map[string]bool) []auditMeasure {
	byName := map[string]auditRawScreen{}
	for _, r := range raw.Screens {
		byName[r.Name] = r
	}

	var out []auditMeasure

	for _, s := range screens {
		r, ok := byName[s.Name]
		if !ok {
			out = append(out, auditMeasure{Screen: s.Name, Date: date, Role: s.Role, Noisy: noisy,
				Errors: []string{"the driver recorded nothing for this screen"}})

			continue
		}

		m := measureScreen(r, s, auditShell, noisy, date)
		withAppRenderers(m.Typing, r.Typing, app)
		out = append(out, m)
	}

	return out
}

// auditFacts gathers the md's *Measured:* line.
func auditFacts(root string, build *auditBuild, state *auditTemplateState, countsOnly bool, beside string,
	warm int) auditRunFacts {
	facts := auditRunFacts{Date: auditDate(), Build: build.Key, CountsOnly: countsOnly, Beside: beside, Runs: warm}

	tree, err := exec.Command("git", "-C", root, "rev-parse", "--short=12", "HEAD:frontend/src").Output()
	if err == nil {
		facts.SrcTree = strings.TrimSpace(string(tree))
	}

	dirty, err := exec.Command("git", "-C", root, "status", "--porcelain", "--", "frontend/src").Output()
	if err == nil {
		for _, line := range strings.Split(string(dirty), "\n") {
			if strings.TrimSpace(line) != "" {
				facts.SrcDirty++
			}
		}
	}

	c := state.Counts
	facts.Seed = fmt.Sprintf("%d products · %d racks (rack A %d lines) · %d restocks accepted + %d open · %d liability "+
		"entries · %d shops", c["products"], c["racks"], c["rack_a_lines"], c["restocks_accepted"], c["restocks_open"],
		c["liability_entries"], c["shops"])

	// P4's daily ground (audit_frontend_seed_daily.go) — absent from a template built before it.
	if c["orders"] > 0 {
		facts.Seed += fmt.Sprintf(" · %d orders · %d drafts · %d expenses · %d found · %d count", c["orders"],
			c["order_drafts"], c["expenses"], c["found_requests"], c["opname_sessions"])
	}

	return facts
}

// auditSummary is the run folder's summary.md: one line per screen, the costs, and — listed, not judged — what moved
// against the committed baseline (--files judges it: verdict.txt).
func auditSummary(measures []auditMeasure, base map[string]auditMeasure, costs auditCosts, facts auditRunFacts) string {
	var b strings.Builder

	fmt.Fprintf(&b, "# frontend audit — %s\n\n", facts.Date)

	if costs.CountsOnly {
		fmt.Fprintf(&b, "Counts only (%s): one warm load per screen, times noisy.\n\n", costs.Beside)
	}

	for _, m := range measures {
		fmt.Fprintf(&b, "- %s\n", auditSummaryLine(m))
	}

	fmt.Fprintf(&b, "\n## Costs\n\n| step | seconds |\n| --- | --- |\n")
	fmt.Fprintf(&b, "| API binary (go build) | %.1f |\n", costs.APIBuildSecs)

	if costs.TemplateKept {
		fmt.Fprintf(&b, "| template | kept |\n")
	} else {
		fmt.Fprintf(&b, "| template (migrate + regions + root + categories + seed) | %.1f (seed %.1f) |\n",
			costs.TemplateSecs, costs.SeedSecs)
	}

	fmt.Fprintf(&b, "| clone | %.1f |\n", costs.CloneSecs)

	built := fmt.Sprintf("%.1f", costs.ProdBuildSecs)
	if costs.ProdBuildKept {
		built = "cached"
	}

	fmt.Fprintf(&b, "| production build | %s |\n| servers up | %.1f |\n| browser, all screens | %.1f |\n",
		built, costs.ServersSecs, costs.DriverSecs)

	names := make([]string, 0, len(costs.ScreenSecs))
	for k := range costs.ScreenSecs {
		names = append(names, k)
	}

	sort.Strings(names)

	for _, k := range names {
		fmt.Fprintf(&b, "| — %s | %.1f |\n", k, costs.ScreenSecs[k])
	}

	fmt.Fprintf(&b, "| total | %.1f |\n", costs.TotalSecs)

	var changes []string

	for _, m := range measures {
		prev, ok := base[m.Screen]
		if !ok {
			continue
		}

		for _, c := range frontendChanges(prev, m) {
			changes = append(changes, fmt.Sprintf("- %s %s: %s %s → %s %s", c.Kind, c.Screen, c.Measure, c.Was, c.Now, c.Note))
		}
	}

	if len(base) > 0 {
		fmt.Fprintf(&b, "\n## Against audits/frontend/baseline.json (listed only — the Level 2 verdict is `--files`': verdict.txt)\n\n")

		if len(changes) == 0 {
			fmt.Fprintf(&b, "Nothing moved past a threshold.\n")
		} else {
			fmt.Fprintf(&b, "%s\n", strings.Join(changes, "\n"))
		}
	}

	return b.String()
}

// writeAuditBaseline writes each measured screen's md and its baseline.json entry (with its History row), keeping the
// entries of screens this run did not measure.
func writeAuditBaseline(root string, measures []auditMeasure, base map[string]auditMeasure, screens []auditScreenDef,
	facts auditRunFacts) error {
	dir := filepath.Join(root, "audits", "frontend")

	err := os.MkdirAll(dir, 0o755)
	if err != nil {
		return err
	}

	defs := map[string]auditScreenDef{}
	for _, s := range screens {
		defs[s.Name] = s
	}

	for _, m := range measures {
		var prev *auditMeasure

		old, ok := base[m.Screen]
		if ok {
			prev = &old
			m.History = append(m.History, old.History...)
		}

		m.History = append(m.History, historyRow(m, prev, defs[m.Screen].Phase))
		base[m.Screen] = m

		err = os.WriteFile(filepath.Join(dir, m.Screen+".md"), []byte(screenMarkdown(m, defs[m.Screen], facts)), 0o644)
		if err != nil {
			return err
		}
	}

	b, err := json.MarshalIndent(base, "", "  ")
	if err != nil {
		return err
	}

	return os.WriteFile(auditBaselinePath(root), append(b, '\n'), 0o644)
}

// auditTypingFieldsText names a screen's typing fields for the dry run (" · typing: buyer name, address").
func auditTypingFieldsText(fields []auditTypingField) string {
	if len(fields) == 0 {
		return ""
	}

	names := make([]string, len(fields))
	for i, f := range fields {
		names[i] = f.Name
	}

	return " · typing: " + strings.Join(names, ", ")
}

// printAuditDryRun says where a run would run and whether it can start — and touches nothing.
func printAuditDryRun(ctx context.Context, root string, seat *auditSeat, screens []auditScreenDef, fp string,
	state *auditTemplateState, beside string, warm int, opts auditOptions, out io.Writer) error {
	fmt.Fprintf(out, "frontend audit — dry run\n")
	fmt.Fprintf(out, "  seat       database %s (a clone of %s per run) · API :%d · UI :%d · events %s\n", seat.DB,
		seat.Template, seat.APIPort, seat.UIPort, seat.Project)

	for _, s := range seat.Skipped {
		fmt.Fprintf(out, "             skipped %s — another program holds it\n", s)
	}

	fmt.Fprintf(out, "  lock       %s\n", filepath.ToSlash(filepath.Join(reportFolder, auditLockName)))

	exists, dbErr := testDBExists(ctx, auditTemplateDB)

	switch {
	case dbErr != nil:
		fmt.Fprintf(out, "  template   unknown — Postgres did not answer (%v)\n", dbErr)
	case state != nil && state.Fingerprint == fp && exists && state.IDs != nil:
		fmt.Fprintf(out, "  template   %s KEPT (fingerprint %s, built %s) — about 1 s to clone\n", auditTemplateDB, fp,
			state.Built.In(jakartaLocation()).Format("2006-01-02 15:04"))
	default:
		why := "none yet"
		if state != nil && state.Fingerprint != fp {
			why = "fingerprint " + state.Fingerprint + " → " + fp + " (a migration or the seed changed)"
		} else if state != nil && !exists {
			why = "the database is gone"
		}

		fmt.Fprintf(out, "  template   %s REBUILT — %s: migrate up-all, regions, seed root, categories, the audit seed\n",
			auditTemplateDB, why)
	}

	key, err := auditBuildKey(root, seat.apiURL())
	if err != nil {
		return err
	}

	_, statErr := os.Stat(filepath.Join(auditDir(root), "build", key, "index.html"))
	built := "BUILT (vite build)"

	if statErr == nil {
		built = "cached"
	}

	fmt.Fprintf(out, "  build      production %s — %s · served by vite preview\n", key, built)

	mode := fmt.Sprintf("1 cold + %d warm load(s) per screen", warm)
	if beside != "" {
		mode = "COUNTS ONLY beside " + beside + ": 1 cold + 1 warm load per screen, times noisy"
	}

	fmt.Fprintf(out, "  loads      %s\n", mode)
	fmt.Fprintf(out, "  screens    %d:\n", len(screens))

	for _, s := range screens {
		save := "no save"
		if s.Save != nil {
			save = "save: " + s.Save.Name
		}

		fmt.Fprintf(out, "             %-24s %-46s as %-8s · %s · %d probe(s)%s\n", s.Name, s.Route, s.Role, save,
			len(s.Probes), auditTypingFieldsText(s.Typing))
	}

	writes := "its run folder only (e2e_report/frontend_audit/<stamp>/)"
	if opts.Baseline {
		writes = "audits/frontend/<screen>.md + baseline.json, and its run folder"
	}

	fmt.Fprintf(out, "  writes     %s\n", writes)

	refusal := auditRefusal(auditLocks(root), os.Getpid(), pidAlive)
	if refusal == nil {
		refusal = preflightE2E(nil)
	}

	if refusal != nil {
		fmt.Fprintf(out, "  can start  NO — %v\n", refusal)

		return nil
	}

	fmt.Fprintf(out, "  can start  yes\n")

	return nil
}
