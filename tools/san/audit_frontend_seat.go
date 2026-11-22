package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/urfave/cli/v3"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/event_source"
	"github.com/pdcgo/warehouse_revamp/tools/san/proctree"
)

// THE FRONTEND AUDIT'S OWN SEAT (backlog #119, docs/development_lifecycle_decision.md#frontend-speed-is-measured-by-a-dev-tool).
//
// `san audit frontend` opens screens in a real browser against a real API and database — but never the ones anybody
// else uses: not the tester's worker w1 (warehouse_test_w1, warehouse_test_tpl, :8181+/:5181+, .full_run.lock), not the
// dev bot's Go DB tests and e2e repros (warehouse_test, :8081/:5175, w9), not the owner's dev stack (postgres,
// :8080/:5174). Its own of everything:
//
//	database   warehouse_test_audit, CLONED per run from warehouse_test_audit_tpl (`san db reset-test --template`)
//	template   KEPT between runs and rebuilt only when its fingerprint moves — every service's db_migrations, the
//	           audit seed's Go file and its fixtures — so a run usually pays about a second for its database
//	ports      the first free pair from :8251/:5251 (outside the workers' 40-port scan); a port another program holds
//	           is skipped, never killed
//	events     the Pub/Sub emulator project warehouse-audit, its push subscriptions pointed at the audit's own API
//	API        e2e_report/frontend_audit/bin/app_development_audit.exe — the name keeps ownServer recognising it
//	UI         a PRODUCTION build (`vite build`, cached per tree) served by `vite preview` — the dev server's
//	           StrictMode runs every effect twice, so it would count fetches production never sends
//	lock       e2e_report/.frontend_audit.lock — a second audit in ANY checkout of the repo refuses (the template is
//	           one database for the machine); a dead lock's servers are stopped, only on the ports it recorded
//
// Beside a live full run (any checkout's .full_run.lock) it does NOT refuse — it shares nothing with it — but it runs
// counts-only: one warm load per screen, its times recorded as noisy and never judged.

const (
	auditDB         = testDBName + "_audit"
	auditTemplateDB = testDBName + "_audit_tpl"
	auditAPIPortMin = 8251
	auditUIPortMin  = 5251
	auditPortSpan   = 20
	auditProject    = "warehouse-audit"
	auditLockName   = ".frontend_audit.lock"
	auditFolder     = "frontend_audit"

	// auditRootPassword is the template's root password (`seed root`), its own — never the e2e's.
	auditRootPassword = "audit-root-pass-1234"
	// auditUserPassword is every seeded audit user's password.
	auditUserPassword = "audit-user-pass-1234"
)

// auditSeat is where one audit runs.
type auditSeat struct {
	DB       string   `json:"db"`
	Template string   `json:"template"`
	APIPort  int      `json:"api_port"`
	UIPort   int      `json:"ui_port"`
	Project  string   `json:"pubsub_project"`
	Skipped  []string `json:"skipped,omitempty"`
}

func (s *auditSeat) apiURL() string {
	return "http://localhost:" + strconv.Itoa(s.APIPort)
}

func (s *auditSeat) uiURL() string {
	return "http://localhost:" + strconv.Itoa(s.UIPort)
}

// pickAuditSeat is the audit's database, events project and the first port pair from :8251/:5251 that busy leaves free.
func pickAuditSeat(busy portBusy) (*auditSeat, error) {
	apis, uis, skipped, err := pickPortPairs(1, auditAPIPortMin, auditUIPortMin, auditPortSpan, busy)
	if err != nil {
		return nil, err
	}

	return &auditSeat{
		DB:       auditDB,
		Template: auditTemplateDB,
		APIPort:  apis[0],
		UIPort:   uis[0],
		Project:  auditProject,
		Skipped:  skipped,
	}, nil
}

// auditDir is e2e_report/frontend_audit (gitignored with the rest of e2e_report/).
func auditDir(root string) string {
	return filepath.Join(reportDir(root), auditFolder)
}

// ── the lock ──────────────────────────────────────────────────────────────────────────────────────

// auditLock is e2e_report/.frontend_audit.lock: which audit is live, and the ports its servers hold.
type auditLock struct {
	PID     int       `json:"pid"`
	Started time.Time `json:"started"`
	Root    string    `json:"root"`
	APIPort int       `json:"api_port"`
	UIPort  int       `json:"ui_port"`
}

func auditLockPath(root string) string {
	return filepath.Join(reportDir(root), auditLockName)
}

// readAuditLock is the lock in the checkout at root (nil: none, or unreadable — read as stale).
func readAuditLock(root string) *auditLock {
	b, err := os.ReadFile(auditLockPath(root))
	if err != nil {
		return nil
	}

	var l auditLock

	err = json.Unmarshal(b, &l)
	if err != nil {
		return &auditLock{}
	}

	return &l
}

// auditRefusal says why an audit may not start: a lock held by a live process other than self, in this checkout or
// another (found maps a checkout to its lock). Dead locks never refuse — the caller cleans this checkout's.
func auditRefusal(found map[string]*auditLock, self int, alive func(int) bool) error {
	roots := make([]string, 0, len(found))
	for r := range found {
		roots = append(roots, r)
	}

	sort.Strings(roots)

	for _, r := range roots {
		l := found[r]
		if l == nil || l.PID <= 0 || l.PID == self || !alive(l.PID) {
			continue
		}

		return fmt.Errorf("a frontend audit is live in %s (pid %d, started %s, API :%d, UI :%d) — the template %s "+
			"is one database for the machine; wait for it", r, l.PID, l.Started.Format("15:04"), l.APIPort, l.UIPort,
			auditTemplateDB)
	}

	return nil
}

// auditLocks reads the audit lock of this checkout and of every other worktree of the repo.
func auditLocks(root string) map[string]*auditLock {
	found := map[string]*auditLock{root: readAuditLock(root)}

	for _, other := range otherCheckouts(root) {
		found[other] = readAuditLock(other)
	}

	return found
}

// fullRunBeside names a live full (or --isolated) run in any checkout — the audit then runs counts-only.
func fullRunBeside(root string) string {
	l := liveFullRun(root)
	if l != nil {
		return l.what() + " in this checkout"
	}

	for _, other := range otherCheckouts(root) {
		l = liveFullRun(other)
		if l != nil {
			return l.what() + " in " + other
		}
	}

	return ""
}

// takeAuditLock refuses while another audit is live, stops what a dead one here left on its recorded ports (only
// ownServer's — app_development, or this frontend's vite), and writes the lock for this run.
func takeAuditLock(root string, seat *auditSeat, out io.Writer) (func(), error) {
	err := auditRefusal(auditLocks(root), os.Getpid(), pidAlive)
	if err != nil {
		return nil, err
	}

	frontends := []string{filepath.Join(root, "frontend")}

	dead := readAuditLock(root)
	if dead != nil {
		ports := []int{}
		if dead.APIPort > 0 {
			ports = append(ports, dead.APIPort, dead.UIPort)
		}

		cleanupRun(reportDir(root), auditLockName, ports, frontends, false, out)
	}

	err = writeJSON(auditLockPath(root), auditLock{PID: os.Getpid(), Started: time.Now(), Root: root,
		APIPort: seat.APIPort, UIPort: seat.UIPort})
	if err != nil {
		return nil, err
	}

	return func() { _ = os.Remove(auditLockPath(root)) }, nil
}

// ── the template's fingerprint ────────────────────────────────────────────────────────────────────

// auditTemplateInputs are the files the template is made from: every service's migrations, the seed's Go files
// (audit_frontend_seed*.go — P1's ground and P4's daily one, audit_frontend_seed_daily.go; never a _test.go) and the
// audit's fixtures (its regions). A change to any of them rebuilds the template; nothing else does.
func auditTemplateInputs(root string) ([]string, error) {
	var files []string

	services, err := filepath.Glob(filepath.Join(root, "backend", "services", "*", "db_migrations"))
	if err != nil {
		return nil, err
	}

	dirs := append(services, filepath.Join(root, "frontend", "scripts", "speed-audit", "fixtures"))

	for _, dir := range dirs {
		err = filepath.WalkDir(dir, func(path string, d fs.DirEntry, err error) error {
			if err != nil {
				if errors.Is(err, fs.ErrNotExist) {
					return nil
				}

				return err
			}

			if !d.IsDir() {
				files = append(files, path)
			}

			return nil
		})
		if err != nil {
			return nil, err
		}
	}

	seeds, err := filepath.Glob(filepath.Join(root, "tools", "san", "audit_frontend_seed*.go"))
	if err != nil {
		return nil, err
	}

	for _, f := range seeds {
		if !strings.HasSuffix(f, "_test.go") {
			files = append(files, f)
		}
	}

	return files, nil
}

// hashFiles is a short hash of files (their paths relative to root, and their content with CRLF read as LF — the
// checkout's line endings are not a change), sorted, plus any extra strings.
func hashFiles(root string, files []string, extra ...string) (string, error) {
	rels := make([]string, 0, len(files))

	for _, f := range files {
		rel, err := filepath.Rel(root, f)
		if err != nil {
			return "", err
		}

		rels = append(rels, filepath.ToSlash(rel))
	}

	sort.Strings(rels)

	h := sha256.New()

	for _, rel := range rels {
		b, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(rel)))
		if err != nil && !errors.Is(err, fs.ErrNotExist) {
			return "", err
		}

		h.Write([]byte(rel))
		h.Write([]byte{0})
		h.Write([]byte(strings.ReplaceAll(string(b), "\r\n", "\n")))
		h.Write([]byte{0})
	}

	for _, e := range extra {
		h.Write([]byte(e))
		h.Write([]byte{0})
	}

	return hex.EncodeToString(h.Sum(nil))[:16], nil
}

// auditTemplateFingerprint is the hash of auditTemplateInputs.
func auditTemplateFingerprint(root string) (string, error) {
	files, err := auditTemplateInputs(root)
	if err != nil {
		return "", err
	}

	return hashFiles(root, files)
}

// auditTemplateState is e2e_report/frontend_audit/template.json — the kept template's fingerprint and what its seed
// made (the ids every screen's address is built from: read back from the seed's own answers, never hard-coded).
type auditTemplateState struct {
	Fingerprint string         `json:"fingerprint"`
	Built       time.Time      `json:"built"`
	Secs        float64        `json:"secs"`
	SeedSecs    float64        `json:"seed_secs"`
	IDs         *auditSeedIDs  `json:"ids"`
	Counts      map[string]int `json:"counts"`
}

func auditTemplateStatePath(root string) string {
	return filepath.Join(auditDir(root), "template.json")
}

func readAuditTemplateState(root string) *auditTemplateState {
	b, err := os.ReadFile(auditTemplateStatePath(root))
	if err != nil {
		return nil
	}

	var s auditTemplateState

	err = json.Unmarshal(b, &s)
	if err != nil {
		return nil
	}

	return &s
}

// testDBExists says whether a database of the test family is there.
func testDBExists(ctx context.Context, name string) (bool, error) {
	db, err := adminConn(ctx, "")
	if err != nil {
		return false, err
	}

	defer db.Close()

	var n int

	err = db.QueryRowContext(ctx, `SELECT count(*) FROM pg_database WHERE datname = $1`, name).Scan(&n)
	if err != nil {
		return false, err
	}

	return n > 0, nil
}

// ── san's own commands, in process ───────────────────────────────────────────────────────────────

// runSanInProcess runs `san <argv…>` inside this process — the very commands (db, migrate, region, seed) a person
// types, with their own checks, and no second `go run` compile. Their log lines go to logw.
func runSanInProcess(ctx context.Context, logw io.Writer, argv ...string) error {
	cmd := &cli.Command{
		Name:   "san",
		Writer: logw,
		Flags: []cli.Flag{
			&cli.StringFlag{Name: "dsn"},
		},
		Commands: []*cli.Command{dbCommand(), migrateCommand(), regionCommand(), seedCommand()},
	}

	prev := log.Writer()
	log.SetOutput(logw)

	defer log.SetOutput(prev)

	return cmd.Run(ctx, append([]string{"san"}, argv...))
}

// auditTemplateSteps are the template's commands before its seed: an empty database, every service's migrations in
// the contract order, the audit's own five-row region chain, root's own password, the category taxonomy.
func auditTemplateSteps(root string) [][]string {
	dsn := dsnWithDB(localDSN(), auditTemplateDB)
	regions := filepath.Join(root, "frontend", "scripts", "speed-audit", "fixtures", "regions.csv")

	return [][]string{
		{"db", "reset-test", "--name", auditTemplateDB},
		{"migrate", "up-all", "--dsn", dsn},
		{"region", "load-seed", "--file", regions, "--dsn", dsn},
		{"seed", "root", "--password", auditRootPassword, "--dsn", dsn},
		{"seed", "categories", "--dsn", dsn},
	}
}

// cloneAuditDB makes this run's database a fresh copy of the template (about a second).
func cloneAuditDB(ctx context.Context, logw io.Writer) error {
	return runSanInProcess(ctx, logw, "db", "reset-test", "--name", auditDB, "--template", auditTemplateDB)
}

// ── servers ───────────────────────────────────────────────────────────────────────────────────────

// auditServer is one server the audit started — stopped by its own pid tree, never by port.
type auditServer struct {
	Name string
	cmd  *exec.Cmd
	log  *os.File
	done chan struct{}
}

func (s *auditServer) pid() int {
	if s == nil || s.cmd == nil || s.cmd.Process == nil {
		return 0
	}

	return s.cmd.Process.Pid
}

// stop kills the server's process tree (its own pid, recorded when it started) and waits for it.
func (s *auditServer) stop() {
	if s == nil || s.cmd == nil || s.cmd.Process == nil {
		return
	}

	select {
	case <-s.done:
	default:
		_ = proctree.KillTree(s.cmd)

		select {
		case <-s.done:
		case <-time.After(15 * time.Second):
		}
	}

	_ = s.log.Close()
	s.cmd = nil
}

// startAuditServer starts argv in dir with its output in logPath, then waits for health to answer 200 (or the
// process to die, or the limit).
func startAuditServer(ctx context.Context, name, dir string, argv, env []string, logPath, health string,
	limit time.Duration) (*auditServer, error) {
	err := os.MkdirAll(filepath.Dir(logPath), 0o755)
	if err != nil {
		return nil, err
	}

	logFile, err := os.Create(logPath)
	if err != nil {
		return nil, err
	}

	cmd := exec.Command(argv[0], argv[1:]...)
	cmd.Dir = dir
	cmd.Stdout = logFile
	cmd.Stderr = logFile
	cmd.Env = append(os.Environ(), env...)

	proctree.Configure(cmd)

	err = cmd.Start()
	if err != nil {
		_ = logFile.Close()

		return nil, fmt.Errorf("starting the %s: %w", name, err)
	}

	s := &auditServer{Name: name, cmd: cmd, log: logFile, done: make(chan struct{})}

	go func() {
		_ = cmd.Wait()
		close(s.done)
	}()

	deadline := time.Now().Add(limit)
	client := &http.Client{Timeout: 2 * time.Second}

	for {
		if ctx.Err() != nil {
			s.stop()

			return nil, ctx.Err()
		}

		select {
		case <-s.done:
			return nil, fmt.Errorf("the %s exited before it answered %s — %s", name, health, filepath.ToSlash(logPath))
		default:
		}

		res, err := client.Get(health)
		if err == nil {
			_ = res.Body.Close()

			if res.StatusCode == http.StatusOK {
				return s, nil
			}
		}

		if time.Now().After(deadline) {
			s.stop()

			return nil, fmt.Errorf("the %s did not answer %s within %s — %s", name, health, limit,
				filepath.ToSlash(logPath))
		}

		time.Sleep(300 * time.Millisecond)
	}
}

// auditAPIBinary is where the audit's API is built — the name carries app_development, so ownServer knows it.
func auditAPIBinary(root string) string {
	name := "app_development_audit"
	if os.PathSeparator == '\\' {
		name += ".exe"
	}

	return filepath.Join(auditDir(root), "bin", name)
}

// buildAuditAPI compiles backend/cmd/app_development into auditAPIBinary (the Go cache makes a repeat quick).
func buildAuditAPI(ctx context.Context, root, dir string) (stepResult, error) {
	argv := []string{"go", "build", "-o", auditAPIBinary(root), "./backend/cmd/app_development"}

	res, err := runCapped(ctx, root, argv, nil, filepath.Join(dir, "api-build.log"), 10*time.Minute, nil)
	if err != nil {
		return res, err
	}

	if res.Exit != 0 || res.CapHit {
		return res, fmt.Errorf("building the API failed (exit %d) — %s", res.Exit,
			filepath.ToSlash(filepath.Join(dir, "api-build.log")))
	}

	return res, nil
}

// startAuditAPI serves database db on the seat's API port — the environment the e2e's web server gives its API
// (playwright.config.ts), pointed at the audit's own database, origin and events project.
func startAuditAPI(ctx context.Context, root string, seat *auditSeat, db, logPath string) (*auditServer, error) {
	api := seat.apiURL()
	env := []string{
		"DATABASE_URL=" + dsnWithDB(localDSN(), db),
		"ADDR=localhost:" + strconv.Itoa(seat.APIPort),
		"PUBSUB_PROJECT=" + seat.Project,
		"ALLOWED_ORIGINS=" + seat.uiURL(),
		"INTERNAL_BASE_URL=" + api,
		"DOCUMENT_BASE_URL=" + api + "/local-storage",
		"DOCUMENT_STORAGE_DIR=" + filepath.Join(filepath.Dir(logPath), "documents"),
		"GENERATED_FILE_SWEEP_EVERY=0",
		"REDIS_ADDR=",
	}

	return startAuditServer(ctx, "API", filepath.Join(root, "backend"), []string{auditAPIBinary(root)}, env, logPath,
		api+"/healthz", 2*time.Minute)
}

// ensureAuditEvents makes the audit project's topics and push subscriptions (to the seat's API) exist — what
// `san pubsub ensure --project warehouse-audit --emulator --push-base-url …` does. The emulator keeps them in memory,
// so every run ensures them.
func ensureAuditEvents(ctx context.Context, seat *auditSeat, out io.Writer) error {
	client, err := event_source.NewPubsubEmulator(ctx, seat.Project)
	if err != nil {
		return err
	}

	defer func() { _ = client.Close() }()

	return ensureEvents(ctx, out, client, eventSetup{
		project:     seat.Project,
		pushBaseURL: "http://host.docker.internal:" + strconv.Itoa(seat.APIPort),
	})
}

// ── the production build ──────────────────────────────────────────────────────────────────────────

// auditBuildInputs are what the production build is made from: frontend/src (stories and unit tests left out — they
// are not in the bundle), index.html, the vite configs and the lockfile.
func auditBuildInputs(root string) ([]string, error) {
	frontend := filepath.Join(root, "frontend")

	files := []string{
		filepath.Join(frontend, "index.html"),
		filepath.Join(frontend, "vite.config.ts"),
		filepath.Join(frontend, "package-lock.json"),
		filepath.Join(frontend, "scripts", "speed-audit", "vite.audit.config.mjs"),
	}

	err := filepath.WalkDir(filepath.Join(frontend, "src"), func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}

		name := d.Name()
		if d.IsDir() || strings.Contains(name, ".stories.") || strings.Contains(name, ".test.") {
			return nil
		}

		files = append(files, path)

		return nil
	})
	if err != nil {
		return nil, err
	}

	return files, nil
}

// auditBuildKey is the build cache's key: the inputs and the API URL baked into the bundle (VITE_API_URL).
func auditBuildKey(root, apiURL string) (string, error) {
	files, err := auditBuildInputs(root)
	if err != nil {
		return "", err
	}

	return hashFiles(root, files, "VITE_API_URL="+apiURL)
}

// auditBuild is the production build a run serves.
type auditBuild struct {
	Key    string  `json:"key"`
	Dir    string  `json:"dir"`
	Cached bool    `json:"cached"`
	Secs   float64 `json:"secs"`
}

// ensureAuditBuild returns the cached build for this tree and API URL, or builds it (`vite build` with the audit's
// config — no tsc: Level 1 already typechecks) into a temporary folder renamed into place only when it succeeds.
// The newest three builds are kept.
func ensureAuditBuild(ctx context.Context, root, apiURL, dir string, out io.Writer) (*auditBuild, error) {
	key, err := auditBuildKey(root, apiURL)
	if err != nil {
		return nil, err
	}

	builds := filepath.Join(auditDir(root), "build")
	target := filepath.Join(builds, key)

	_, err = os.Stat(filepath.Join(target, "index.html"))
	if err == nil {
		now := time.Now()
		_ = os.Chtimes(target, now, now)

		return &auditBuild{Key: key, Dir: target, Cached: true}, nil
	}

	frontend := filepath.Join(root, "frontend")
	tmp := target + ".tmp"
	_ = os.RemoveAll(tmp)

	fmt.Fprintf(out, "→ production build %s (vite build, VITE_API_URL=%s)\n", key, apiURL)

	argv := []string{"node", filepath.Join(frontend, "node_modules", "vite", "bin", "vite.js"), "build", "--config",
		filepath.Join(frontend, "scripts", "speed-audit", "vite.audit.config.mjs"), "--outDir", tmp, "--emptyOutDir"}

	start := time.Now()

	res, err := runCapped(ctx, frontend, argv, []string{"VITE_API_URL=" + apiURL}, filepath.Join(dir, "vite-build.log"),
		10*time.Minute, nil)
	if err != nil {
		return nil, err
	}

	if res.Exit != 0 || res.CapHit {
		return nil, fmt.Errorf("the production build failed (exit %d) — %s", res.Exit,
			filepath.ToSlash(filepath.Join(dir, "vite-build.log")))
	}

	err = os.Rename(tmp, target)
	if err != nil {
		return nil, err
	}

	pruneAuditBuilds(builds, 3)

	return &auditBuild{Key: key, Dir: target, Secs: time.Since(start).Seconds()}, nil
}

// pruneAuditBuilds keeps the newest keep build folders.
func pruneAuditBuilds(builds string, keep int) {
	entries, err := os.ReadDir(builds)
	if err != nil {
		return
	}

	type built struct {
		path string
		mod  time.Time
	}

	var all []built

	for _, e := range entries {
		info, err := e.Info()
		if err != nil || !e.IsDir() {
			continue
		}

		all = append(all, built{filepath.Join(builds, e.Name()), info.ModTime()})
	}

	sort.Slice(all, func(i, j int) bool { return all[i].mod.After(all[j].mod) })

	for i := keep; i < len(all); i++ {
		_ = os.RemoveAll(all[i].path)
	}
}

// startAuditPreview serves the build on the seat's UI port with `vite preview` — node on this frontend's own vite.js,
// so ownServer knows the process by its path.
func startAuditPreview(ctx context.Context, root string, seat *auditSeat, build *auditBuild,
	logPath string) (*auditServer, error) {
	frontend := filepath.Join(root, "frontend")
	argv := []string{"node", filepath.Join(frontend, "node_modules", "vite", "bin", "vite.js"), "preview", "--config",
		filepath.Join(frontend, "scripts", "speed-audit", "vite.audit.config.mjs"), "--outDir", build.Dir, "--port",
		strconv.Itoa(seat.UIPort), "--strictPort"}

	return startAuditServer(ctx, "UI (vite preview)", frontend, argv, nil, logPath, seat.uiURL()+"/", time.Minute)
}
