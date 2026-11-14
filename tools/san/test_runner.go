package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/pdcgo/warehouse_revamp/tools/san/proctree"
)

// Running Playwright, vitest and go test from san — the batching, caps, port cleanup and lock handling
// that the agent's e2e_batches.sh did, ported so every developer gets the same runner.
//
// The e2e has ONE test database and ONE pair of ports (API :8081, UI :5175 — playwright.config.ts),
// and its setup DROPS that database. Two runs at once destroy each other silently (e2e/lock.ts), so
// every entry point here refuses while another run is live, and cleans only what is its own.

const (
	e2eAPIPort  = 8081
	e2eUIPort   = 5175
	batchCap    = 590 * time.Second
	longSpecCap = 1500 * time.Second
	batchSize   = 6
)

// aloneSpecs run in a batch of their own: orders.spec.ts counts every order root can see (an earlier
// spec's order breaks it).
var aloneSpecs = map[string]bool{"orders.spec.ts": true}

// restockFamily is the old restock.spec.ts (62 tests, ~12 min, a third of the suite), split by its describe blocks
// into restock.spec.ts and restock_*.spec.ts (backlog #51) so parallel workers can share it out. In the
// single-database batches (--workers 1, today's fallback) the family still runs as ONE batch of its own, under
// longSpecCap — exactly what the one file did.
func restockFamily(spec string) bool {
	return spec == "restock.spec.ts" || strings.HasPrefix(spec, "restock_") && strings.HasSuffix(spec, ".spec.ts")
}

// planBatches splits the spec files, name-ordered, into batches of size, the alone specs on their own and the
// restock family together on its own.
func planBatches(specs []string, size int) [][]string {
	return planBatchesWith(specs, size, aloneSpecs, restockFamily)
}

// planBatchesWith is planBatches with its own set of specs that run alone, and its own family (nil: none) whose
// members run together in one batch of their own, placed where its first member sorts.
func planBatchesWith(specs []string, size int, alone map[string]bool, family func(string) bool) [][]string {
	sorted := append([]string(nil), specs...)
	sort.Strings(sorted)

	var batches [][]string

	var cur []string

	famAt := -1

	for _, s := range sorted {
		if family != nil && family(s) {
			if famAt < 0 {
				if len(cur) > 0 {
					batches = append(batches, cur)
					cur = nil
				}

				famAt = len(batches)
				batches = append(batches, nil)
			}

			batches[famAt] = append(batches[famAt], s)

			continue
		}

		if alone[s] {
			if len(cur) > 0 {
				batches = append(batches, cur)
			}

			batches = append(batches, []string{s})
			cur = nil

			continue
		}

		cur = append(cur, s)
		if len(cur) >= size {
			batches = append(batches, cur)
			cur = nil
		}
	}

	if len(cur) > 0 {
		batches = append(batches, cur)
	}

	return batches
}

// capFor is a batch's time cap: the restock family's batch outgrows the batch cap (~62 tests, ~12 min).
func capFor(batch []string) time.Duration {
	for _, s := range batch {
		if !restockFamily(s) {
			return batchCap
		}
	}

	if len(batch) > 1 || len(batch) == 1 && batch[0] == "restock.spec.ts" {
		return longSpecCap
	}

	return batchCap
}

// specFiles lists frontend/e2e/*.spec.ts.
func specFiles(frontend string) ([]string, error) {
	entries, err := os.ReadDir(filepath.Join(frontend, "e2e"))
	if err != nil {
		return nil, err
	}

	var specs []string

	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".spec.ts") {
			specs = append(specs, e.Name())
		}
	}

	sort.Strings(specs)

	return specs, nil
}

// ── processes and ports ───────────────────────────────────────────────────────────────────────────

var netstatLineRe = regexp.MustCompile(`^\s*TCP\s+(\S+):(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$`)

// parseNetstat reads `netstat -ano` and returns the pids listening on port.
func parseNetstat(out string, port int) []int {
	seen := map[int]bool{}

	var pids []int

	for _, line := range strings.Split(out, "\n") {
		m := netstatLineRe.FindStringSubmatch(strings.TrimRight(line, "\r"))
		if m == nil || m[2] != strconv.Itoa(port) {
			continue
		}

		pid, err := strconv.Atoi(m[3])
		if err != nil || pid == 0 || seen[pid] {
			continue
		}

		seen[pid] = true
		pids = append(pids, pid)
	}

	return pids
}

// listeners are the pids listening on a TCP port.
func listeners(port int) []int {
	if runtime.GOOS == "windows" {
		out, err := exec.Command("netstat", "-ano", "-p", "TCP").Output()
		if err != nil {
			return nil
		}

		return parseNetstat(string(out), port)
	}

	out, err := exec.Command("lsof", "-ti", "tcp:"+strconv.Itoa(port), "-sTCP:LISTEN").Output()
	if err != nil {
		return nil
	}

	var pids []int

	for _, f := range strings.Fields(string(out)) {
		pid, err := strconv.Atoi(f)
		if err == nil {
			pids = append(pids, pid)
		}
	}

	return pids
}

// cmdlineOf is a process's command line ("" when it cannot be read).
func cmdlineOf(pid int) string {
	if runtime.GOOS == "windows" {
		out, err := exec.Command("wmic", "process", "where", "processid="+strconv.Itoa(pid), "get", "commandline").Output()
		if err == nil && len(strings.TrimSpace(string(out))) > len("CommandLine") {
			return strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(string(out)), "CommandLine"))
		}

		out, err = exec.Command("powershell", "-NoProfile", "-Command",
			fmt.Sprintf("(Get-CimInstance Win32_Process -Filter 'ProcessId=%d').CommandLine", pid)).Output()
		if err != nil {
			return ""
		}

		return strings.TrimSpace(string(out))
	}

	b, err := os.ReadFile(fmt.Sprintf("/proc/%d/cmdline", pid))
	if err == nil {
		return strings.ReplaceAll(string(b), "\x00", " ")
	}

	out, err := exec.Command("ps", "-o", "args=", "-p", strconv.Itoa(pid)).Output()
	if err != nil {
		return ""
	}

	return strings.TrimSpace(string(out))
}

// pidAlive says whether a process with that pid is running.
func pidAlive(pid int) bool {
	if pid <= 0 {
		return false
	}

	if runtime.GOOS == "windows" {
		out, err := exec.Command("tasklist", "/FI", fmt.Sprintf("PID eq %d", pid), "/NH", "/FO", "CSV").Output()
		if err != nil {
			return false
		}

		return strings.Contains(string(out), fmt.Sprintf("\"%d\"", pid))
	}

	return exec.Command("kill", "-0", strconv.Itoa(pid)).Run() == nil
}

// killTree kills a process and everything it started (taskkill /T on Windows).
func killTree(pid int) error {
	if runtime.GOOS == "windows" {
		return exec.Command("taskkill", "/PID", strconv.Itoa(pid), "/T", "/F").Run()
	}

	return exec.Command("kill", "-9", strconv.Itoa(pid)).Run()
}

// e2eLock is frontend/.e2e-lock, the run lock e2e/lock.ts writes ({"pid":…,"startedAt":…}).
type e2eLock struct {
	PID       int    `json:"pid"`
	StartedAt string `json:"startedAt"`
}

func readE2ELock(frontend string) (*e2eLock, error) {
	return readLockFile(filepath.Join(frontend, ".e2e-lock"))
}

// readLockFile reads one run lock — frontend/.e2e-lock, or a parallel worker's .e2e-lock.w1.
func readLockFile(path string) (*e2eLock, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	var l e2eLock

	err = json.Unmarshal(b, &l)
	if err != nil {
		// e2e/lock.ts reads an unreadable lock as a stale one; so does this.
		return &e2eLock{}, nil
	}

	return &l, nil
}

// ownServer says whether a listener's command line is one of THIS checkout's e2e servers: the API
// `go run` builds (app_development) or the vite of a frontend we run from. Anything else on the e2e
// ports — another project's dev server — is never killed.
func ownServer(cmdline string, frontends []string) bool {
	c := strings.ToLower(filepath.ToSlash(cmdline))
	if strings.Contains(c, "hai-tukang") {
		return false
	}

	if strings.Contains(c, "app_development") {
		return true
	}

	for _, f := range frontends {
		if strings.Contains(c, strings.ToLower(filepath.ToSlash(f))) {
			return true
		}
	}

	return false
}

// cleanupE2E clears what a dead run left: its .e2e-lock (killing the pid in it when kill is set) and
// this checkout's servers on :8081/:5175. A foreign listener is left alone and reported.
func cleanupE2E(frontend string, frontends []string, killLockPid bool, out io.Writer) []string {
	return cleanupRun(frontend, ".e2e-lock", []int{e2eAPIPort, e2eUIPort}, frontends, killLockPid, out)
}

// cleanupRun is cleanupE2E for any run: its lock file (in frontend) and its ports — a parallel worker's own.
func cleanupRun(frontend, lockName string, ports []int, frontends []string, killLockPid bool, out io.Writer) []string {
	lock, err := readLockFile(filepath.Join(frontend, lockName))
	if err == nil {
		if killLockPid && lock.PID > 0 && lock.PID != os.Getpid() && pidAlive(lock.PID) {
			fmt.Fprintf(out, "  cleanup: killing the e2e run left in %s (pid %d)\n", filepath.Join(frontend, lockName), lock.PID)
			_ = killTree(lock.PID)
		}

		if lock.PID != os.Getpid() {
			_ = os.Remove(filepath.Join(frontend, lockName))
		}
	}

	var foreign []string

	for _, port := range ports {
		for _, pid := range listeners(port) {
			cmd := cmdlineOf(pid)
			if ownServer(cmd, frontends) {
				fmt.Fprintf(out, "  cleanup: stopping a leftover e2e server on :%d (pid %d)\n", port, pid)
				_ = killTree(pid)

				continue
			}

			foreign = append(foreign, fmt.Sprintf(":%d is held by pid %d (%s)", port, pid, clip(cmd, 120)))
		}
	}

	return foreign
}

func clip(s string, n int) string {
	if len(s) <= n {
		return s
	}

	return s[:n] + "…"
}

// preflightE2E checks what every e2e run needs before it touches anything: Docker with a healthy
// Postgres, and the two ports free of anything that is not ours.
func preflightE2E(foreign []string) error {
	if len(foreign) > 0 {
		return fmt.Errorf("STOP: %s — another program holds an e2e port; it is never killed. Stop it, or run "+
			"Playwright with a temporary config on a free port", strings.Join(foreign, "; "))
	}

	err := exec.Command("docker", "info").Run()
	if err != nil {
		return errors.New("STOP: Docker is not running — start Docker Desktop, wait for warehouse_revamp_postgres to " +
			"be healthy, then go run ./tools/san dev setup --no-docker")
	}

	out, err := exec.Command("docker", "inspect", "-f", "{{.State.Health.Status}}", "warehouse_revamp_postgres").Output()
	if err != nil || strings.TrimSpace(string(out)) != "healthy" {
		return errors.New("STOP: warehouse_revamp_postgres is not healthy (docker compose --profile pubsub up -d --wait)")
	}

	return nil
}

// ── the full-run lock ─────────────────────────────────────────────────────────────────────────────

type fullRunLock struct {
	PID     int       `json:"pid"`
	Started time.Time `json:"started"`
	Copy    string    `json:"copy"`
}

func fullLockPath(root string) string {
	return filepath.Join(reportDir(root), ".full_run.lock")
}

// liveFullRun is the full run holding the lock, if one is alive.
func liveFullRun(root string) *fullRunLock {
	b, err := os.ReadFile(fullLockPath(root))
	if err != nil {
		return nil
	}

	var l fullRunLock

	err = json.Unmarshal(b, &l)
	if err != nil || l.PID == os.Getpid() || !pidAlive(l.PID) {
		return nil
	}

	return &l
}

// refuseIfBusy stops a run while another e2e run is live — a full run on a frozen copy (its servers
// hold the same ports and database) or a Playwright run in this tree.
func refuseIfBusy(root string) error {
	l := liveFullRun(root)
	if l != nil {
		return fmt.Errorf("a full run is live (pid %d, started %s, copy %s) — it holds the e2e ports and the test "+
			"database; wait for it (go run ./tools/san test report)", l.PID, l.Started.Format("15:04"), l.Copy)
	}

	lock, err := readE2ELock(filepath.Join(root, "frontend"))
	if err == nil && lock.PID > 0 && lock.PID != os.Getpid() && pidAlive(lock.PID) {
		return fmt.Errorf("another e2e run is live (frontend/.e2e-lock, pid %d, started %s) — two runs reset one "+
			"database under each other; wait for it", lock.PID, lock.StartedAt)
	}

	return nil
}

// ── running a step ────────────────────────────────────────────────────────────────────────────────

// stepResult is one child run to its end or its cap.
type stepResult struct {
	Exit   int
	Secs   int
	CapHit bool
}

// runCapped runs argv in dir with its output in logPath (and on echo, if set), killed WITH its whole
// tree at the cap — Playwright's web servers are grandchildren that would otherwise keep the ports.
func runCapped(ctx context.Context, dir string, argv []string, env []string, logPath string, limit time.Duration,
	echo io.Writer) (stepResult, error) {
	err := os.MkdirAll(filepath.Dir(logPath), 0o755)
	if err != nil {
		return stepResult{}, err
	}

	logFile, err := os.Create(logPath)
	if err != nil {
		return stepResult{}, err
	}

	defer func() { _ = logFile.Close() }()

	var w io.Writer = logFile
	if echo != nil {
		w = io.MultiWriter(logFile, echo)
	}

	capped, cancel := context.WithTimeout(ctx, limit)
	defer cancel()

	cmd := exec.CommandContext(capped, argv[0], argv[1:]...)
	cmd.Dir = dir
	cmd.Stdout = w
	cmd.Stderr = w
	cmd.Env = append(os.Environ(), env...)

	proctree.Configure(cmd)
	cmd.Cancel = func() error { return proctree.KillTree(cmd) }
	cmd.WaitDelay = 10 * time.Second

	start := time.Now()
	err = cmd.Run()
	res := stepResult{Secs: int(time.Since(start).Seconds())}

	if errors.Is(capped.Err(), context.DeadlineExceeded) && ctx.Err() == nil {
		res.CapHit = true
		res.Exit = 124
		fmt.Fprintf(w, "\nCAP HIT after %s — a timeout, not a failure\n", limit)

		return res, nil
	}

	if ctx.Err() != nil {
		return res, ctx.Err()
	}

	var exitErr *exec.ExitError

	switch {
	case err == nil:
	case errors.As(err, &exitErr):
		res.Exit = exitErr.ExitCode()
	default:
		return res, err
	}

	return res, nil
}

// playwrightArgv runs the Playwright CLI with node directly — not npx.cmd, which goes through
// cmd.exe, where a grep's '|' would be read as a pipe.
func playwrightArgv(frontend string, args ...string) []string {
	cli := filepath.Join(frontend, "node_modules", "@playwright", "test", "cli.js")

	return append([]string{"node", cli, "test"}, args...)
}

// runPlaywrightBatch runs one batch with a line reporter for the log and a JSON reporter for the
// per-spec record. A parallel worker's batch (b.Worker set) gets the worker's environment (extraEnv) and its own
// file names (w1-b2.log); its cap is the batch's own (b.Cap) when set.
func runPlaywrightBatch(ctx context.Context, frontend string, b *BatchResult, grep string, dir string,
	echo io.Writer, extraEnv ...string) error {
	name := fmt.Sprintf("b%d", b.N)
	if b.Worker != "" {
		name = b.Worker + "-" + name
	}

	jsonPath := filepath.Join(dir, name+".json")
	b.Log = filepath.Join(dir, name+".log")

	args := append([]string{}, b.Specs...)
	if grep != "" {
		args = append(args, "--grep", grep)
	}

	args = append(args, "--reporter=line,json")

	env := append([]string{"PLAYWRIGHT_JSON_OUTPUT_FILE=" + jsonPath, "PLAYWRIGHT_JSON_OUTPUT_NAME=" + jsonPath}, extraEnv...)

	if echo != nil {
		echo = &progressFilter{out: echo}
	}

	limit := capFor(b.Specs)
	if b.Cap > 0 {
		limit = b.Cap
	}

	res, err := runCapped(ctx, frontend, playwrightArgv(frontend, args...), env, b.Log, limit, echo)
	if err != nil {
		return err
	}

	b.Exit = res.Exit
	b.Secs = res.Secs
	b.CapHit = res.CapHit

	rep, err := parsePlaywrightJSON(jsonPath)
	if err == nil {
		b.Counts = rep.Counts
		b.Failures = rep.Failures
		b.specs = rep.Specs

		return nil
	}

	// No JSON (a cap hit kills the reporter before it writes): read the counts from the log.
	log, _ := os.ReadFile(b.Log)
	b.Counts = countsFromLine(string(log))

	return nil
}

// progressFilter passes on only the lines a person follows a run by — the line reporter's progress,
// its totals and failures — and drops the web servers' logs and the setup's topic list (all in the log).
type progressFilter struct {
	out io.Writer
	buf []byte
}

var progressLineRe = regexp.MustCompile(`^\s*(\[\d+/\d+\]|\d+\) |\d+ (passed|failed|skipped|flaky|did not run)|Error:|CAP HIT)`)

func (f *progressFilter) Write(p []byte) (int, error) {
	f.buf = append(f.buf, p...)

	for {
		i := strings.IndexAny(string(f.buf), "\r\n")
		if i < 0 {
			break
		}

		line := string(f.buf[:i])
		f.buf = f.buf[i+1:]

		if progressLineRe.MatchString(line) {
			_, err := fmt.Fprintln(f.out, line)
			if err != nil {
				return 0, err
			}
		}
	}

	return len(p), nil
}

// ── reading Playwright's JSON report ──────────────────────────────────────────────────────────────

type pwReport struct {
	Suites []pwSuite `json:"suites"`
}

type pwSuite struct {
	Title  string    `json:"title"`
	File   string    `json:"file"`
	Specs  []pwSpec  `json:"specs"`
	Suites []pwSuite `json:"suites"`
}

type pwSpec struct {
	Title string   `json:"title"`
	File  string   `json:"file"`
	Tests []pwTest `json:"tests"`
}

type pwTest struct {
	Status  string     `json:"status"` // expected, unexpected, flaky, skipped
	Results []pwResult `json:"results"`
}

type pwResult struct {
	Status   string `json:"status"`
	Duration int    `json:"duration"` // ms
}

// playwrightSummary is what one JSON report says.
type playwrightSummary struct {
	Counts   Counts
	Specs    map[string]*SpecResult
	Failures []string
}

func parsePlaywrightJSON(path string) (*playwrightSummary, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	var rep pwReport

	err = json.Unmarshal(b, &rep)
	if err != nil {
		return nil, err
	}

	sum := &playwrightSummary{Specs: map[string]*SpecResult{}}

	var walk func(s pwSuite, file string, titles []string)

	walk = func(s pwSuite, file string, titles []string) {
		if s.File != "" && file == "" {
			file = filepath.Base(filepath.FromSlash(s.File))
		} else if s.Title != "" && s.Title != file && file != "" {
			titles = append(titles, s.Title)
		}

		for _, sp := range s.Specs {
			f := file
			if sp.File != "" {
				f = filepath.Base(filepath.FromSlash(sp.File))
			}

			spec := sum.Specs[f]
			if spec == nil {
				spec = &SpecResult{}
				sum.Specs[f] = spec
			}

			for _, t := range sp.Tests {
				var c Counts

				switch t.Status {
				case "expected":
					c.Passed = 1
				case "unexpected":
					c.Failed = 1
					sum.Failures = append(sum.Failures, strings.Join(append(append([]string{f}, titles...), sp.Title), " › "))
				case "flaky":
					c.Flaky = 1
				case "skipped":
					if len(t.Results) == 0 || t.Results[0].Status == "" {
						c.DidNotRun = 1
					} else {
						c.Skipped = 1
					}
				}

				spec.Counts.add(c)
				sum.Counts.add(c)

				for _, r := range t.Results {
					spec.Secs += float64(r.Duration) / 1000
				}
			}
		}

		for _, child := range s.Suites {
			walk(child, file, titles)
		}
	}

	for _, s := range rep.Suites {
		walk(s, "", nil)
	}

	return sum, nil
}

var lineCountRe = regexp.MustCompile(`(?m)^\s*(\d+) (passed|failed|skipped|flaky|did not run)`)

// countsFromLine reads the totals the line reporter prints at the end.
func countsFromLine(log string) Counts {
	var c Counts

	for _, m := range lineCountRe.FindAllStringSubmatch(log, -1) {
		n, _ := strconv.Atoi(m[1])

		switch m[2] {
		case "passed":
			c.Passed = n
		case "failed":
			c.Failed = n
		case "skipped":
			c.Skipped = n
		case "flaky":
			c.Flaky = n
		case "did not run":
			c.DidNotRun = n
		}
	}

	return c
}

// ── reading go test and vitest output ─────────────────────────────────────────────────────────────

var (
	goOkRe      = regexp.MustCompile(`(?m)^ok\s+\S+`)
	goFailPkgRe = regexp.MustCompile(`(?m)^FAIL\s+(\S+)`)
	goFailRe    = regexp.MustCompile(`(?m)^\s*--- FAIL: (\S+)`)
	goBuildRe   = regexp.MustCompile(`(?m)^# \S+|\[build failed\]|\[setup failed\]`)
)

// goTestCounts reads `go test` output: packages ok / failed, and the failing tests.
func goTestCounts(log string) (passed, failed int, failures []string) {
	passed = len(goOkRe.FindAllString(log, -1))

	for _, m := range goFailPkgRe.FindAllStringSubmatch(log, -1) {
		failed++
		failures = append(failures, "package "+m[1])
	}

	for _, m := range goFailRe.FindAllStringSubmatch(log, -1) {
		failures = append(failures, m[1])
	}

	if failed == 0 && goBuildRe.MatchString(log) {
		failures = append(failures, "a build failed — read the log")
	}

	if len(failures) > 50 {
		failures = append(failures[:50], fmt.Sprintf("… %d more", len(failures)-50))
	}

	return passed, failed, failures
}

var (
	vitestFilesRe = regexp.MustCompile(`(?m)Test Files\s+(?:(\d+) failed\s*\|\s*)?(?:(\d+) passed)?`)
	vitestTestsRe = regexp.MustCompile(`(?m)^\s*Tests\s+(?:(\d+) failed\s*\|\s*)?(?:(\d+) passed)?`)
	vitestFailRe  = regexp.MustCompile(`(?m)^\s*(?:FAIL|×)\s+(.+)$`)
)

// vitestCounts reads vitest's summary: tests passed / failed, and the failing files.
func vitestCounts(log string) (passed, failed int, failures []string) {
	m := vitestTestsRe.FindStringSubmatch(log)
	if m != nil {
		failed, _ = strconv.Atoi(m[1])
		passed, _ = strconv.Atoi(m[2])
	}

	if f := vitestFilesRe.FindStringSubmatch(log); f != nil && failed == 0 {
		n, _ := strconv.Atoi(f[1])
		failed = n
	}

	seen := map[string]bool{}

	for _, fm := range vitestFailRe.FindAllStringSubmatch(log, -1) {
		line := strings.TrimSpace(fm[1])
		if !seen[line] {
			seen[line] = true
			failures = append(failures, line)
		}
	}

	if len(failures) > 50 {
		failures = append(failures[:50], fmt.Sprintf("… %d more", len(failures)-50))
	}

	return passed, failed, failures
}

// copyDirFiles copies every regular file under src into dst (a failure's traces and screenshots,
// which the next Playwright run would delete).
func copyDirFiles(src, dst string) error {
	_, err := os.Stat(src)
	if errors.Is(err, fs.ErrNotExist) {
		return nil
	}

	return filepath.WalkDir(src, func(p string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}

		rel, err := filepath.Rel(src, p)
		if err != nil {
			return err
		}

		target := filepath.Join(dst, rel)

		if d.IsDir() {
			return os.MkdirAll(target, 0o755)
		}

		if !d.Type().IsRegular() {
			return nil
		}

		return copyFile(p, target)
	})
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}

	defer func() { _ = in.Close() }()

	err = os.MkdirAll(filepath.Dir(dst), 0o755)
	if err != nil {
		return err
	}

	out, err := os.Create(dst)
	if err != nil {
		return err
	}

	_, err = io.Copy(out, bufio.NewReader(in))
	if err != nil {
		_ = out.Close()

		return err
	}

	return out.Close()
}
