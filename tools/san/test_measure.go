package main

import (
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// The MEASUREMENT (the-full-e2e-waits-for-a-measured-yes): the files now against what the last green
// full run tested, grouped by AREA and by RISK, and from that whether the full run is DUE.

const (
	riskWide   = "wide"
	riskNormal = "normal"
	riskLow    = "low" // tests only: the change cannot break the app, only the test itself
)

// estimateDefault is the full run's length before any run has been recorded: the e2e took 33–35 min in 10
// single-database batches (backlog.md's Done rows), about 14 min on the default 3 parallel workers (backlog #51,
// `san test full --dry-run`); the full go test and Storybook run first and add about ten.
const estimateDefault = 25 * time.Minute

// estimateSingleDefault is the same with the e2e as single-database batches (`--workers 1`).
const estimateSingleDefault = 45 * time.Minute

// e2eSetupSanFiles are the tools/san files the e2e's global setup runs (db reset-test, migrate up,
// region load-seed, seed root, pubsub ensure): a change there changes every spec's starting state.
var e2eSetupSanFiles = map[string]bool{
	"tools/san/db.go":       true,
	"tools/san/migrate.go":  true,
	"tools/san/seed.go":     true,
	"tools/san/region.go":   true,
	"tools/san/pubsub.go":   true,
	"tools/san/services.go": true,
}

// signInFiles are the server's sign-in and permission gate, outside the request_policy options.
var signInPrefixes = []string{
	"backend/services/user_service/access_interceptors/",
	"backend/pkgs/san_auth/",
	"proto/warehouse/role_base/",
	"frontend/src/features/auth/",
	"frontend/src/pages/login/",
}

var signInFiles = map[string]bool{
	"backend/services/user_service/user_v1/login.go":            true,
	"backend/services/user_service/user_v1/logout.go":           true,
	"backend/services/user_service/user_v1/check_access.go":     true,
	"backend/services/user_service/user_v1/role_resolve.go":     true,
	"backend/services/user_service/user_v1/team_access_list.go": true,
}

// appShellFiles are the frontend files every page renders through.
var appShellFiles = map[string]bool{
	"frontend/src/router.tsx":   true,
	"frontend/src/main.tsx":     true,
	"frontend/src/theme.ts":     true,
	"frontend/src/transport.ts": true,
}

// testOnly says whether a path is a test of something rather than the thing.
func testOnly(p string) bool {
	base := path.Base(p)

	return strings.HasSuffix(base, "_test.go") ||
		strings.Contains(base, ".stories.") ||
		strings.Contains(base, ".test.") ||
		strings.HasPrefix(p, "frontend/.storybook/")
}

// fileClass is where one path sits: its area, its risk by path, and the reason when that is wide.
type fileClass struct {
	Area   string
	Risk   string
	Reason string
}

// classifyPath groups a repo-relative path into an area and rates it by its path alone. The .proto
// and migration rules that need the file's content are applied on top (measure).
func classifyPath(p string) fileClass {
	seg := strings.Split(p, "/")
	low := testOnly(p)

	normal := func(area string) fileClass {
		if low {
			return fileClass{Area: area, Risk: riskLow}
		}

		return fileClass{Area: area, Risk: riskNormal}
	}

	wide := func(area, reason string) fileClass {
		if low {
			return fileClass{Area: area, Risk: riskLow}
		}

		return fileClass{Area: area, Risk: riskWide, Reason: reason}
	}

	if signInFiles[p] {
		return wide("sign-in", "sign-in or permissions")
	}

	for _, prefix := range signInPrefixes {
		if strings.HasPrefix(p, prefix) {
			return wide("sign-in", "sign-in or permissions")
		}
	}

	switch {
	case p == "frontend/e2e/smoke.txt" || p == "frontend/e2e/affected.txt" || p == "frontend/e2e/coupled.txt":
		return fileClass{Area: "test plan", Risk: riskLow}
	case strings.HasPrefix(p, "frontend/e2e/") && strings.HasSuffix(p, ".spec.ts"):
		return fileClass{Area: "e2e specs", Risk: riskLow}
	case strings.HasPrefix(p, "frontend/e2e/") || p == "frontend/playwright.config.ts":
		return fileClass{Area: "e2e setup", Risk: riskWide, Reason: "the e2e setup or helpers"}
	case e2eSetupSanFiles[p]:
		return wide("e2e setup", "the e2e setup (a san command its global setup runs)")
	case strings.HasPrefix(p, "frontend/.storybook/"):
		return fileClass{Area: "storybook", Risk: riskLow}
	case appShellFiles[p]:
		return wide("app shell", "the layout (the app shell every page renders through)")
	case strings.HasPrefix(p, "frontend/src/layouts/"):
		return wide("layout & menu", "the layout or the menu")
	case strings.HasPrefix(p, "frontend/src/components/"):
		return wide("shared components", "a shared component")
	case strings.HasPrefix(p, "frontend/src/api/"):
		return wide("app shell", "the layout (the RPC client every page calls through)")
	case len(seg) >= 4 && seg[0] == "frontend" && seg[1] == "src" && seg[2] == "pages":
		return normal("page " + seg[3])
	case len(seg) >= 4 && seg[0] == "frontend" && seg[1] == "src" && seg[2] == "features":
		return normal("feature " + seg[3])
	case len(seg) >= 3 && seg[0] == "frontend" && seg[1] == "src":
		if len(seg) == 3 {
			return normal("frontend")
		}

		return normal("frontend " + seg[2])
	case seg[0] == "frontend":
		return normal("frontend build")
	case len(seg) >= 3 && seg[0] == "backend" && seg[1] == "services":
		return normal(seg[2])
	case len(seg) >= 3 && seg[0] == "backend" && seg[1] == "pkgs":
		return normal("pkg " + seg[2])
	case len(seg) >= 3 && seg[0] == "backend" && seg[1] == "cmd":
		return normal("composition root")
	case seg[0] == "backend":
		return normal("backend")
	case len(seg) >= 4 && seg[0] == "proto" && seg[1] == "warehouse":
		if seg[2] == "events" {
			return normal("events")
		}

		return normal(seg[2] + "_service")
	case seg[0] == "proto":
		return normal("proto")
	case len(seg) >= 2 && seg[0] == "tools":
		return normal("tools/" + seg[1])
	case p == "go.mod" || p == "go.sum":
		return normal("go modules")
	}

	return normal("other")
}

// Area is one group of changed files.
type Area struct {
	Name    string
	Risk    string // the highest risk among its files
	Files   []string
	Reasons []string // wide reasons, each naming its file
}

// counts says whether an area counts toward "3+ areas": a change only to tests does not.
func (a *Area) counts() bool {
	return a.Risk != riskLow
}

// Measurement is the files now against the baseline.
type Measurement struct {
	Root       string
	Baseline   *Fingerprint // nil: no green baseline
	Since      time.Time    // set when --since stood in for the baseline
	Current    *Fingerprint
	Diff       FileDiff
	Areas      []*Area
	Wide       []string
	Due        bool
	Overdue    bool
	Why        []string
	DueSince   time.Time
	Estimate   time.Duration
	LastRun    *RunRecord // the last recorded full run, if any
	Ready      bool
	EndOfDay   bool
	NoBaseline bool
}

// countingAreas is the number of areas with a non-test change.
func (m *Measurement) countingAreas() int {
	n := 0

	for _, a := range m.Areas {
		if a.counts() {
			n++
		}
	}

	return n
}

// measureOptions are measure's flags.
type measureOptions struct {
	Ready    bool
	EndOfDay bool
	Since    time.Time
	Now      time.Time
}

// measure fingerprints root, compares it with e2e_report/last_green.json, and decides due/overdue.
// It reads the report folder and never writes it — recordMeasurement does that.
func measure(root string, opts measureOptions) (*Measurement, error) {
	if opts.Now.IsZero() {
		opts.Now = time.Now()
	}

	cur, err := takeFingerprint(root)
	if err != nil {
		return nil, err
	}

	rep := reportDir(root)
	m := &Measurement{Root: root, Current: cur, Ready: opts.Ready, EndOfDay: opts.EndOfDay, Estimate: estimateDefault}

	m.LastRun, err = lastRun(rep, false)
	if err != nil {
		return nil, err
	}

	if m.LastRun != nil && m.LastRun.Secs > 0 && !m.LastRun.Partial {
		m.Estimate = time.Duration(m.LastRun.Secs) * time.Second
	}

	base, err := readFingerprint(filepath.Join(rep, "last_green.json"))

	switch {
	case err == nil:
		m.Baseline = base
		m.Diff = diffFingerprints(base, cur)
	case errors.Is(err, fs.ErrNotExist):
		m.NoBaseline = true

		if !opts.Since.IsZero() {
			m.Since = opts.Since

			m.Diff, err = diffSince(root, cur, opts.Since)
			if err != nil {
				return nil, err
			}
		}
	default:
		return nil, err
	}

	m.group(rep)

	state, err := readTestState(rep)
	if err != nil {
		return nil, err
	}

	m.decide(state, opts.Now)

	return m, nil
}

// group sorts the diff's files into areas and applies the content rules.
func (m *Measurement) group(rep string) {
	byName := map[string]*Area{}

	rank := map[string]int{riskLow: 0, riskNormal: 1, riskWide: 2}

	for _, p := range m.Diff.All() {
		c := classifyPath(p)

		reason := c.Reason
		risk := c.Risk

		if extra := m.contentReasons(rep, p); len(extra) > 0 && !testOnly(p) {
			risk = riskWide
			reason = strings.Join(extra, "; ")
		}

		a := byName[c.Area]
		if a == nil {
			a = &Area{Name: c.Area, Risk: riskLow}
			byName[c.Area] = a
		}

		a.Files = append(a.Files, p)

		if rank[risk] > rank[a.Risk] {
			a.Risk = risk
		}

		if risk == riskWide {
			line := fmt.Sprintf("%s — %s", reason, p)
			a.Reasons = append(a.Reasons, line)
			m.Wide = append(m.Wide, line)
		}
	}

	for _, a := range byName {
		m.Areas = append(m.Areas, a)
	}

	sort.Slice(m.Areas, func(i, j int) bool {
		if m.Areas[i].counts() != m.Areas[j].counts() {
			return m.Areas[i].counts()
		}

		return m.Areas[i].Name < m.Areas[j].Name
	})
}

// contentReasons applies the rules that read a file: a .proto against the copy kept with the last
// green run, a migration by what its SQL does.
func (m *Measurement) contentReasons(rep, p string) []string {
	deleted := contains(m.Diff.Deleted, p)
	added := contains(m.Diff.Added, p)

	switch {
	case strings.HasPrefix(p, "proto/") && strings.HasSuffix(p, ".proto"):
		if deleted {
			return []string{"a .proto file was removed"}
		}

		if added || m.Baseline == nil {
			return nil
		}

		oldSrc, err := os.ReadFile(filepath.Join(rep, "last_green_proto", filepath.FromSlash(p)))
		if err != nil {
			return nil
		}

		curSrc, err := os.ReadFile(filepath.Join(m.Root, filepath.FromSlash(p)))
		if err != nil {
			return nil
		}

		return protoWideReasons(p, parseProto(string(oldSrc)), parseProto(string(curSrc)))
	case strings.Contains(p, "/db_migrations/") && strings.HasSuffix(p, ".sql"):
		if deleted {
			return []string{"a migration was removed"}
		}

		// A file the baseline had and that now reads differently: an applied migration edited.
		if contains(m.Diff.Changed, p) && m.Baseline != nil {
			return []string{"an applied migration was edited"}
		}

		src, err := os.ReadFile(filepath.Join(m.Root, filepath.FromSlash(p)))
		if err != nil {
			return nil
		}

		tables := migrationAltersExisting(string(src))
		if len(tables) > 0 {
			return []string{"a migration alters an existing table (" + strings.Join(tables, ", ") + ")"}
		}
	}

	return nil
}

func contains(list []string, s string) bool {
	for _, x := range list {
		if x == s {
			return true
		}
	}

	return false
}

// decide applies the due and overdue rules.
func (m *Measurement) decide(state testState, now time.Time) {
	areas := m.countingAreas()

	switch {
	case m.NoBaseline:
		m.Due = true
		m.Why = append(m.Why, "no green baseline — a full run is due")
	case m.Diff.Empty():
		// Covered: the files are exactly the ones the last green run tested.
	default:
		if len(m.Wide) > 0 {
			m.Due = true
			m.Why = append(m.Why, "a wide change: "+wideKinds(m.Wide))
		}

		if areas >= 3 {
			m.Due = true
			m.Why = append(m.Why, fmt.Sprintf("%d areas changed", areas))
		}

		if m.Ready {
			m.Due = true
			m.Why = append(m.Why, "work is about to be reported ready")
		}
	}

	if !m.Due {
		return
	}

	m.DueSince = now
	if !state.DueSince.IsZero() {
		m.DueSince = state.DueSince
	}

	switch {
	case areas >= 5:
		m.Overdue = true
		m.Why = append(m.Why, "overdue: 5+ areas")
	case dayStart(m.DueSince).Before(dayStart(now)):
		m.Overdue = true
		m.Why = append(m.Why, "overdue: due since "+m.DueSince.Format("2 Jan 15:04")+", still unanswered")
	case m.EndOfDay:
		m.Overdue = true
		m.Why = append(m.Why, "overdue: still unanswered at the end of the day")
	}
}

func dayStart(t time.Time) time.Time {
	y, mo, d := t.Date()

	return time.Date(y, mo, d, 0, 0, 0, 0, t.Location())
}

// wideKinds is the distinct reasons of the wide list, without their files.
func wideKinds(wide []string) string {
	seen := map[string]bool{}

	var kinds []string

	for _, w := range wide {
		k, _, _ := strings.Cut(w, " — ")
		if !seen[k] {
			seen[k] = true
			kinds = append(kinds, k)
		}
	}

	return strings.Join(kinds, "; ")
}

// Ask is the ONE line put to the owner: what changed, why it is due, about how long.
func (m *Measurement) Ask() string {
	if !m.Due {
		return ""
	}

	mins := int(m.Estimate.Round(time.Minute) / time.Minute)

	prefix := "ASK: "
	if m.Overdue {
		prefix = "ASK (OVERDUE): "
	}

	if m.NoBaseline && m.Diff.Empty() {
		return fmt.Sprintf("%sno green full run is recorded yet (e2e_report/last_green.json) — run the full go test, Storybook "+
			"and e2e on a frozen copy now? about %d min; work goes on meanwhile.", prefix, mins)
	}

	var names []string

	for _, a := range m.Areas {
		if a.counts() {
			names = append(names, a.Name)
		}
	}

	if len(names) == 0 {
		names = append(names, "tests only")
	}

	what := fmt.Sprintf("%d files in %d areas (%s)", m.Diff.Count(), m.countingAreas(), strings.Join(names, ", "))

	since := "since the last green run"
	switch {
	case m.Baseline != nil:
		since = "since the last green run (" + m.Baseline.TakenAt.Format("2 Jan 15:04") + ")"
	case !m.Since.IsZero():
		since = "since " + m.Since.Format("2 Jan 15:04") + " (no green baseline yet)"
	}

	return fmt.Sprintf("%sfull run due — %s changed %s; why: %s; about %d min on a frozen copy, work goes on. Run it now?",
		prefix, what, since, strings.Join(m.Why, "; "), mins)
}

// print writes the measurement as a person reads it.
func (m *Measurement) print(out io.Writer) {
	switch {
	case m.Baseline != nil:
		run := ""
		if m.Baseline.Run != "" {
			run = ", run " + m.Baseline.Run
		}

		fmt.Fprintf(out, "measure — the files now against e2e_report/last_green.json (green %s%s)\n",
			m.Baseline.TakenAt.Format("2006-01-02 15:04"), run)
	case !m.Since.IsZero():
		fmt.Fprintf(out, "measure — no green baseline (e2e_report/last_green.json); files modified since %s instead\n",
			m.Since.Format("2006-01-02 15:04"))
	default:
		fmt.Fprintln(out, "measure — no green baseline (e2e_report/last_green.json): nothing to compare the files with")
	}

	fmt.Fprintf(out, "  %d source files fingerprinted (%s)\n", len(m.Current.Files), m.Current.Sum())

	if !m.Diff.Empty() {
		fmt.Fprintf(out, "  %d changed · %d added · %d deleted · %d areas", len(m.Diff.Changed), len(m.Diff.Added),
			len(m.Diff.Deleted), m.countingAreas())

		if tests := len(m.Areas) - m.countingAreas(); tests > 0 {
			fmt.Fprintf(out, " (+%d tests only)", tests)
		}

		fmt.Fprintln(out)
		fmt.Fprintln(out)

		width := 0
		for _, a := range m.Areas {
			width = max(width, len(a.Name))
		}

		for _, a := range m.Areas {
			risk := a.Risk
			if risk == riskWide {
				risk = "WIDE"
			}

			fmt.Fprintf(out, "  %-*s  %-6s  %s\n", width, a.Name, risk, shortFiles(a.Files, 4))
		}
	}

	if len(m.Wide) > 0 {
		fmt.Fprintln(out)
		fmt.Fprintln(out, "  wide changes:")

		for _, w := range m.Wide {
			fmt.Fprintf(out, "    %s\n", w)
		}
	}

	fmt.Fprintln(out)

	switch {
	case m.Due && m.Overdue:
		fmt.Fprintf(out, "OVERDUE — %s\n", strings.Join(m.Why, "; "))
	case m.Due:
		fmt.Fprintf(out, "DUE — %s\n", strings.Join(m.Why, "; "))
	case m.Diff.Empty():
		fmt.Fprintln(out, "COVERED — the files are the ones the last green full run tested")
	default:
		fmt.Fprintf(out, "NOT DUE — %d area(s), no wide change: the affected specs and the smoke set cover it "+
			"(go run ./tools/san test affected)\n", m.countingAreas())
	}

	if ask := m.Ask(); ask != "" {
		fmt.Fprintln(out, ask)
	}
}

// shortFiles lists up to n file names (the last path element) and how many more.
func shortFiles(files []string, n int) string {
	var names []string

	for i, f := range files {
		if i == n {
			names = append(names, fmt.Sprintf("+%d more", len(files)-n))

			break
		}

		names = append(names, shortName(f))
	}

	return strings.Join(names, ", ")
}

// shortName is a file's name — with its folder when the name alone says nothing (index.tsx).
func shortName(f string) string {
	base := path.Base(f)
	if strings.HasPrefix(base, "index.") {
		return path.Base(path.Dir(f)) + "/" + base
	}

	return base
}
