package main

import (
	"context"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// A FILE THAT FAILS TO LOAD IS RE-RUN ONCE (a-file-that-fails-to-load-is-re-run-once,
// docs/development_lifecycle_decision.md). A failed Storybook or e2e run is sorted PER FILE:
//
//	load failure   the file never ran a check because it failed to import or load — re-run ONCE, by itself, inside
//	               the same full run; green on the re-run counts as green; failing to load again is red
//	check failure  a failed assertion, a timeout inside a test, a crash after the file loaded — NEVER re-run: red
//
// Conservative on purpose: a failure counts as a load failure only when it carries one of the exact signatures below
// (docs/tools/san.md#a-file-that-fails-to-load-is-re-run-once). Anything else — an unknown message, a failure no file
// can be named for, a file with one load failure and one failed check — is a check failure (or unattributed: red).
//
// Storybook (vitest browser mode), read from its log:
//
//	a FAIL'd suite (`FAIL |storybook (chromium)| <file> [ <file> ]`) whose error says `Failed to import test file` or
//	    `Failed to fetch dynamically imported module`
//	a FAIL'd story (`FAIL |…| <file> > <story>`) whose error is ONLY `Failed to fetch dynamically imported module: <url>`
//	    (beside the empty `TypeError:` header, the "Click to debug" link and stack frames) — the import failed, no check ran
//	an unhandled error `Failed to run the test <file>.` caused by `Cannot connect to the iframe`
//
// …and only when every file vitest counted RAN: its browser pool stops the whole run at the first file that errors
// (an iframe that never loaded, a dropped browser), so the files still queued are in the `Test Files` total but in
// none of its counts. Such a run is red (unattributed) — re-running the load-failed files would leave the never-run
// ones untested and call the run green (20261114-100420 and -131538 did: 29 and 32 files never ran).
//
// Playwright (1.61), read from its JSON report — a spec that fails to load stops the WHOLE run before any test:
//
//	the report loaded no suite, counted no test, and EVERY entry of its top-level `errors` names one of the batch's
//	    spec files — by `location.file` (a SyntaxError, a throw while the file is evaluated) or by
//	    `Cannot find module '…' imported from <spec>`. An error in the global setup (location global-setup.ts), a web
//	    server that never started, an import missing in a helper: not a spec of the batch — red.
//
// The batch's other specs never ran either; they run once more in a fresh batch of their own after the load-failed
// specs have each run alone.

const storyRerunCap = 10 * time.Minute

// FileFailure is one file's failures in a run, and why they are sorted the way they are.
type FileFailure struct {
	File  string   `json:"file"`
	Why   string   `json:"why"`             // the load signature matched, or the check's first error line
	Tests []string `json:"tests,omitempty"` // the failing stories / tests, when the failure was per test
}

// FailureClass is a failed Storybook run's failures sorted per file.
type FailureClass struct {
	Load         []FileFailure `json:"load,omitempty"`         // never ran a check: re-run once
	Check        []FileFailure `json:"check,omitempty"`        // a check failed: never re-run
	Unattributed []string      `json:"unattributed,omitempty"` // a failure no file can be named for: red
}

// retriable says whether the run could still turn green: load failures only.
func (c *FailureClass) retriable() bool {
	return c != nil && len(c.Load) > 0 && len(c.Check) == 0 && len(c.Unattributed) == 0
}

func (c *FailureClass) loadFiles() []string {
	var out []string

	for _, f := range c.Load {
		out = append(out, f.File)
	}

	return out
}

func (c *FailureClass) find(file string) (*FileFailure, string) {
	for i := range c.Load {
		if c.Load[i].File == file {
			return &c.Load[i], "load"
		}
	}

	for i := range c.Check {
		if c.Check[i].File == file {
			return &c.Check[i], "check"
		}
	}

	return nil, ""
}

// Rerun is one file run again by itself, why, and how it went.
type Rerun struct {
	Part   string `json:"part"`             // stories, e2e
	File   string `json:"file"`             // a story file from frontend/, or a spec file
	Kind   string `json:"kind"`             // load · never-ran (the batch stopped on another spec's load error) · named (--rerun)
	Why    string `json:"why"`              // the load signature, or the reason given with --rerun
	Where  string `json:"where"`            // the frozen copy · the live tree
	Worker string `json:"worker,omitempty"` // e2e: the worker whose database and ports it ran on
	Batch  string `json:"batch,omitempty"`  // e2e: the fresh batch it ran in (w1-rerun1)
	Exit   int    `json:"exit"`
	Secs   int    `json:"secs"`
	CapHit bool   `json:"cap_hit,omitempty"`
	Passed int    `json:"passed"`
	Failed int    `json:"failed"`
	Green  bool   `json:"green"`
	Result string `json:"result"`
	Log    string `json:"log,omitempty"`
	// accept-run: whether the file re-run in the live tree reads as the run tested it (its fingerprint hash).
	SameAsRun *bool `json:"same_as_run,omitempty"`
}

// ── Storybook: sorting vitest's failures per file ───────────────────────────────────────────────────

var (
	ansiRe            = regexp.MustCompile("\x1b\\[[0-9;]*[A-Za-z]")
	vitestSectionRe   = regexp.MustCompile(`^\s*⎯+\s*(Failed Suites|Failed Tests|Unhandled Errors|Unhandled Error)(?:\s+\d+)?\s*⎯+\s*$`)
	vitestSepRe       = regexp.MustCompile(`^\s*⎯+(?:\[\d+/\d+\]⎯*)?\s*$`)
	vitestHeadRe      = regexp.MustCompile(`^\s*FAIL\s+(?:\|[^|]*\|\s+)?(.+?)\s*$`)
	vitestSuiteHeadRe = regexp.MustCompile(`^(.+?)\s+\[\s*.+?\s*\]$`)
	vitestSummaryRe   = regexp.MustCompile(`^\s*Test Files\s`)
	vitestFilesFailRe = regexp.MustCompile(`(?m)^\s*Test Files\s+(\d+) failed`)
	vitestErrCountRe  = regexp.MustCompile(`(?m)^\s*Errors\s+(\d+) errors?`)
	vitestFilesLineRe = regexp.MustCompile(`^\s*Test Files\s+(.+?)\s+\((\d+)\)\s*$`)
	vitestCountRe     = regexp.MustCompile(`^(\d+)\s+\S+$`)
	failedToRunRe     = regexp.MustCompile(`Failed to run the test (.+?)\.?\s*$`)
	dynImportOnlyRe   = regexp.MustCompile(`^(?:(?:TypeError|Error):\s*)?Failed to fetch dynamically imported module: \S+$`)
)

const (
	sigImport   = "Failed to import test file"
	sigDynamic  = "Failed to fetch dynamically imported module"
	sigIframe   = "Cannot connect to the iframe"
	sigFailedTo = "Failed to run the test"
)

// vitestBlock is one failure as vitest prints it: the FAIL lines sharing one error, and that error.
type vitestBlock struct {
	section string // suites, tests, unhandled
	heads   []string
	body    []string
	hasBody bool
}

// failEntry is one failing file (or story of it) and its verdict.
type failEntry struct {
	file, test, why string
	load            bool
}

// classifyVitest sorts a vitest run's failures per file. exit and capHit are the run's.
func classifyVitest(log string, exit int, capHit bool) *FailureClass {
	c := &FailureClass{}

	if capHit {
		c.Unattributed = append(c.Unattributed, "the run hit its cap — it did not finish")

		return c
	}

	var entries []failEntry

	blocks := vitestBlocks(log)
	unhandled := 0

	for _, b := range blocks {
		switch b.section {
		case "unhandled":
			unhandled++

			file, why, load := judgeUnhandled(b.body)
			if file == "" {
				c.Unattributed = append(c.Unattributed, "an unhandled error naming no file: "+why)

				continue
			}

			entries = append(entries, failEntry{file: file, why: why, load: load})
		default:
			for _, h := range b.heads {
				file, test := splitHead(h)
				why, load := judgeBody(b.body, test != "")
				entries = append(entries, failEntry{file: file, test: test, why: why, load: load})
			}
		}
	}

	// Every failed file and error vitest counts must be one the log names — else something went unread: red.
	failedFiles := 0
	if m := vitestFilesFailRe.FindStringSubmatch(log); m != nil {
		failedFiles, _ = strconv.Atoi(m[1])
	}

	headFiles := map[string]bool{}

	for _, b := range blocks {
		if b.section != "unhandled" {
			for _, h := range b.heads {
				f, _ := splitHead(h)
				headFiles[f] = true
			}
		}
	}

	if failedFiles > len(headFiles) {
		c.Unattributed = append(c.Unattributed, fmt.Sprintf("vitest counts %d failed files, the log names %d", failedFiles,
			len(headFiles)))
	}

	if m := vitestErrCountRe.FindStringSubmatch(log); m != nil {
		n, _ := strconv.Atoi(m[1])
		if n > unhandled {
			c.Unattributed = append(c.Unattributed, fmt.Sprintf("vitest counts %d errors, the log shows %d", n, unhandled))
		}
	}

	// Every file vitest set out to run must have run — the browser pool drops the queue at one file's error.
	ran, total, ok := vitestFilesRan(log)
	if ok && ran < total {
		c.Unattributed = append(c.Unattributed, fmt.Sprintf("vitest ran %d of %d story files — %d never ran (its "+
			"browser pool stopped the run at one file's error)", ran, total, total-ran))
	}

	if !vitestSummaryRe.MatchString(lastSummaryLine(log)) && exit != 0 {
		c.Unattributed = append(c.Unattributed, "no `Test Files` summary — the run did not finish")
	}

	if exit != 0 && len(entries) == 0 && len(c.Unattributed) == 0 {
		c.Unattributed = append(c.Unattributed, fmt.Sprintf("vitest exited %d and named no failure", exit))
	}

	// Per file: a load failure only when EVERY failure of the file is one.
	var order []string

	byFile := map[string][]failEntry{}

	for _, e := range entries {
		if _, seen := byFile[e.file]; !seen {
			order = append(order, e.file)
		}

		byFile[e.file] = append(byFile[e.file], e)
	}

	for _, f := range order {
		es := byFile[f]
		ff := FileFailure{File: f, Why: es[0].why}
		load := true

		for _, e := range es {
			if e.test != "" {
				ff.Tests = append(ff.Tests, e.test)
			}

			if !e.load {
				if load {
					ff.Why = e.why
				}

				load = false
			}
		}

		if load {
			c.Load = append(c.Load, ff)
		} else {
			c.Check = append(c.Check, ff)
		}
	}

	return c
}

// lastSummaryLine is the `Test Files` line, or "" when the log has none.
func lastSummaryLine(log string) string {
	for _, line := range strings.Split(log, "\n") {
		if vitestSummaryRe.MatchString(line) {
			return line
		}
	}

	return ""
}

// vitestFilesRan reads the `Test Files` line: the files counted in any state (failed, passed, skipped, todo) and the
// total vitest set out to run. ok is false when the log has no such line.
func vitestFilesRan(log string) (ran, total int, ok bool) {
	var m []string

	for _, raw := range strings.Split(log, "\n") {
		m = vitestFilesLineRe.FindStringSubmatch(strings.TrimRight(ansiRe.ReplaceAllString(raw, ""), "\r"))
		if m != nil {
			break
		}
	}

	if m == nil {
		return 0, 0, false
	}

	total, err := strconv.Atoi(m[2])
	if err != nil {
		return 0, 0, false
	}

	for _, part := range strings.Split(m[1], "|") {
		c := vitestCountRe.FindStringSubmatch(strings.TrimSpace(part))
		if c == nil {
			return 0, 0, false
		}

		n, err := strconv.Atoi(c[1])
		if err != nil {
			return 0, 0, false
		}

		ran += n
	}

	return ran, total, true
}

// vitestBlocks cuts a vitest log into its failure blocks.
func vitestBlocks(log string) []vitestBlock {
	var blocks []vitestBlock

	var cur *vitestBlock

	section := ""

	flush := func() {
		if cur != nil && (len(cur.heads) > 0 || cur.section == "unhandled") {
			blocks = append(blocks, *cur)
		}

		cur = nil
	}

	for _, raw := range strings.Split(log, "\n") {
		line := strings.TrimRight(ansiRe.ReplaceAllString(raw, ""), "\r")

		if m := vitestSectionRe.FindStringSubmatch(line); m != nil {
			flush()

			switch m[1] {
			case "Failed Suites":
				section = "suites"
			case "Failed Tests":
				section = "tests"
			case "Unhandled Errors":
				section = "unhandled-intro"
			case "Unhandled Error":
				section = "unhandled"
				cur = &vitestBlock{section: "unhandled"}
			}

			continue
		}

		if vitestSummaryRe.MatchString(line) {
			flush()

			section = ""

			continue
		}

		if vitestSepRe.MatchString(line) {
			flush()

			continue
		}

		switch section {
		case "suites", "tests":
			if m := vitestHeadRe.FindStringSubmatch(line); m != nil {
				if cur == nil || cur.hasBody {
					flush()

					cur = &vitestBlock{section: section}
				}

				cur.heads = append(cur.heads, m[1])

				continue
			}

			if cur != nil {
				cur.body = append(cur.body, line)
				cur.hasBody = cur.hasBody || strings.TrimSpace(line) != ""
			}
		case "unhandled":
			if cur != nil {
				cur.body = append(cur.body, line)
			}
		}
	}

	flush()

	return blocks
}

// splitHead reads a FAIL line's subject: `<file> [ <file> ]` (the suite) or `<file> > <story>`.
func splitHead(h string) (file, test string) {
	if f, t, ok := strings.Cut(h, " > "); ok {
		return normStoryPath(f), strings.TrimSpace(t)
	}

	if m := vitestSuiteHeadRe.FindStringSubmatch(h); m != nil {
		return normStoryPath(m[1]), ""
	}

	return normStoryPath(h), ""
}

// judgeBody says whether a FAIL block's error is a load failure, and why.
func judgeBody(body []string, perTest bool) (string, bool) {
	var meaningful []string

	for _, l := range body {
		t := strings.TrimSpace(l)

		switch {
		case t == "", t == "TypeError:", t == "Error:",
			strings.HasPrefix(t, "Click to debug the error directly in Storybook"),
			strings.HasPrefix(t, "❯ "), strings.HasPrefix(t, "at "):
			continue
		}

		meaningful = append(meaningful, t)
	}

	if len(meaningful) == 0 {
		return "an error with no message", false
	}

	if !perTest {
		for _, t := range meaningful {
			if strings.Contains(t, sigImport) || strings.Contains(t, sigDynamic) {
				return loadWhy(meaningful), true
			}
		}

		return clip(meaningful[0], 240), false
	}

	// A story: a load failure only when its error is the dynamic import's fetch failure and nothing else.
	for _, t := range meaningful {
		if !dynImportOnlyRe.MatchString(t) {
			return clip(meaningful[0], 240), false
		}
	}

	return loadWhy(meaningful) + " — the story's only error", true
}

var (
	importedFileRe = regexp.MustCompile(sigImport + ` (\S+)`)
	dynURLRe       = regexp.MustCompile(sigDynamic + `: (\S+)`)
)

// loadWhy names a load failure briefly: the signatures it carries and the file whose import failed.
func loadWhy(lines []string) string {
	var parts []string

	text := strings.Join(lines, "\n")

	if m := importedFileRe.FindStringSubmatch(text); m != nil {
		parts = append(parts, sigImport+" ("+lastSegment(m[1])+")")
	}

	if m := dynURLRe.FindStringSubmatch(text); m != nil {
		parts = append(parts, sigDynamic+" ("+lastSegment(m[1])+")")
	}

	if len(parts) == 0 {
		return clip(lines[0], 240)
	}

	return strings.Join(parts, " — ")
}

// lastSegment is a path's or URL's last segment, without its query.
func lastSegment(p string) string {
	p, _, _ = strings.Cut(p, "?")
	p = strings.TrimRight(filepath.ToSlash(p), "/")

	if i := strings.LastIndex(p, "/"); i >= 0 {
		return p[i+1:]
	}

	return p
}

// judgeUnhandled reads an unhandled error: the file it names, why, and whether it is the iframe's load failure.
func judgeUnhandled(body []string) (file, why string, load bool) {
	first := ""
	iframe := false

	for _, l := range body {
		t := strings.TrimSpace(l)
		if t == "" {
			continue
		}

		if first == "" {
			first = t
		}

		if m := failedToRunRe.FindStringSubmatch(t); m != nil && file == "" {
			file = normStoryPath(m[1])
		}

		if strings.Contains(t, sigIframe) {
			iframe = true
		}
	}

	if file != "" && iframe {
		return file, "unhandled: " + sigFailedTo + " — " + sigIframe, true
	}

	if first == "" {
		first = "(empty)"
	}

	return file, "unhandled: " + clip(first, 200), false
}

// normStoryPath is a story file's path from frontend/, whichever form vitest printed it in (relative, or absolute in
// the copy or the live tree).
func normStoryPath(p string) string {
	p = strings.ReplaceAll(strings.TrimSpace(p), `\`, "/")
	p = strings.TrimSuffix(p, ".")

	if i := strings.LastIndex(p, "/frontend/"); i >= 0 {
		p = p[i+len("/frontend/"):]
	}

	p = strings.TrimPrefix(p, "frontend/")

	return strings.TrimPrefix(p, "./")
}

// ── Storybook: re-running the load-failed files ─────────────────────────────────────────────────────

// storyRunner runs ONE story file by itself and judges it.
type storyRunner func(ctx context.Context, file, logPath string) *Rerun

// vitestFileRunner is the real storyRunner: vitest on that one file, in frontend, with env added (the frozen copy's
// own browser port).
func vitestFileRunner(frontend string, env ...string) storyRunner {
	return func(ctx context.Context, file, logPath string) *Rerun {
		argv := []string{"node", filepath.Join("node_modules", "vitest", "vitest.mjs"), "run", "--project=storybook", file}
		r := &Rerun{Part: "stories", File: file, Log: logPath}

		res, err := runCapped(ctx, frontend, argv, env, logPath, storyRerunCap, nil)
		r.Exit, r.Secs, r.CapHit = res.Exit, res.Secs, res.CapHit

		if err != nil {
			r.Exit = -1
			r.Result = "✗ could not run: " + err.Error()

			return r
		}

		b, _ := os.ReadFile(logPath)
		judgeStoryRerun(r, string(b))

		return r
	}
}

// judgeStoryRerun reads a one-file vitest run: green only when it ran tests and none failed.
func judgeStoryRerun(r *Rerun, log string) {
	r.Passed, r.Failed, _ = vitestCounts(log)

	if r.CapHit {
		r.Result = "✗ CAP HIT — red"

		return
	}

	if r.Exit == 0 && r.Failed == 0 && r.Passed > 0 {
		r.Green = true
		r.Result = fmt.Sprintf("✓ %d passed", r.Passed)

		return
	}

	c := classifyVitest(log, r.Exit, r.CapHit)

	switch {
	case len(c.Load) > 0 && len(c.Check) == 0:
		r.Result = "✗ failed to load again — a second load failure is red"
	case r.Passed == 0 && r.Failed == 0:
		r.Result = fmt.Sprintf("✗ no test ran (exit %d)", r.Exit)
	default:
		r.Result = fmt.Sprintf("✗ %d failed, %d passed", r.Failed, r.Passed)
	}
}

// rerunStoryLoads sorts a failed Storybook part's failures (kept on the part) and, when every failure is a load
// failure, runs each load-failed file ONCE by itself. A file whose re-run fails stays red — it is never run a third time.
func rerunStoryLoads(ctx context.Context, p *PartResult, logDir, where string, run storyRunner, out io.Writer) []*Rerun {
	if p == nil || p.green() {
		return nil
	}

	b, _ := os.ReadFile(p.Log)
	p.Classes = classifyVitest(string(b), p.Exit, p.CapHit)

	if !p.Classes.retriable() {
		switch {
		case len(p.Classes.Load) > 0 && len(p.Classes.Check) == 0:
			fmt.Fprintf(out, "  %d story files failed to load, but %s — not re-run, the run is red\n",
				len(p.Classes.Load), strings.Join(p.Classes.Unattributed, "; "))
		case len(p.Classes.Load) > 0:
			fmt.Fprintf(out, "  %d story files failed to load, but a check failed too — not re-run, the run is red\n",
				len(p.Classes.Load))
		}

		return nil
	}

	fmt.Fprintf(out, "→ stories: %d files failed to LOAD — each re-run once, by itself, in %s\n", len(p.Classes.Load), where)

	var reruns []*Rerun

	for i, f := range p.Classes.Load {
		if ctx.Err() != nil {
			break
		}

		r := run(ctx, f.File, filepath.Join(logDir, fmt.Sprintf("stories-rerun-%d.log", i+1)))
		r.Part, r.File, r.Kind, r.Why, r.Where = "stories", f.File, "load", f.Why, where
		reruns = append(reruns, r)

		fmt.Fprintf(out, "  %s %s\n", r.Result, f.File)
	}

	return reruns
}

// storiesGreen is the Storybook part's verdict with its re-runs: green as run, or every failure a load failure and
// every load-failed file green on its one re-run.
func (r *RunRecord) storiesGreen() bool {
	p := r.Stories
	if p.green() {
		return true
	}

	if p == nil || p.CapHit || !p.Classes.retriable() {
		return false
	}

	for _, f := range p.Classes.Load {
		if !rerunGreen(r.Reruns, "stories", f.File) {
			return false
		}
	}

	return true
}

// rerunGreen says whether a file of a part has a green re-run among reruns.
func rerunGreen(reruns []*Rerun, part, file string) bool {
	for _, x := range reruns {
		if x.Part == part && x.File == file {
			return x.Green
		}
	}

	return false
}

// ── e2e: a spec that fails to load ─────────────────────────────────────────────────────────────────

var cannotFindRe = regexp.MustCompile(`Cannot find module '[^']*' imported from (.+?)\s*$`)

// classifyPlaywrightLoad says whether a batch failed only because spec files failed to load, and which.
func classifyPlaywrightLoad(specs []string, rep *playwrightSummary) ([]FileFailure, bool) {
	if rep == nil || rep.Loaded || len(rep.Errors) == 0 {
		return nil, false
	}

	c := rep.Counts
	if c.Passed+c.Failed+c.Flaky+c.Skipped+c.DidNotRun > 0 {
		return nil, false
	}

	inBatch := map[string]bool{}
	for _, s := range specs {
		inBatch[s] = true
	}

	var out []FileFailure

	seen := map[string]bool{}

	for _, e := range rep.Errors {
		msg := ansiRe.ReplaceAllString(e.Message, "")
		first, _, _ := strings.Cut(msg, "\n")

		file := ""
		if e.Location != nil && e.Location.File != "" {
			file = filepath.Base(filepath.FromSlash(strings.ReplaceAll(e.Location.File, `\`, "/")))
		} else if m := cannotFindRe.FindStringSubmatch(first); m != nil {
			file = filepath.Base(filepath.FromSlash(strings.ReplaceAll(m[1], `\`, "/")))
		}

		if !inBatch[file] {
			return nil, false
		}

		if !seen[file] {
			seen[file] = true
			out = append(out, FileFailure{File: file, Why: "failed to load: " + clip(strings.TrimSpace(first), 200)})
		}
	}

	return out, true
}

// e2eRerunGroups are the fresh batches a load-failed batch is re-run in: each load-failed spec alone, then the
// batch's other specs (which never ran — Playwright stops the whole run on a load error) together, in name order.
func e2eRerunGroups(b *BatchResult) [][]string {
	load := map[string]bool{}

	var groups [][]string

	for _, f := range b.LoadFailed {
		load[f.File] = true
		groups = append(groups, []string{f.File})
	}

	var rest []string

	for _, s := range b.Specs {
		if !load[s] {
			rest = append(rest, s)
		}
	}

	if len(rest) > 0 {
		groups = append(groups, rest)
	}

	return groups
}

// e2eSeat is where a re-run batch runs: a worker's database, ports, lock and environment — or the single run's.
type e2eSeat struct {
	Worker string
	Env    []string
	Lock   string
	Ports  []int
}

func singleSeat() e2eSeat {
	return e2eSeat{Lock: ".e2e-lock", Ports: []int{e2eAPIPort, e2eUIPort}}
}

func workerSeat(plan *workerPlan, name string) e2eSeat {
	if plan != nil {
		for _, w := range plan.Workers {
			if w.Name == name {
				return e2eSeat{Worker: w.Name, Env: w.env(), Lock: ".e2e-lock." + w.Name, Ports: []int{w.APIPort, w.UIPort}}
			}
		}
	}

	return singleSeat()
}

// batchRunner runs one fresh Playwright batch on a seat (its servers cleaned and Docker checked first).
type batchRunner func(ctx context.Context, b *BatchResult, seat e2eSeat) error

// playwrightBatchRunner is the real batchRunner in frontend, logging into dir.
func playwrightBatchRunner(frontend string, frontends []string, dir string) batchRunner {
	return func(ctx context.Context, b *BatchResult, seat e2eSeat) error {
		foreign := cleanupRun(frontend, seat.Lock, seat.Ports, frontends, true, io.Discard)

		err := preflightE2E(foreign)
		if err != nil {
			return err
		}

		err = runPlaywrightBatch(ctx, frontend, b, "", dir, nil, seat.Env...)

		cleanupRun(frontend, seat.Lock, seat.Ports, frontends, true, io.Discard)

		return err
	}
}

// runE2ERerunGroups runs a load-failed batch's re-run groups ONCE each and returns the fresh batches and one Rerun per
// spec. next numbers the fresh batches (w1-rerun1, …).
func runE2ERerunGroups(ctx context.Context, b *BatchResult, seat e2eSeat, where string, next *int, run batchRunner,
	out io.Writer) ([]*BatchResult, []*Rerun) {
	var batches []*BatchResult

	var reruns []*Rerun

	whyOf := map[string]string{}
	for _, f := range b.LoadFailed {
		whyOf[f.File] = f.Why
	}

	stopper := ""
	if len(b.LoadFailed) > 0 {
		stopper = b.LoadFailed[0].File
	}

	for _, specs := range e2eRerunGroups(b) {
		if ctx.Err() != nil {
			break
		}

		*next++
		rb := &BatchResult{N: *next, Worker: seat.Worker, Specs: specs, RerunOf: b.name(), Cap: b.Cap}

		fmt.Fprintf(out, "→ e2e re-run %s (once, for %s) %s\n", rb.name(), b.name(), strings.Join(specs, " "))

		err := run(ctx, rb, seat)
		batches = append(batches, rb)

		for _, s := range specs {
			r := &Rerun{Part: "e2e", File: s, Where: where, Worker: seat.Worker, Batch: rb.name(), Log: rb.Log,
				Exit: rb.Exit, Secs: rb.Secs, CapHit: rb.CapHit}

			if why, ok := whyOf[s]; ok {
				r.Kind, r.Why = "load", why
			} else {
				r.Kind, r.Why = "never-ran", "the batch "+b.name()+" stopped on "+stopper+"'s load error before any test"
			}

			judgeE2ERerun(r, rb, s, err)
			reruns = append(reruns, r)
			fmt.Fprintf(out, "  %s %s\n", r.Result, s)
		}
	}

	return batches, reruns
}

// judgeE2ERerun reads one spec's result out of its fresh batch.
func judgeE2ERerun(r *Rerun, rb *BatchResult, spec string, err error) {
	var c Counts
	if s := rb.specs[spec]; s != nil {
		c = s.Counts
	}

	r.Passed, r.Failed = c.Passed+c.Flaky, c.Failed

	switch {
	case err != nil:
		r.Result = "✗ could not run: " + err.Error()
	case rb.CapHit:
		r.Result = "✗ CAP HIT — red"
	case rb.passed() && c.Passed+c.Flaky+c.Skipped > 0:
		r.Green = true
		r.Result = "✓ " + c.String()
	default:
		rep, perr := parsePlaywrightJSON(jsonPathOf(rb))
		if perr == nil {
			if load, ok := classifyPlaywrightLoad(rb.Specs, rep); ok {
				for _, f := range load {
					if f.File == spec {
						r.Result = "✗ failed to load again — a second load failure is red"

						return
					}
				}

				r.Result = "✗ never ran: another spec of the re-run failed to load"

				return
			}
		}

		r.Result = fmt.Sprintf("✗ %s (exit %d)", c, rb.Exit)
	}
}

// rerunE2ELoads finds the batches that failed only to LOAD, re-runs each once in fresh batches on the same seat, and
// adds the fresh batches to e. Nothing is re-run when a batch failed a check (or hit its cap) — the run is red anyway.
func rerunE2ELoads(ctx context.Context, e *E2EResult, seatOf func(worker string) e2eSeat, where string, run batchRunner,
	out io.Writer) []*Rerun {
	if e == nil {
		return nil
	}

	var loadFailed []*BatchResult

	for _, b := range e.Batches {
		if b.RerunOf != "" || b.passed() {
			continue
		}

		if b.CapHit || b.Counts.Failed > 0 {
			return nil
		}

		rep, err := parsePlaywrightJSON(jsonPathOf(b))
		if err != nil {
			return nil
		}

		load, ok := classifyPlaywrightLoad(b.Specs, rep)
		if !ok {
			return nil
		}

		b.LoadFailed = load
		loadFailed = append(loadFailed, b)
	}

	var reruns []*Rerun

	next := map[string]int{}

	for _, b := range loadFailed {
		n := next[b.Worker]
		batches, rs := runE2ERerunGroups(ctx, b, seatOf(b.Worker), where, &n, run, out)
		next[b.Worker] = n

		for _, rb := range batches {
			e.Batches = append(e.Batches, rb)
			mergeSpecs(e, rb)
		}

		reruns = append(reruns, rs...)
	}

	return reruns
}

// jsonPathOf is a batch's Playwright JSON report, beside its log.
func jsonPathOf(b *BatchResult) string {
	return strings.TrimSuffix(b.Log, ".log") + ".json"
}

// pwError is one entry of a Playwright JSON report's top-level errors (not part of any test).
type pwError struct {
	Message  string      `json:"message"`
	Location *pwLocation `json:"location,omitempty"`
}

type pwLocation struct {
	File string `json:"file"`
	Line int    `json:"line"`
}
