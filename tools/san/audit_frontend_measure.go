package main

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// THE REQUEST MEASURES (frontend_speed_scoping.md §4) — what the driver recorded, turned into the figures a screen's
// audit file and baseline.json carry. The driver (frontend/scripts/speed-audit/run.mjs) only RECORDS: every Connect POST
// of a load with its body and its start/end on the page's clock, the CORS pre-checks, the moment the screen became
// usable, and what fired after a save. Everything counted from that is here, in pure functions the unit tests pin:
//
//	requests     Connect POSTs per load, the shell's (CheckAccess, TeamAccessList — every load, whatever the screen)
//	             apart from the screen's own; from the warm loads, which must agree (a count that differs between
//	             two loads of the same screen is itself a finding — a race)
//	duplicates   the same method with the same body inside one load
//	pre-checks   OPTIONS requests, informative only — the API keeps them 7200 s (backlog #127), so a warm load
//	             asks none; the cold load opens a fresh browser context and pays one per request shape
//	chain        how many calls wait on each other: depth(r) = 1 + the deepest q that ENDED before r started and within
//	             100 ms of it (a call fired from a .then or the next render), else 1 — over the screen's requests
//	usable       the first frame at which the screen's ready element shows with no loading marker in it and no Connect
//	             request in flight, held 500 ms with no new request — warm median and min–max
//	after save   the reads fired from the save's answer until 1 s quiet; a listed read missing reads "stale?", one
//	             asked twice or more than listed + 2 reads "storm"

// auditChainGapMS is how close after a call's end the next one must start to count as waiting on it.
const auditChainGapMS = 100

// auditDepDelayMS is how long the dependency pass holds back one request's answer: every request that starts that much
// later waits on it. Far above a load's noise, so a busy CPU cannot fake a dependency or hide one.
const auditDepDelayMS = 1000

// auditDepPasses is how many times the driver runs the dependency pass: a chain is judged only when it holds in
// every pass (the unstable-chain rule, audit_frontend_verdict.go). Two catch a link that flips half the time in
// one run of two, at one more pass's cost — about a second per screen request.
const auditDepPasses = 2

// ── what the driver records ───────────────────────────────────────────────────────────────────────

type auditRawRequest struct {
	Method string  `json:"method"` // Service/Method
	Body   string  `json:"body"`
	Start  float64 `json:"start"` // ms on the page's clock (performance.timeOrigin)
	End    float64 `json:"end"`
	Status int     `json:"status"`
	Failed bool    `json:"failed,omitempty"`
	// After are the requests of the same load (indices) that, when the driver held their answer back, made this one
	// start that much later — what it waits on, measured (the dependency pass); set on the reference warm load only.
	After []int `json:"after,omitempty"`
	// AfterPasses is After per dependency pass when the driver ran several (auditDepPasses; After is the first) — a
	// link that holds in some passes only is a chain that does not hold in every run (audit_frontend_verdict.go).
	AfterPasses [][]int `json:"after_passes,omitempty"`
}

type auditRawPreflight struct {
	URL   string  `json:"url"`
	Start float64 `json:"start"`
}

type auditRawLoad struct {
	Kind       string              `json:"kind"`           // cold | warm
	Deps       bool                `json:"deps,omitempty"` // its requests carry After (the dependency pass ran)
	DepPasses  int                 `json:"dep_passes,omitempty"`
	UsableMS   *float64            `json:"usable_ms"`
	Never      bool                `json:"never"`
	NotReady   string              `json:"not_ready,omitempty"`
	Requests   []auditRawRequest   `json:"requests"`
	Preflights []auditRawPreflight `json:"preflights"`
}

type auditRawInteraction struct {
	Name     string            `json:"name"`
	RPC      string            `json:"rpc,omitempty"`
	Sent     bool              `json:"sent"`
	Status   int               `json:"status,omitempty"` // the write's answer (HTTP status); 400+ — refused
	Error    string            `json:"error,omitempty"`
	Requests []auditRawRequest `json:"requests"`
	URLAfter string            `json:"url_after,omitempty"`
}

type auditRawScreen struct {
	Name  string         `json:"name"`
	URL   string         `json:"url"`
	Error string         `json:"error,omitempty"`
	Secs  float64        `json:"secs"`
	Loads []auditRawLoad `json:"loads"`
	// PageErrors are what the page threw or logged as an error; Screenshot is the cold load when it never became usable.
	PageErrors []string              `json:"page_errors,omitempty"`
	Screenshot string                `json:"screenshot,omitempty"`
	Save       *auditRawInteraction  `json:"save,omitempty"`
	Probes     []auditRawInteraction `json:"probes,omitempty"`
	// Typing is the typing pass's record (P2): every pass of every field (audit_frontend_typing.go).
	Typing []auditRawTyping `json:"typing,omitempty"`
}

type auditRawResults struct {
	Started string           `json:"started"`
	Browser string           `json:"browser"`
	Screens []auditRawScreen `json:"screens"`
}

// ── the figures ───────────────────────────────────────────────────────────────────────────────────

// auditSpread is a time's median and range over the warm loads.
type auditSpread struct {
	Median float64 `json:"median"`
	Min    float64 `json:"min"`
	Max    float64 `json:"max"`
	N      int     `json:"n"`
}

// auditAfterSave is what fired after the screen's one save.
type auditAfterSave struct {
	Name     string         `json:"name"`
	RPC      string         `json:"rpc"`
	Sent     bool           `json:"sent"`
	Count    int            `json:"count"`
	RPCs     []string       `json:"rpcs"` // in the order they fired
	ByMethod map[string]int `json:"by_method"`
	Listed   []string       `json:"listed,omitempty"`
	Missing  []string       `json:"missing,omitempty"`
	Twice    []string       `json:"twice,omitempty"`
	Verdict  string         `json:"verdict"` // ok | stale? | storm | recorded | not sent
	URLAfter string         `json:"url_after,omitempty"`
	Error    string         `json:"error,omitempty"`
}

// auditProbe is a read-only interaction's requests.
type auditProbe struct {
	Name       string         `json:"name"`
	Count      int            `json:"count"`
	ByMethod   map[string]int `json:"by_method"`
	Duplicates int            `json:"duplicates"`
	Error      string         `json:"error,omitempty"`
}

// auditHistoryRow is one line of a screen's History (a baseline written).
type auditHistoryRow struct {
	Date      string  `json:"date"`
	Requests  int     `json:"requests"`
	Dup       int     `json:"dup"`
	Chain     int     `json:"chain"`
	UsableMS  float64 `json:"usable_ms"`
	Noisy     bool    `json:"noisy,omitempty"`
	AfterSave int     `json:"after_save"` // -1: no save measured
	// Typing is each typing field's commits per keystroke ("buyer name 1 · address 1"), P2 on.
	Typing string `json:"typing,omitempty"`
	Change string `json:"change"`
}

// auditMeasure is one screen's figures — its baseline.json entry.
type auditMeasure struct {
	Screen         string            `json:"screen"`
	Date           string            `json:"date"`
	Role           string            `json:"role"`
	URL            string            `json:"url"`
	RequestsShell  int               `json:"requests_shell"`
	RequestsScreen int               `json:"requests_screen"`
	ByMethod       map[string]int    `json:"by_method"`
	Duplicates     int               `json:"duplicates"`
	DuplicateOf    []string          `json:"duplicate_of,omitempty"`
	Preflights     int               `json:"preflights"`
	ChainDepth     int               `json:"chain_depth"`
	Chain          []string          `json:"chain"`
	Chains         [][]string        `json:"chains,omitempty"`       // every chain as deep, the critical one first
	ChainMethod    string            `json:"chain_method"`           // "measured" (the dependency pass) or "timing"
	ChainDepths    []int             `json:"chain_depths,omitempty"` // the depth each dependency pass read
	Waves          map[string][]int  `json:"waves,omitempty"`        // method → its chain depths in the reference load
	ShellByMethod  map[string]int    `json:"shell_by_method,omitempty"`
	UsableMS       auditSpread       `json:"usable_ms"`
	ColdUsableMS   float64           `json:"cold_usable_ms"`
	ColdRequests   int               `json:"cold_requests"`
	ColdPreflights int               `json:"cold_preflights"`
	WarmLoads      int               `json:"warm_loads"`
	CountsAgree    bool              `json:"counts_agree"`
	Unstable       []string          `json:"unstable,omitempty"`
	NeverUsable    int               `json:"never_usable"`
	AfterSave      *auditAfterSave   `json:"after_save,omitempty"`
	Probes         []auditProbe      `json:"probes,omitempty"`
	Typing         []auditTyping     `json:"typing,omitempty"` // P2: the form's typing fields
	Noisy          bool              `json:"noisy"`
	Errors         []string          `json:"errors,omitempty"`
	History        []auditHistoryRow `json:"history,omitempty"`
}

// auditShellRead is one read the app's shell sends on every screen of a role, whatever the screen: a method, and a
// piece of its body when the same method is also a screen's own read.
type auditShellRead struct {
	Method  string `json:"method"`
	BodyHas string `json:"body_has,omitempty"`
}

// auditShell are the shell's reads: the sign-in check and the team switcher (AuthContext, TeamContext), and the
// sidebar's two badges — payments awaiting this team's confirmation and found goods waiting (layouts/desktop/Sidebar.tsx,
// each a one-row page). They are counted apart from the screen's own requests, and never chained.
var auditShell = []auditShellRead{
	{Method: "AuthService/CheckAccess"},
	{Method: "UserService/TeamAccessList"},
	{Method: "LiabilityService/LiabilityPositionList", BodyHas: `"filter":{},"dataRequest"`},
	{Method: "FoundRequestService/FoundRequestList", BodyHas: `"limit":1}`},
}

// isShell says whether a request is one of the shell's reads.
func isShell(r auditRawRequest, shell []auditShellRead) bool {
	for _, s := range shell {
		if s.Method == r.Method && strings.Contains(r.Body, s.BodyHas) {
			return true
		}
	}

	return false
}

// splitShell parts a load's requests into the shell's and the screen's.
func splitShell(reqs []auditRawRequest, shell []auditShellRead) (shellReqs, screenReqs []auditRawRequest) {
	for _, r := range reqs {
		if isShell(r, shell) {
			shellReqs = append(shellReqs, r)
		} else {
			screenReqs = append(screenReqs, r)
		}
	}

	return shellReqs, screenReqs
}

// countByMethod counts requests per method.
func countByMethod(reqs []auditRawRequest) map[string]int {
	m := map[string]int{}
	for _, r := range reqs {
		m[r.Method]++
	}

	return m
}

// duplicatesOf counts the requests that repeat an earlier one of the same load — same method, same body — and names
// each repeated method once, sorted.
func duplicatesOf(reqs []auditRawRequest) (int, []string) {
	seen := map[string]int{}
	n := 0

	var named []string

	for _, r := range reqs {
		key := r.Method + "\x00" + r.Body
		seen[key]++

		if seen[key] == 2 {
			named = append(named, r.Method)
		}

		if seen[key] > 1 {
			n++
		}
	}

	sort.Strings(named)

	return n, named
}

// chainOf is the deepest waiting chain in reqs: depth(r) = 1 + max depth(q) over the q that ended at or before r's
// start and no more than gap ms before it, else 1. It returns the depth, the chain's methods first to last, and each
// method's depth (its deepest occurrence).
func chainOf(reqs []auditRawRequest, gap float64) (int, []string, map[string][]int) {
	if len(reqs) == 0 {
		return 0, nil, nil
	}

	order := make([]int, len(reqs))
	for i := range order {
		order[i] = i
	}

	sort.SliceStable(order, func(a, b int) bool { return reqs[order[a]].Start < reqs[order[b]].Start })

	depth := make([]int, len(reqs))
	parent := make([]int, len(reqs))

	for _, i := range order {
		depth[i] = 1
		parent[i] = -1

		for _, j := range order {
			if j == i {
				continue
			}

			waited := reqs[j].End <= reqs[i].Start && reqs[i].Start-reqs[j].End <= gap
			if !waited {
				continue
			}

			better := depth[j]+1 > depth[i] || depth[j]+1 == depth[i] && parent[i] >= 0 && reqs[j].End > reqs[parent[i]].End
			if better {
				depth[i] = depth[j] + 1
				parent[i] = j
			}
		}
	}

	deepest := order[0]
	for _, i := range order {
		if depth[i] > depth[deepest] {
			deepest = i
		}
	}

	var chain []string
	for i := deepest; i >= 0; i = parent[i] {
		chain = append([]string{reqs[i].Method}, chain...)
	}

	return depth[deepest], chain, wavesOf(reqs, depth, nil)
}

// wavesOf is each method's chain depths (sorted, once each) — of the requests keep says yes to (nil: all).
func wavesOf(reqs []auditRawRequest, depth []int, keep func(int) bool) map[string][]int {
	waves := map[string][]int{}

	for i, r := range reqs {
		if keep != nil && !keep(i) {
			continue
		}

		have := false
		for _, d := range waves[r.Method] {
			have = have || d == depth[i]
		}

		if !have {
			waves[r.Method] = append(waves[r.Method], depth[i])
			sort.Ints(waves[r.Method])
		}
	}

	return waves
}

// chainFromDeps is the deepest waiting chain from MEASURED dependencies (each request's After — the requests whose
// held-back answer delayed it): depth(r) = 1 + the deepest of its After, else 1, over the requests keep says yes to
// (the screen's). It needs no timing window, so a long render between an answer and the call it fires (a 45-line
// shelf) does not break a chain, and two branches running side by side are never joined by coincidence. Of the
// chains that deep, the one returned is the CRITICAL one — its last call answers last, which moves with the CPU; every
// chain that deep comes back too, once each and sorted, so a baseline written twice reads the same.
func chainFromDeps(reqs []auditRawRequest, keep func(int) bool) (int, []string, map[string][]int, [][]string) {
	depth := make([]int, len(reqs))
	parent := make([]int, len(reqs))
	state := make([]int, len(reqs)) // 0 new · 1 on the path · 2 done

	var visit func(i int) int

	visit = func(i int) int {
		if state[i] == 2 {
			return depth[i]
		}

		if state[i] == 1 {
			return 0 // a cycle cannot be measured; break it
		}

		state[i] = 1
		depth[i] = 1
		parent[i] = -1

		for _, j := range reqs[i].After {
			if j < 0 || j >= len(reqs) || j == i || !keep(j) {
				continue
			}

			d := visit(j) + 1
			if d > depth[i] || d == depth[i] && parent[i] >= 0 && reqs[j].End > reqs[parent[i]].End {
				depth[i] = d
				parent[i] = j
			}
		}

		state[i] = 2

		return depth[i]
	}

	deepest := -1

	for i := range reqs {
		if !keep(i) {
			continue
		}

		visit(i)

		if deepest < 0 || depth[i] > depth[deepest] || depth[i] == depth[deepest] && reqs[i].End > reqs[deepest].End {
			deepest = i
		}
	}

	if deepest < 0 {
		return 0, nil, nil, nil
	}

	path := func(end int) []string {
		var chain []string
		for i := end; i >= 0; i = parent[i] {
			chain = append([]string{reqs[i].Method}, chain...)
		}

		return chain
	}

	chain := path(deepest)
	all := [][]string{chain}
	seen := map[string]bool{strings.Join(chain, " "): true}

	for i := range reqs {
		if !keep(i) || i == deepest || depth[i] != depth[deepest] {
			continue
		}

		p := path(i)
		if !seen[strings.Join(p, " ")] {
			seen[strings.Join(p, " ")] = true
			all = append(all, p)
		}
	}

	sort.Slice(all, func(a, b int) bool { return strings.Join(all[a], " ") < strings.Join(all[b], " ") })

	return depth[deepest], chain, wavesOf(reqs, depth, keep), all
}

// chainsText is every chain as deep, "A → B → C · D → E → F" (the one chain when only it is known).
func chainsText(m auditMeasure) string {
	chains := m.Chains
	if len(chains) == 0 && len(m.Chain) > 0 {
		chains = [][]string{m.Chain}
	}

	var parts []string
	for _, c := range chains {
		parts = append(parts, strings.Join(shortAll(c), " → "))
	}

	return strings.Join(parts, " · ")
}

// spreadOf is the median, min and max of xs.
func spreadOf(xs []float64) auditSpread {
	if len(xs) == 0 {
		return auditSpread{}
	}

	s := append([]float64(nil), xs...)
	sort.Float64s(s)

	med := s[len(s)/2]
	if len(s)%2 == 0 {
		med = (s[len(s)/2-1] + s[len(s)/2]) / 2
	}

	return auditSpread{Median: round1(med), Min: round1(s[0]), Max: round1(s[len(s)-1]), N: len(s)}
}

func round1(x float64) float64 {
	return math.Round(x*10) / 10
}

// sameCounts says whether two method counts are the same, and names the methods that differ.
func sameCounts(a, b map[string]int) []string {
	var differ []string

	keys := map[string]bool{}
	for k := range a {
		keys[k] = true
	}

	for k := range b {
		keys[k] = true
	}

	for k := range keys {
		if a[k] != b[k] {
			differ = append(differ, k)
		}
	}

	sort.Strings(differ)

	return differ
}

// shortMethod is a method without its service ("RackService/RackStock" → "RackStock").
func shortMethod(m string) string {
	_, after, ok := strings.Cut(m, "/")
	if ok {
		return after
	}

	return m
}

// judgeAfterSave sorts what fired after a save against the reads the screen lists.
func judgeAfterSave(raw *auditRawInteraction, listed []string) *auditAfterSave {
	a := &auditAfterSave{Name: raw.Name, RPC: raw.RPC, Sent: raw.Sent, Listed: listed, Error: raw.Error,
		URLAfter: raw.URLAfter, ByMethod: countByMethod(raw.Requests)}

	for _, r := range raw.Requests {
		a.RPCs = append(a.RPCs, r.Method)
	}

	a.Count = len(raw.Requests)

	if !raw.Sent {
		a.Verdict = "not sent"

		return a
	}

	// A refused write refreshes nothing it saved: its count is no save's, and is never compared.
	if raw.Status >= 400 {
		a.Sent = false
		a.Verdict = "refused"

		return a
	}

	if len(listed) == 0 {
		a.Verdict = "recorded"

		return a
	}

	for _, l := range listed {
		if a.ByMethod[l] == 0 {
			a.Missing = append(a.Missing, l)
		}
	}

	for m, n := range a.ByMethod {
		if n > 1 {
			a.Twice = append(a.Twice, m)
		}
	}

	sort.Strings(a.Twice)

	switch {
	case len(a.Twice) > 0 || a.Count > len(listed)+2:
		a.Verdict = "storm"
	case len(a.Missing) > 0:
		a.Verdict = "stale?"
	default:
		a.Verdict = "ok"
	}

	return a
}

// measureScreen turns one screen's recorded loads into its figures. The first warm load is the reference for the
// counts; every other warm load is compared with it.
func measureScreen(raw auditRawScreen, def auditScreenDef, shell []auditShellRead, noisy bool, date string) auditMeasure {
	m := auditMeasure{Screen: raw.Name, Date: date, Role: def.Role, URL: raw.URL, Noisy: noisy, CountsAgree: true,
		ByMethod: map[string]int{}}

	if raw.Error != "" {
		m.Errors = append(m.Errors, raw.Error)
	}

	var warm []auditRawLoad

	for _, l := range raw.Loads {
		if l.Kind == "cold" {
			m.ColdRequests = len(l.Requests)
			m.ColdPreflights = len(l.Preflights)

			if l.UsableMS != nil {
				m.ColdUsableMS = round1(*l.UsableMS)
			}

			continue
		}

		warm = append(warm, l)
	}

	m.WarmLoads = len(warm)

	var usable []float64

	for _, l := range warm {
		if l.UsableMS == nil || l.Never {
			m.NeverUsable++

			if l.NotReady != "" {
				m.Errors = append(m.Errors, "never usable: "+l.NotReady)
			}

			continue
		}

		usable = append(usable, *l.UsableMS)
	}

	m.UsableMS = spreadOf(usable)

	if m.NeverUsable > 0 {
		for i, e := range raw.PageErrors {
			if i == 3 {
				break
			}

			m.Errors = append(m.Errors, "the page said: "+e)
		}
	}

	if len(warm) == 0 {
		return m
	}

	ref := warm[0]
	shellReqs, screenReqs := splitShell(ref.Requests, shell)

	m.RequestsShell = len(shellReqs)
	m.RequestsScreen = len(screenReqs)
	m.ByMethod = countByMethod(screenReqs)
	m.ShellByMethod = countByMethod(shellReqs)
	m.Duplicates, m.DuplicateOf = duplicatesOf(ref.Requests)
	m.Preflights = len(ref.Preflights)

	all := countByMethod(ref.Requests)

	for _, l := range warm {
		differ := sameCounts(countByMethod(l.Requests), all)
		if len(differ) > 0 {
			m.CountsAgree = false
			m.Unstable = mergeSorted(m.Unstable, differ)
		}
	}

	if ref.Deps {
		m.ChainMethod = "measured"
		keep := func(i int) bool { return !isShell(ref.Requests[i], shell) }
		m.ChainDepth, m.Chain, m.Waves, m.Chains = chainFromDeps(ref.Requests, keep)
		m.ChainDepths = passDepths(ref, keep)
	} else {
		// No dependency pass: the timing rule over the screen's requests, the chain most warm loads read (a tie takes
		// the deeper).
		m.ChainMethod = "timing"
		depths := map[int]int{}
		chains := map[int][]string{}
		waves := map[int]map[string][]int{}

		for _, l := range warm {
			_, screen := splitShell(l.Requests, shell)
			d, c, w := chainOf(screen, auditChainGapMS)
			depths[d]++

			if _, ok := chains[d]; !ok {
				chains[d] = c
				waves[d] = w
			}
		}

		best, bestN := 0, -1
		for d, n := range depths {
			if n > bestN || n == bestN && d > best {
				best, bestN = d, n
			}
		}

		m.ChainDepth = best
		m.Chain = chains[best]
		m.Waves = waves[best]
	}

	if raw.Save != nil {
		m.AfterSave = judgeAfterSave(raw.Save, listedRefreshes(def))
	}

	for _, p := range raw.Probes {
		d, _ := duplicatesOf(p.Requests)
		m.Probes = append(m.Probes, auditProbe{Name: p.Name, Count: len(p.Requests), ByMethod: countByMethod(p.Requests),
			Duplicates: d, Error: p.Error})
	}

	if len(def.Typing) > 0 {
		m.Typing = measureTyping(raw.Typing, def.Typing)
	}

	return m
}

// passDepths is the chain depth each dependency pass read (the first is the chain the measure names). A load the
// driver measured with one pass reads one depth.
func passDepths(ref auditRawLoad, keep func(int) bool) []int {
	if ref.DepPasses <= 1 {
		d, _, _, _ := chainFromDeps(ref.Requests, keep)

		return []int{d}
	}

	out := make([]int, ref.DepPasses)

	for k := range out {
		pass := make([]auditRawRequest, len(ref.Requests))

		for i, r := range ref.Requests {
			r.After = nil
			if k < len(r.AfterPasses) {
				r.After = r.AfterPasses[k]
			}

			pass[i] = r
		}

		out[k], _, _, _ = chainFromDeps(pass, keep)
	}

	return out
}

func listedRefreshes(def auditScreenDef) []string {
	if def.Save == nil {
		return nil
	}

	return def.Save.Refreshes
}

func mergeSorted(a, b []string) []string {
	set := map[string]bool{}
	for _, x := range a {
		set[x] = true
	}

	for _, x := range b {
		set[x] = true
	}

	out := make([]string, 0, len(set))
	for x := range set {
		out = append(out, x)
	}

	sort.Strings(out)

	return out
}

// ── against the baseline (this only LISTS what changed and decides nothing — the verdict is audit_frontend_verdict.go)

// The two kinds of change (a-slice-fixes-the-speed-regression-it-caused): a COUNT is exact on every run, so a worse
// one is the slice's own doing (P3 has the slice fix it); a TIMING moves with the CPU (P3 only reports it).
const (
	auditChangeCount  = "COUNT"
	auditChangeTiming = "TIMING"
)

// auditChange is one figure that moved past its threshold since the baseline.
type auditChange struct {
	Kind    string `json:"kind"` // COUNT | TIMING
	Screen  string `json:"screen"`
	Measure string `json:"measure"`
	Was     string `json:"was"`
	Now     string `json:"now"`
	Note    string `json:"note,omitempty"`
}

// frontendChanges lists what moved between a screen's baseline and a new measure, by the scoping's thresholds (§6):
// screen requests +1 or more · a new duplicate · chain depth +1 · after the save a listed read missing, or 2+ more
// requests · while typing (P2) commits per keystroke +1, components per keystroke +25 %, trailing commits +1 · usable
// warm median +25 % AND +150 ms — the time only when both are quiet and the new spread is under 30 %
// of its median (else it is listed as noisy, not as a change). Each change is tagged COUNT (requests per load,
// duplicates, chain depth, the typing counts — and the requests after a save, a count too) or TIMING (usable). It
// RETURNS the list and decides nothing: the verdict is judgeAudit's (`--files`, #124,
// a-slice-fixes-the-speed-regression-it-caused).
func frontendChanges(base, now auditMeasure) []auditChange {
	var out []auditChange

	add := func(measure, was, is, note string) {
		kind := auditChangeCount
		if strings.HasPrefix(measure, "usable") {
			kind = auditChangeTiming
		}

		out = append(out, auditChange{Kind: kind, Screen: now.Screen, Measure: measure, Was: was, Now: is, Note: note})
	}

	if now.RequestsScreen >= base.RequestsScreen+1 {
		add("requests", fmt.Sprint(base.RequestsScreen), fmt.Sprint(now.RequestsScreen), moreMethods(base.ByMethod, now.ByMethod))
	}

	newDup := subtract(now.DuplicateOf, base.DuplicateOf)
	if now.Duplicates > base.Duplicates || len(newDup) > 0 {
		add("duplicates", fmt.Sprint(base.Duplicates), fmt.Sprint(now.Duplicates), "new: "+strings.Join(newDup, ", "))
	}

	if now.ChainDepth >= base.ChainDepth+1 {
		add("chain", fmt.Sprint(base.ChainDepth), fmt.Sprint(now.ChainDepth), strings.Join(shortAll(now.Chain), " → "))
	}

	if base.AfterSave != nil && now.AfterSave != nil && now.AfterSave.Sent {
		if len(now.AfterSave.Missing) > len(base.AfterSave.Missing) {
			add("after save", fmt.Sprint(base.AfterSave.Count), fmt.Sprint(now.AfterSave.Count),
				"missing: "+strings.Join(subtract(now.AfterSave.Missing, base.AfterSave.Missing), ", "))
		}

		if now.AfterSave.Count >= base.AfterSave.Count+2 {
			add("after save", fmt.Sprint(base.AfterSave.Count), fmt.Sprint(now.AfterSave.Count), "storm?")
		}
	}

	slower := now.UsableMS.Median >= base.UsableMS.Median*1.25 && now.UsableMS.Median >= base.UsableMS.Median+150
	if base.UsableMS.N > 0 && now.UsableMS.N > 0 && slower {
		quiet := !base.Noisy && !now.Noisy && now.UsableMS.Max-now.UsableMS.Min < 0.3*now.UsableMS.Median
		if quiet {
			add("usable", fmt.Sprintf("%.0f ms", base.UsableMS.Median), fmt.Sprintf("%.0f ms", now.UsableMS.Median), "")
		} else {
			add("usable (noisy)", fmt.Sprintf("%.0f ms", base.UsableMS.Median), fmt.Sprintf("%.0f ms", now.UsableMS.Median),
				"a noisy machine or a wide spread — not a change")
		}
	}

	// Typing (P2): commits per keystroke +1, components per keystroke +25 %, trailing commits +1 — COUNTS.
	for _, c := range typingChanges(base.Typing, now.Typing) {
		c.Screen = now.Screen
		out = append(out, c)
	}

	return out
}

// moreMethods names the methods asked more often now than before.
func moreMethods(was, now map[string]int) string {
	var parts []string

	for m, n := range now {
		if n > was[m] {
			parts = append(parts, fmt.Sprintf("%s ×%d", shortMethod(m), n))
		}
	}

	sort.Strings(parts)

	return strings.Join(parts, ", ")
}

func subtract(a, b []string) []string {
	have := map[string]bool{}
	for _, x := range b {
		have[x] = true
	}

	var out []string

	for _, x := range a {
		if !have[x] {
			out = append(out, x)
		}
	}

	return out
}

func shortAll(ms []string) []string {
	out := make([]string, len(ms))
	for i, m := range ms {
		out[i] = shortMethod(m)
	}

	return out
}

// ── the files ─────────────────────────────────────────────────────────────────────────────────────

// auditBaselinePath is audits/frontend/baseline.json (committed).
func auditBaselinePath(root string) string {
	return filepath.Join(root, "audits", "frontend", "baseline.json")
}

// readAuditBaseline is the committed baseline (empty when there is none yet).
func readAuditBaseline(root string) map[string]auditMeasure {
	out := map[string]auditMeasure{}

	b, err := os.ReadFile(auditBaselinePath(root))
	if err != nil {
		return out
	}

	_ = json.Unmarshal(b, &out)

	return out
}

// historyRow is a measure's History line, its change named against the baseline it replaces — or, the screen's first,
// the phase that added it (phase "" — P1).
func historyRow(m auditMeasure, prev *auditMeasure, phase string) auditHistoryRow {
	if phase == "" {
		phase = "P1"
	}

	row := auditHistoryRow{Date: m.Date, Requests: m.RequestsScreen, Dup: m.Duplicates, Chain: m.ChainDepth,
		UsableMS: m.UsableMS.Median, Noisy: m.Noisy, AfterSave: -1, Typing: typingHistory(m.Typing),
		Change: "first baseline (" + phase + ")"}

	if m.AfterSave != nil && m.AfterSave.Sent {
		row.AfterSave = m.AfterSave.Count
	}

	if prev != nil {
		changes := frontendChanges(*prev, m)
		if len(changes) == 0 {
			row.Change = "no change past a threshold"
		} else {
			var parts []string
			for _, c := range changes {
				parts = append(parts, fmt.Sprintf("%s %s→%s", c.Measure, c.Was, c.Now))
			}

			row.Change = strings.Join(parts, "; ")
		}

		if len(prev.Typing) == 0 && len(m.Typing) > 0 {
			row.Change += "; typing first measured (P2)"
		}

		if prev.AfterSave == nil && m.AfterSave != nil {
			row.Change += "; its save first measured (P2)"
		}
	}

	return row
}

// auditRunFacts is what a screen's md says about how it was measured.
type auditRunFacts struct {
	Date       string
	SrcTree    string // git rev-parse HEAD:frontend/src
	SrcDirty   int    // files under frontend/src changed against HEAD
	Build      string
	Seed       string
	CountsOnly bool
	Beside     string
	Runs       int
}

// verdictOf is a screen's one-sentence verdict.
func verdictOf(m auditMeasure) string {
	var parts []string

	parts = append(parts, fmt.Sprintf("%d screen requests on a warm load (+%d shell)", m.RequestsScreen, m.RequestsShell))

	if m.ChainDepth > 1 {
		parts = append(parts, fmt.Sprintf("%d-deep waiting chains (%s)", m.ChainDepth, chainsText(m)))
	} else {
		parts = append(parts, "no waiting chain")
	}

	if m.Duplicates > 0 {
		parts = append(parts, fmt.Sprintf("%d duplicate(s) (%s)", m.Duplicates, strings.Join(shortAll(m.DuplicateOf), ", ")))
	} else {
		parts = append(parts, "no duplicate")
	}

	if m.UsableMS.N > 0 {
		parts = append(parts, fmt.Sprintf("usable in %.0f ms", m.UsableMS.Median))
	} else {
		parts = append(parts, "never usable within 15 s")
	}

	if m.AfterSave != nil {
		parts = append(parts, fmt.Sprintf("its save fired %d request(s) after (%s)", m.AfterSave.Count, m.AfterSave.Verdict))
	}

	for _, t := range m.Typing {
		if typingMeasured(t) {
			parts = append(parts, fmt.Sprintf("typing into the %s: %s", t.Field, typingText(t)))
		} else {
			parts = append(parts, fmt.Sprintf("typing into the %s not measured", t.Field))
		}
	}

	return strings.Join(parts, "; ") + "."
}

// findingsOf are the screen's numbered findings — what, the fix, its trade-off (a discussion document).
func findingsOf(m auditMeasure, def auditScreenDef) []string {
	var out []string

	if m.ChainDepth >= 3 {
		out = append(out, fmt.Sprintf("**A %d-deep waiting chain** — %s: each call starts only when the one before "+
			"answers, so the screen pays %d round trips before it can draw. *Fix:* the later reads as query hooks keyed "+
			"on the earlier answers (#120–#122 — they still wait, but can be prefetched or merged into one RPC that "+
			"answers the names with the rows). *Trade-off:* a merged RPC couples two services' reads.",
			m.ChainDepth, chainsText(m), m.ChainDepth))
	}

	if m.Duplicates > 0 {
		out = append(out, fmt.Sprintf("**%d duplicate request(s)** — %s asked twice with the same body in one load. "+
			"*Fix:* one query key for the read so TanStack dedupes it. *Trade-off:* none beyond the key.",
			m.Duplicates, strings.Join(shortAll(m.DuplicateOf), ", ")))
	}

	if !m.CountsAgree {
		out = append(out, fmt.Sprintf("**Counts differ between warm loads** (%s) — a race in what the screen asks. "+
			"*Fix:* find the read that depends on timing (an effect racing a context). *Trade-off:* —",
			strings.Join(shortAll(m.Unstable), ", ")))
	}

	if m.NeverUsable > 0 {
		out = append(out, fmt.Sprintf("**Never usable in %d of %d warm loads** — the ready element or a loading marker "+
			"stayed past 15 s (%s). *Fix:* see the raw load in the run folder.", m.NeverUsable, m.WarmLoads,
			strings.Join(m.Errors, "; ")))
	}

	if m.AfterSave != nil {
		switch m.AfterSave.Verdict {
		case "stale?":
			out = append(out, fmt.Sprintf("**After the save, a listed read did not re-run** (%s) — the screen may show the "+
				"old figure. *Fix:* invalidate that read's key in the save's onSuccess.",
				strings.Join(shortAll(m.AfterSave.Missing), ", ")))
		case "storm":
			out = append(out, fmt.Sprintf("**A request storm after the save** — %d requests (listed %d; asked twice: %s). "+
				"*Fix:* invalidate by the narrow key, not a whole family.", m.AfterSave.Count, len(m.AfterSave.Listed),
				strings.Join(shortAll(m.AfterSave.Twice), ", ")))
		case "not sent":
			out = append(out, fmt.Sprintf("**The save was not measured** — %s. *Fix:* the audit's script for this "+
				"screen (tools/san/audit_frontend_screens.go).", m.AfterSave.Error))
		case "refused":
			out = append(out, fmt.Sprintf("**The save was refused** — %s. Nothing after it is a refresh, so it is not "+
				"counted. *Fix:* what the audit's script or seed gives the write (tools/san/audit_frontend_screens.go, "+
				"audit_frontend_seed.go).", m.AfterSave.Error))
		}
	}

	if m.Preflights > 0 {
		out = append(out, fmt.Sprintf("**%d CORS pre-check(s) on a warm load** (%d cold) — the API keeps a pre-check "+
			"7200 s (backend/cmd/app_development/service_api.go, backlog #127), so a warm load should ask none: one "+
			"asked here is a request shape or header the cold load did not pre-check. *Fix:* read the load's "+
			"`preflights` in the run folder's results.json.", m.Preflights, m.ColdPreflights))
	}

	var heavy []string

	widest := ""

	for _, t := range m.Typing {
		switch {
		case !typingMeasured(t):
			out = append(out, fmt.Sprintf("**Typing into the %s was not measured** — %s. *Fix:* the audit's typing "+
				"script for this screen (tools/san/audit_frontend_screens.go).", t.Field, t.Error))
		case t.ComponentsPerKey >= auditTypingHeavy:
			heavy = append(heavy, fmt.Sprintf("the %s %s (%s commit(s))", t.Field, fmtCount(t.ComponentsPerKey),
				fmtCount(t.CommitsPerKey)))

			if widest == "" && len(t.Starts) > 0 {
				widest = startsText(t.Starts, 1)
			}
		}

		if typingMeasured(t) && t.Trailing > 0 {
			out = append(out, fmt.Sprintf("**%d commit(s) after the typing stops** in the %s — a read keyed by the "+
				"field (a quote, a picker search) or a debounced one answering once the person paused, its answer "+
				"drawn. Expected where the field searches or prices; anywhere else it is a re-render nothing asked "+
				"for.", t.Trailing, t.Field))
		}
	}

	if len(heavy) > 0 {
		start := ""
		if widest != "" {
			start = ", the widest re-render starting at " + widest
		}

		out = append(out, fmt.Sprintf("**Each keystroke re-renders the form, not the field** — components per keystroke: "+
			"%s%s (the Typing table names the rest). *Fix:* hold the form in one useReducer and pass each card only its "+
			"slice, memoised, so a key re-renders the card it is in (no-global-store-every-read-is-a-query-hook — a "+
			"many-field form is one useReducer). *Trade-off:* the cards take props they compare, and a callback passed "+
			"down needs a stable identity.", strings.Join(heavy, ", "), start))
	}

	if def.Note != "" {
		out = append(out, "**What the code does** — "+def.Note)
	}

	return out
}

// screenMarkdown is audits/frontend/<screen>.md — the house format of audits/services/*/performances/*.md.
func screenMarkdown(m auditMeasure, def auditScreenDef, facts auditRunFacts) string {
	var b strings.Builder

	w := func(format string, a ...any) { fmt.Fprintf(&b, format, a...) }

	w("# %s — frontend speed audit\n\n", m.Screen)
	w("Written by `go run ./tools/san audit frontend --baseline` ([frontend-speed-is-measured-by-a-dev-tool]"+
		"(../../docs/development_lifecycle_decision.md#frontend-speed-is-measured-by-a-dev-tool)). Rows: %s. "+
		"Page `frontend/src/pages/%s`, route `%s`, opened as **%s**.\n\n", def.Rows, def.Page, def.Route, def.Role)
	w("**Verdict:** %s\n\n", verdictOf(m))

	machine := "quiet machine"
	if facts.CountsOnly {
		// Which run, where, is the run folder's (summary.md) — a committed file says only that one was live.
		machine = "NOISY — counts only, a full e2e run was live beside it; times recorded, not judged"
	}

	dirty := ""
	if facts.SrcDirty > 0 {
		dirty = fmt.Sprintf(" + %d uncommitted file(s)", facts.SrcDirty)
	}

	typed := ""
	if len(m.Typing) > 0 {
		typed = fmt.Sprintf(" · typing %d pass(es) a field", auditTypingPasses)
	}

	w("**Measured:** %s · `frontend/src` tree `%s`%s · production build `%s` (`vite build` + `vite preview`) · seed %s · "+
		"1 cold + %d warm load(s)%s · %s.\n\n", facts.Date, facts.SrcTree, dirty, facts.Build, facts.Seed, m.WarmLoads, typed,
		machine)

	w("| measure | value |\n| --- | --- |\n")
	w("| requests per load (warm) | %d — shell %d · screen %d |\n", m.RequestsShell+m.RequestsScreen, m.RequestsShell,
		m.RequestsScreen)
	w("| requests, cold load | %d |\n", m.ColdRequests)
	w("| same RPC asked twice | %d%s |\n", m.Duplicates, listOrEmpty(shortAll(m.DuplicateOf)))
	w("| CORS pre-checks (OPTIONS) | %d warm · %d cold |\n", m.Preflights, m.ColdPreflights)
	passes := ""
	if len(m.ChainDepths) > 1 {
		passes = " (" + depthsText(m.ChainDepths) + " over " + fmt.Sprint(len(m.ChainDepths)) + " dependency passes)"
	}

	w("| waiting chain (%s) | depth %d%s%s |\n", m.ChainMethod, m.ChainDepth, passes, listOrEmpty([]string{chainsText(m)}))

	usable := "never within 15 s"
	if m.UsableMS.N > 0 {
		usable = fmt.Sprintf("%.0f ms median (%.0f–%.0f, %d warm)", m.UsableMS.Median, m.UsableMS.Min, m.UsableMS.Max,
			m.UsableMS.N)
	}

	if facts.CountsOnly {
		usable += " — noisy"
	}

	w("| time until usable | %s · cold %.0f ms |\n", usable, m.ColdUsableMS)
	w("| counts agree across warm loads | %s |\n", yesNo(m.CountsAgree, strings.Join(shortAll(m.Unstable), ", ")))

	if m.AfterSave != nil {
		w("| requests after one save | %d — %s (%s)%s |\n", m.AfterSave.Count, m.AfterSave.Verdict, m.AfterSave.Name,
			listOrEmpty(shortAll(m.AfterSave.RPCs)))
	} else {
		w("| requests after one save | — no save measured |\n")
	}

	for _, p := range m.Probes {
		w("| %s | %d request(s)%s |\n", p.Name, p.Count, listOrEmpty(methodCounts(p.ByMethod)))
	}

	for _, t := range m.Typing {
		if !typingMeasured(t) {
			w("| typing: %s (`%s`) | not measured — %s |\n", t.Field, t.TestID, t.Error)

			continue
		}

		w("| typing: %s (`%s`, %d keys) | %s |\n", t.Field, t.TestID, t.Keys, typingText(t))
	}

	w("\n## Requests\n\nThe reference warm load, every Connect call: how many times, its wave in the waiting chain (1 = " +
		"fired at once), and whether one was a duplicate.\n\n| RPC | count | wave | duplicate |\n| --- | --- | --- | --- |\n")

	dups := map[string]bool{}
	for _, d := range m.DuplicateOf {
		dups[d] = true
	}

	for _, k := range sortedKeys(m.ShellByMethod) {
		w("| `%s` | %d | shell | %s |\n", k, m.ShellByMethod[k], map[bool]string{true: "✗ yes", false: ""}[dups[k]])
	}

	for _, k := range sortedKeys(m.ByMethod) {
		var waves []string
		for _, d := range m.Waves[k] {
			waves = append(waves, fmt.Sprint(d))
		}

		w("| `%s` | %d | %s | %s |\n", k, m.ByMethod[k], strings.Join(waves, " · "),
			map[bool]string{true: "✗ yes", false: ""}[dups[k]])
	}

	if m.AfterSave != nil && len(m.AfterSave.RPCs) > 0 {
		w("\nAfter the save (`%s`), in the order they fired: %s.", shortMethod(m.AfterSave.RPC),
			strings.Join(shortAll(m.AfterSave.RPCs), " · "))

		if m.AfterSave.URLAfter != "" {
			w(" The save navigated to `%s` — that screen's load is counted here.", pathOf(m.AfterSave.URLAfter))
		}

		w("\n")
	}

	if len(m.Typing) > 0 {
		w("\n## Typing\n\nWhat React draws while a person types (P2): each field typed %d time(s) on a fresh load, its keys "+
			"pressed one by one with two animation frames after each, then %d ms of quiet for the trailing commits. "+
			"Commits and components are per keystroke (the median); a figure like `1·2` is two passes that disagree. "+
			"The components are named by the audit's build (`esbuild.keepNames`), their renders summed over the keys "+
			"and the quiet: where each re-render STARTS (a component that rendered while the one above it did not — "+
			"its state, or a context it reads, changed), then the app's own components (declared in frontend/src) "+
			"and every component, Chakra's and emotion's internals included, rendered most.\n\n"+
			"| field | keys | commits/key | components/key | trailing | re-renders start at | the app's, most | every, most |\n"+
			"| --- | --- | --- | --- | --- | --- | --- | --- |\n", auditTypingPasses, auditTypingWaitMS)

		for _, t := range m.Typing {
			if !typingMeasured(t) {
				w("| %s (`%s`) | — | — | — | — | — | — | not measured: %s |\n", t.Field, t.TestID, t.Error)

				continue
			}

			w("| %s (`%s`) | %d | %s | %s | %s | %s | %s | %s |\n", t.Field, t.TestID, t.Keys,
				valuesText(typingValues(t, typingCommits)), valuesText(typingValues(t, typingComponents)),
				valuesText(typingValues(t, typingTrailing)), startsText(t.Starts, 5), topText(t.App, 5),
				topText(t.Top, 5))
		}
	}

	w("\n## Findings\n\nA discussion document (audits/README.md): acting on one is a separate, explicitly-asked task.\n\n")

	for i, f := range findingsOf(m, def) {
		w("%d. %s\n", i+1, f)
	}

	w("\n## History\n\n| Date | requests | dup | chain | usable ms | after save | commits/key | change |\n" +
		"| --- | --- | --- | --- | --- | --- | --- | --- |\n")

	for _, h := range m.History {
		usable := fmt.Sprintf("%.0f", h.UsableMS)
		if h.Noisy {
			usable += " (noisy)"
		}

		after := "—"
		if h.AfterSave >= 0 {
			after = fmt.Sprint(h.AfterSave)
		}

		typing := "—"
		if h.Typing != "" {
			typing = h.Typing
		}

		w("| %s | %d | %d | %d | %s | %s | %s | %s |\n", h.Date, h.Requests, h.Dup, h.Chain, usable, after, typing, h.Change)
	}

	return b.String()
}

func sortedKeys(m map[string]int) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}

	sort.Strings(keys)

	return keys
}

func listOrEmpty(xs []string) string {
	var keep []string

	for _, x := range xs {
		if x != "" {
			keep = append(keep, x)
		}
	}

	if len(keep) == 0 {
		return ""
	}

	return " — " + strings.Join(keep, " · ")
}

func yesNo(ok bool, differ string) string {
	if ok {
		return "yes"
	}

	return "NO — " + differ
}

func methodCounts(m map[string]int) []string {
	var out []string
	for k, n := range m {
		out = append(out, fmt.Sprintf("%s ×%d", shortMethod(k), n))
	}

	sort.Strings(out)

	return out
}

func pathOf(url string) string {
	i := strings.Index(url, "://")
	if i < 0 {
		return url
	}

	j := strings.Index(url[i+3:], "/")
	if j < 0 {
		return "/"
	}

	return url[i+3+j:]
}

// auditSummaryLine is a screen's one line in the terminal and the run's summary.md.
func auditSummaryLine(m auditMeasure) string {
	usable := "never usable"
	if m.UsableMS.N > 0 {
		usable = fmt.Sprintf("usable %.0f ms (%.0f–%.0f)", m.UsableMS.Median, m.UsableMS.Min, m.UsableMS.Max)
		if m.Noisy {
			usable += " noisy"
		}
	}

	after := ""
	if m.AfterSave != nil {
		after = fmt.Sprintf(" · after save %d (%s)", m.AfterSave.Count, m.AfterSave.Verdict)
	}

	chain := fmt.Sprintf("chain %d", m.ChainDepth)
	if len(m.ChainDepths) > 1 && depthsText(m.ChainDepths) != fmt.Sprint(m.ChainDepth) {
		chain = "chain " + depthsText(m.ChainDepths) + " (the passes disagree)"
	}

	if m.ChainDepth > 1 {
		chain += " (" + chainsText(m) + ")"
	}

	agree := ""
	if !m.CountsAgree {
		agree = " · COUNTS DIFFER " + strings.Join(shortAll(m.Unstable), ",")
	}

	var typed []string
	for _, t := range m.Typing {
		typed = append(typed, t.Field+" "+typingShort(t))
	}

	typing := ""
	if len(typed) > 0 {
		typing = " · typing (commits/components per key, trailing) " + strings.Join(typed, ", ")
	}

	return fmt.Sprintf("%s: requests %d (shell %d · screen %d) · dup %d · pre-checks %d · %s · %s%s%s%s",
		m.Screen, m.RequestsShell+m.RequestsScreen, m.RequestsShell, m.RequestsScreen, m.Duplicates, m.Preflights, chain,
		usable, after, typing, agree)
}

// auditDate is today in Jakarta.
func auditDate() string {
	return time.Now().In(jakartaLocation()).Format("2006-01-02")
}
