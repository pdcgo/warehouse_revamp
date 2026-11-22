package main

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

// THE TYPING MEASURES (P2, backlog #125, frontend_speed_scoping.md §4 "Re-renders" and "Typing") — what React does
// while a person types into a big form. The driver (run.mjs, typingPass) only RECORDS, per field and pass: every
// keydown's time on the page's clock, the time the last key's two animation frames ended, the end of the quiet after
// it, and every React commit in that span with its time and the components it rendered, by name (a stub
// __REACT_DEVTOOLS_GLOBAL_HOOK__ in a browser context of its own; names kept by the audit's build). Counted here:
//
//	commits per keystroke      the commits from a keydown up to the next one (the last key: up to its frames' end),
//	                           the MEDIAN over the keys
//	components per keystroke   the components those commits rendered, summed per keystroke — the median
//	trailing commits           the commits in the quiet after the last key's frames (auditTypingWaitMS): a debounced
//	                           read firing and its answer drawn after the person stopped
//	top re-renderers           the components that rendered most over the keys and the quiet, by name
//
// Every field is typed auditTypingPasses times; the headline figures are the first pass's, and the verdict judges a
// typing count only when it holds in every pass (judgeTyping — the every-run rule the chain already follows).

// The typing measures, as the verdict and the md name them.
const (
	typingCommits    = "commits/key"
	typingComponents = "components/key"
	typingTrailing   = "trailing commits"
)

// auditTypingTop is how many re-rendering components the md names per field.
const auditTypingTop = 8

// auditTypingHeavy is the components per keystroke from which a field's typing is a finding (the md's discussion
// list) *(build default)*: the whole form, not the field, re-rendering on every key.
const auditTypingHeavy = 50

// ── what the driver records ───────────────────────────────────────────────────────────────────────

// auditRawCommit is one React commit while recording: its time on the page's clock, the components it rendered, and
// where each re-render started — Roots[name] is [the re-renders that started at a component of that name, the
// components they drew, itself included]; a start is a component that rendered while its nearest component above
// did not.
type auditRawCommit struct {
	T     float64          `json:"t"`
	N     int              `json:"n"`
	Names map[string]int   `json:"names,omitempty"`
	Roots map[string][]int `json:"roots,omitempty"`
	Error string           `json:"error,omitempty"`
}

// auditRawTyping is one pass of one field.
type auditRawTyping struct {
	Field   string           `json:"field"`
	TestID  string           `json:"testid"`
	Pass    int              `json:"pass"`
	Keys    []float64        `json:"keys"`    // each keydown's time (ms, the page's clock)
	Settled []float64        `json:"settled"` // the time each key's two animation frames ended
	End     float64          `json:"end"`     // the end of the quiet after the last key
	Commits []auditRawCommit `json:"commits"`
	Hooked  bool             `json:"hooked"` // React injected itself into the audit's hook
	Error   string           `json:"error,omitempty"`
}

// ── the figures ───────────────────────────────────────────────────────────────────────────────────

// auditTypingPass is one pass's figures.
type auditTypingPass struct {
	CommitsPerKey    float64 `json:"commits_per_key"`
	ComponentsPerKey float64 `json:"components_per_key"`
	Trailing         int     `json:"trailing"`
}

// auditRenderCount is a component and how often it rendered.
type auditRenderCount struct {
	Name    string `json:"name"`
	Renders int    `json:"renders"`
}

// auditStart is where re-renders started: a component's name, how many re-renders started there, and how many
// components they drew in all.
type auditStart struct {
	Name    string `json:"name"`
	Starts  int    `json:"starts"`
	Renders int    `json:"renders"`
}

// auditTyping is one field's typing figures — part of its screen's baseline.json entry.
type auditTyping struct {
	Field            string            `json:"field"`
	TestID           string            `json:"testid"`
	Keys             int               `json:"keys"`
	CommitsPerKey    float64           `json:"commits_per_key"`
	ComponentsPerKey float64           `json:"components_per_key"`
	Trailing         int               `json:"trailing"`
	Passes           []auditTypingPass `json:"passes,omitempty"` // every pass's figures, the headline's first
	// Starts are where the re-renders START (the headline pass), the widest first: a component that rendered while
	// its nearest component above did not — its own state, or a context it reads, changed. Top are the components
	// rendered most, Chakra's and emotion's internals included; App the app's own among them — the components
	// frontend/src declares (appComponentNames).
	Starts []auditStart       `json:"starts,omitempty"`
	Top    []auditRenderCount `json:"top,omitempty"`
	App    []auditRenderCount `json:"app,omitempty"`
	Error  string             `json:"error,omitempty"`
}

// typingCounts are one pass's counts: the commits and the components rendered per keystroke, and the trailing
// commits. A commit belongs to the last keydown at or before it, up to the last key's frames' end; after that, up to
// the end of the quiet, it trails. A commit before the first key is not the typing's.
func typingCounts(raw auditRawTyping) ([]int, []int, int) {
	n := len(raw.Keys)
	if n == 0 {
		return nil, nil, 0
	}

	last := raw.Keys[n-1]
	if len(raw.Settled) > 0 && raw.Settled[len(raw.Settled)-1] > last {
		last = raw.Settled[len(raw.Settled)-1]
	}

	commits := make([]int, n)
	components := make([]int, n)
	trailing := 0

	for _, c := range raw.Commits {
		if c.T < raw.Keys[0] {
			continue
		}

		if c.T > last {
			if raw.End == 0 || c.T <= raw.End {
				trailing++
			}

			continue
		}

		i := sort.Search(n, func(k int) bool { return raw.Keys[k] > c.T }) - 1
		commits[i]++
		components[i] += c.N
	}

	return commits, components, trailing
}

// medianInts is the median of xs (the mean of the two middle values when there is an even number).
func medianInts(xs []int) float64 {
	if len(xs) == 0 {
		return 0
	}

	s := append([]int(nil), xs...)
	sort.Ints(s)

	if len(s)%2 == 1 {
		return float64(s[len(s)/2])
	}

	return float64(s[len(s)/2-1]+s[len(s)/2]) / 2
}

// topRenderers are the components that rendered most from the first key to the end of the quiet — most first, a tie
// by name.
func topRenderers(raw auditRawTyping, n int) []auditRenderCount {
	return topRenderersOf(raw, n, nil)
}

// topRenderersOf is topRenderers over the names keep says yes to (nil: every name).
func topRenderersOf(raw auditRawTyping, n int, keep func(string) bool) []auditRenderCount {
	if len(raw.Keys) == 0 {
		return nil
	}

	sum := map[string]int{}

	for _, c := range typingSpan(raw) {
		for name, k := range c.Names {
			if keep == nil || keep(name) {
				sum[name] += k
			}
		}
	}

	out := make([]auditRenderCount, 0, len(sum))
	for name, k := range sum {
		out = append(out, auditRenderCount{Name: name, Renders: k})
	}

	sort.Slice(out, func(a, b int) bool {
		if out[a].Renders != out[b].Renders {
			return out[a].Renders > out[b].Renders
		}

		return out[a].Name < out[b].Name
	})

	if len(out) > n {
		out = out[:n]
	}

	return out
}

// topStarts are where the re-renders started, from the first key to the end of the quiet — the ones that drew the
// most components first (a page's state re-rendering the whole form outranks a hundred one-component context
// updates), a tie by name.
func topStarts(raw auditRawTyping, n int) []auditStart {
	sum := map[string]*auditStart{}

	for _, c := range typingSpan(raw) {
		for name, v := range c.Roots {
			if len(v) < 2 {
				continue
			}

			s := sum[name]
			if s == nil {
				s = &auditStart{Name: name}
				sum[name] = s
			}

			s.Starts += v[0]
			s.Renders += v[1]
		}
	}

	out := make([]auditStart, 0, len(sum))
	for _, s := range sum {
		out = append(out, *s)
	}

	sort.Slice(out, func(a, b int) bool {
		if out[a].Renders != out[b].Renders {
			return out[a].Renders > out[b].Renders
		}

		return out[a].Name < out[b].Name
	})

	if len(out) > n {
		out = out[:n]
	}

	return out
}

// typingSpan are a pass's commits from its first key to the end of the quiet.
func typingSpan(raw auditRawTyping) []auditRawCommit {
	if len(raw.Keys) == 0 {
		return nil
	}

	var out []auditRawCommit

	for _, c := range raw.Commits {
		if c.T < raw.Keys[0] || raw.End > 0 && c.T > raw.End {
			continue
		}

		out = append(out, c)
	}

	return out
}

// typingProblem says why a pass cannot be counted ("" — it can).
func typingProblem(raw auditRawTyping) string {
	switch {
	case raw.Error != "":
		return raw.Error
	case !raw.Hooked:
		return "React never attached to the audit's hook (run.mjs, installRenderHook)"
	case len(raw.Keys) == 0:
		return "no keystroke reached the page"
	}

	for _, c := range raw.Commits {
		if c.Error != "" {
			return "walking a commit's tree: " + c.Error
		}
	}

	return ""
}

// measureTyping turns the typing passes the driver recorded into each field's figures, in the screen's field order.
func measureTyping(raws []auditRawTyping, fields []auditTypingField) []auditTyping {
	var whole string // the pass broke before any field (the driver's typingPass)

	for _, r := range raws {
		if r.Field == "" && r.Error != "" {
			whole = r.Error
		}
	}

	var out []auditTyping

	for _, f := range fields {
		t := auditTyping{Field: f.Name, TestID: f.TestID}

		for _, r := range raws {
			if r.Field != f.Name {
				continue
			}

			problem := typingProblem(r)
			if problem != "" {
				if t.Error == "" {
					t.Error = fmt.Sprintf("pass %d: %s", r.Pass+1, problem)
				}

				continue
			}

			commits, components, trailing := typingCounts(r)
			p := auditTypingPass{CommitsPerKey: medianInts(commits), ComponentsPerKey: medianInts(components),
				Trailing: trailing}

			if len(t.Passes) == 0 {
				t.Keys = len(r.Keys)
				t.CommitsPerKey = p.CommitsPerKey
				t.ComponentsPerKey = p.ComponentsPerKey
				t.Trailing = p.Trailing
				t.Top = topRenderers(r, auditTypingTop)
				t.Starts = topStarts(r, auditTypingTop)
			}

			t.Passes = append(t.Passes, p)
		}

		if len(t.Passes) == 0 && t.Error == "" {
			t.Error = "the driver typed nothing into it"
			if whole != "" {
				t.Error = whole
			}
		}

		out = append(out, t)
	}

	return out
}

// ── the app's own components ──────────────────────────────────────────────────────────────────────

// auditAppComponentRe finds a component frontend/src declares: a capitalised function, or a capitalised const assigned
// at the start of a line (`export function OrderCreatePage(`, `const LineRow = memo(`).
var auditAppComponentRe = regexp.MustCompile(
	`(?m)^[ \t]*(?:export[ \t]+)?(?:default[ \t]+)?(?:function[ \t]+([A-Z][A-Za-z0-9_]*)[ \t]*[<(]|const[ \t]+([A-Z][A-Za-z0-9_]*)[ \t]*(?::[^=\n]+)?=)`)

// appComponentNames are the component names frontend/src declares in its .tsx files (stories and tests left out; an
// ALL-CAPS const is a constant, not a component). A typing line names these apart from Chakra's and emotion's
// internals: the app's component that re-renders on every key is where the re-render starts.
func appComponentNames(root string) map[string]bool {
	names := map[string]bool{}

	_ = filepath.WalkDir(filepath.Join(root, "frontend", "src"), func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}

		base := d.Name()
		if !strings.HasSuffix(base, ".tsx") || strings.Contains(base, ".stories.") || strings.Contains(base, ".test.") {
			return nil
		}

		b, err := os.ReadFile(path)
		if err != nil {
			return nil
		}

		for _, m := range auditAppComponentRe.FindAllStringSubmatch(string(b), -1) {
			name := m[1] + m[2]
			if strings.ToUpper(name) != name {
				names[name] = true
			}
		}

		return nil
	})

	return names
}

// firstCounted is a field's first pass that can be counted — the headline's.
func firstCounted(raws []auditRawTyping, field string) (auditRawTyping, bool) {
	for _, r := range raws {
		if r.Field == field && typingProblem(r) == "" {
			return r, true
		}
	}

	return auditRawTyping{}, false
}

// withAppRenderers fills each field's App — the app's own components among its headline pass's renders.
func withAppRenderers(ts []auditTyping, raws []auditRawTyping, app map[string]bool) {
	for i := range ts {
		raw, ok := firstCounted(raws, ts[i].Field)
		if !ok {
			continue
		}

		ts[i].App = topRenderersOf(raw, auditTypingTop, func(name string) bool { return app[name] })
	}
}

// renderersText names a field's re-renders for a verdict line or a finding: where they start, then the app's own
// components rendered most (or every component's, when no app name was found).
func renderersText(t auditTyping, n int) string {
	most := topText(t.App, n)
	if most == "" {
		most = topText(t.Top, n)
	}

	if len(t.Starts) == 0 {
		return most
	}

	return "start at " + startsText(t.Starts, n) + "; most " + most
}

// ── reading the figures ───────────────────────────────────────────────────────────────────────────

// typingValues are one measure's value in every pass (the headline alone when no pass was kept).
func typingValues(t auditTyping, measure string) []float64 {
	passes := t.Passes
	if len(passes) == 0 {
		passes = []auditTypingPass{{CommitsPerKey: t.CommitsPerKey, ComponentsPerKey: t.ComponentsPerKey,
			Trailing: t.Trailing}}
	}

	out := make([]float64, len(passes))

	for i, p := range passes {
		switch measure {
		case typingCommits:
			out[i] = p.CommitsPerKey
		case typingComponents:
			out[i] = p.ComponentsPerKey
		default:
			out[i] = float64(p.Trailing)
		}
	}

	return out
}

// typingWorse says whether now is worse than was by the measure's threshold (scoping §6): commits per keystroke and
// trailing commits +1 or more; components per keystroke +25 % (and more than before).
func typingWorse(measure string, was, now float64) bool {
	if measure == typingComponents {
		return now > was && now >= was*1.25
	}

	return now >= was+1
}

// typingMeasured says whether a field's figures can be compared.
func typingMeasured(t auditTyping) bool {
	return t.Keys > 0 || len(t.Passes) > 0
}

// typingField finds a field's figures by name.
func typingField(ts []auditTyping, field string) (auditTyping, bool) {
	for _, t := range ts {
		if t.Field == field {
			return t, true
		}
	}

	return auditTyping{}, false
}

// typingChanges lists what moved past a threshold between a field's baseline figures and its new ones (the headline
// figures — the verdict judges every pass: judgeTyping). Fields new to the screen, or unmeasured on either side, are
// left out.
func typingChanges(base, now []auditTyping) []auditChange {
	var out []auditChange

	for _, n := range now {
		b, ok := typingField(base, n.Field)
		if !ok || !typingMeasured(b) || !typingMeasured(n) {
			continue
		}

		pairs := []struct {
			measure  string
			was, now float64
		}{
			{typingCommits, b.CommitsPerKey, n.CommitsPerKey},
			{typingComponents, b.ComponentsPerKey, n.ComponentsPerKey},
			{typingTrailing, float64(b.Trailing), float64(n.Trailing)},
		}

		for _, p := range pairs {
			if typingWorse(p.measure, p.was, p.now) {
				out = append(out, auditChange{Kind: auditChangeCount, Measure: "typing " + n.Field + " · " + p.measure,
					Was: fmtCount(p.was), Now: fmtCount(p.now), Note: renderersText(n, 3)})
			}
		}
	}

	return out
}

// judgeTyping is a screen's typing lines, by the every-run rule: a measure is worse (FIX) only when every pass now
// reads worse than every pass of the baseline by its threshold, better only when every pass reads better, and
// `unstable` when some passes cross a threshold and others do not.
func judgeTyping(m, b auditMeasure) []auditVerdictLine {
	var out []auditVerdictLine

	for _, n := range m.Typing {
		measure := "typing " + n.Field

		if !typingMeasured(n) {
			out = append(out, auditVerdictLine{Kind: auditVerdictUnmeasure, Screen: m.Screen, Measure: measure,
				Says: n.Error})

			continue
		}

		was, ok := typingField(b.Typing, n.Field)
		if !ok || !typingMeasured(was) {
			out = append(out, auditVerdictLine{Kind: auditVerdictNoBase, Screen: m.Screen, Measure: measure,
				Now: typingText(n), Says: "not in audits/frontend/baseline.json: nothing to compare (take it with " +
					"--screen " + m.Screen + " --baseline)"})

			continue
		}

		for _, k := range []string{typingCommits, typingComponents, typingTrailing} {
			kind, says := judgeTypingCount(k, typingValues(was, k), typingValues(n, k))
			if kind == "" {
				continue
			}

			out = append(out, auditVerdictLine{Kind: kind, Screen: m.Screen, Measure: measure + " · " + k,
				Was: valuesText(typingValues(was, k)), Now: valuesText(typingValues(n, k)), Top: renderersText(n, 3),
				Says: says})
		}
	}

	return out
}

// judgeTypingCount is one typing measure's verdict over the passes ("" — no line).
func judgeTypingCount(measure string, was, now []float64) (string, string) {
	wasMin, wasMax := minMaxFloat(was)
	nowMin, nowMax := minMaxFloat(now)

	switch {
	case typingWorse(measure, wasMax, nowMin):
		return auditVerdictFix, auditSaysFix
	case typingWorse(measure, nowMax, wasMin):
		return auditVerdictBetter, auditSaysBetter
	case typingWorse(measure, wasMin, nowMax) || typingWorse(measure, nowMin, wasMax):
		return auditVerdictUnstable, "the typing passes disagree — " + auditSaysUnstable
	}

	return "", ""
}

func minMaxFloat(xs []float64) (float64, float64) {
	if len(xs) == 0 {
		return 0, 0
	}

	lo, hi := xs[0], xs[0]

	for _, x := range xs[1:] {
		lo = min(lo, x)
		hi = max(hi, x)
	}

	return lo, hi
}

// fmtCount is a count or a median without a needless ".0".
func fmtCount(x float64) string {
	return strconv.FormatFloat(x, 'f', -1, 64)
}

// valuesText is "2" for one reading or passes that agree, "2·3" for passes that do not.
func valuesText(xs []float64) string {
	lo, hi := minMaxFloat(xs)
	if lo == hi {
		return fmtCount(lo)
	}

	parts := make([]string, len(xs))
	for i, x := range xs {
		parts[i] = fmtCount(x)
	}

	return strings.Join(parts, "·")
}

// typingText is a field's figures in one phrase: "1 commit · 45 components per keystroke · 0 trailing".
func typingText(t auditTyping) string {
	if !typingMeasured(t) {
		return "not measured — " + t.Error
	}

	return fmt.Sprintf("%s commit(s) · %s components per keystroke · %d trailing", valuesText(typingValues(t, typingCommits)),
		valuesText(typingValues(t, typingComponents)), t.Trailing)
}

// typingShort is a field's figures as "c/k/t" (commits and components per keystroke, trailing commits).
func typingShort(t auditTyping) string {
	if !typingMeasured(t) {
		return "not measured"
	}

	return fmt.Sprintf("%s/%s/%d", fmtCount(t.CommitsPerKey), fmtCount(t.ComponentsPerKey), t.Trailing)
}

// startsText names where the re-renders started: "OrderCreatePage ×10 (3826 a time)" — how many started there, and
// the components each drew on average.
func startsText(starts []auditStart, n int) string {
	var parts []string

	for i, s := range starts {
		if i == n {
			break
		}

		each := 0
		if s.Starts > 0 {
			each = (s.Renders + s.Starts/2) / s.Starts
		}

		parts = append(parts, fmt.Sprintf("%s ×%d (%d a time)", s.Name, s.Starts, each))
	}

	return strings.Join(parts, ", ")
}

// topText names the first n re-rendering components: "OrderCreatePage ×10, Field ×40".
func topText(top []auditRenderCount, n int) string {
	var parts []string

	for i, r := range top {
		if i == n {
			break
		}

		parts = append(parts, fmt.Sprintf("%s ×%d", r.Name, r.Renders))
	}

	return strings.Join(parts, ", ")
}

// typingHistory is a History row's commits/key cell: each field's commits per keystroke.
func typingHistory(ts []auditTyping) string {
	var parts []string

	for _, t := range ts {
		v := "—"
		if typingMeasured(t) {
			v = fmtCount(t.CommitsPerKey)
		}

		parts = append(parts, t.Field+" "+v)
	}

	return strings.Join(parts, " · ")
}
