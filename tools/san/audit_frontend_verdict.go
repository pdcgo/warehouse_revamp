package main

import (
	"fmt"
	"sort"
	"strings"
)

// THE LEVEL 2 VERDICT (backlog #124) — `--files`' comparison with audits/frontend/baseline.json, by the owner's
// a-slice-fixes-the-speed-regression-it-caused. frontendChanges (P1) lists what moved and decides nothing; this
// decides, per change:
//
//	FIX        a COUNT the slice made worse — requests per load, a new duplicate, a deeper waiting chain, more requests
//	           (or a listed read missing) after the save, more commits or components per keystroke or more trailing
//	           commits while typing (P2): fixed in the slice, before its snapshot
//	timing     the time until usable slower on a quiet machine: reported, not to fix (timings move with the CPU)
//	noisy      slower, but on a noisy machine or with a wide spread: not a change
//	already    a problem the baseline already has (a duplicate, a chain 3+ deep, a stale or storming save, counts
//	           differing between loads), still there: reported, never fixed unasked (audits/README.md)
//	better     a count the slice made better
//	unstable   a count that does not hold in every run of the measurement: not judged, not to fix (below)
//
// THE UNSTABLE-CHAIN RULE — a count is judged only when it holds in every run of the measurement:
//   - a waiting chain is judged on EVERY dependency pass (the driver runs auditDepPasses of them): worse only when
//     every pass now reads deeper than every pass of the baseline, better only when every pass reads shallower — a
//     move some passes read and others do not is `unstable`. A baseline taken with one pass is one reading;
//   - a move of one level whose deeper side's every chain runs through a link the screen declares unstable
//     (auditScreenDef.UnstableLinks — order-create's TeamList → WarehouseReceivingStatus, seen flipping 1 ↔ 2 between
//     runs) is `unstable` however the passes agree: two passes can agree by chance;
//   - requests per load are judged on every warm load: a method that grew but differs between warm loads (the
//     measure's Unstable) is `unstable`;
//   - a typing count (commits and components per keystroke, trailing commits — P2) is judged on every typing pass
//     (auditTypingPasses): worse only when every pass now reads worse than every baseline pass by its threshold
//     (+1, +25 %, +1), better only when every pass reads better, `unstable` when the passes straddle a threshold.
//
// The tool asserts nothing: whatever the verdict, a completed measurement exits 0 *(build default)*.

// The verdict kinds, as printed.
const (
	auditVerdictFix       = "FIX"
	auditVerdictTiming    = "timing"
	auditVerdictNoisy     = "noisy"
	auditVerdictAlready   = "already"
	auditVerdictBetter    = "better"
	auditVerdictUnstable  = "unstable"
	auditVerdictNoBase    = "no base"
	auditVerdictUnmeasure = "not measured"
)

const (
	auditSaysFix      = "a count this slice made worse: fix it in this slice, before its snapshot"
	auditSaysTiming   = "slower, counts unchanged: reported, not to fix — timings move with the CPU"
	auditSaysAlready  = "already in the baseline: reported, never fixed unasked"
	auditSaysBetter   = "better"
	auditSaysUnstable = "does not hold in every run of the measurement: not judged, not to fix"
)

// auditVerdictLine is one change of the verdict.
type auditVerdictLine struct {
	Kind    string `json:"kind"`
	Screen  string `json:"screen"`
	Measure string `json:"measure,omitempty"`
	Was     string `json:"was,omitempty"`
	Now     string `json:"now,omitempty"`
	RPCs    string `json:"rpcs,omitempty"`
	Top     string `json:"top,omitempty"` // a typing line's most re-rendered components
	Says    string `json:"says"`
}

func (l auditVerdictLine) String() string {
	s := fmt.Sprintf("  %-9s %s", l.Kind, l.Screen)

	if l.Measure != "" {
		s += " · " + l.Measure
	}

	switch {
	case l.Was != "":
		s += " " + l.Was + " → " + l.Now
	case l.Now != "":
		s += " " + l.Now
	}

	if l.RPCs != "" {
		s += " · RPCs " + l.RPCs
	}

	if l.Top != "" {
		s += " · re-renders " + l.Top
	}

	return s + " — " + l.Says
}

// auditVerdict is the summary line and one line per change.
type auditVerdict struct {
	Summary string             `json:"summary"`
	Lines   []auditVerdictLine `json:"lines"`
}

func (v auditVerdict) String() string {
	var b strings.Builder

	b.WriteString(v.Summary + "\n")

	for _, l := range v.Lines {
		b.WriteString(l.String() + "\n")
	}

	return b.String()
}

// judgeAudit is the verdict over the measured screens.
func judgeAudit(measured []auditMeasure, base map[string]auditMeasure, screens []auditScreenDef) auditVerdict {
	defs := map[string]auditScreenDef{}
	for _, s := range screens {
		defs[s.Name] = s
	}

	var v auditVerdict

	counts := map[string]int{}
	unchanged := 0

	for _, m := range measured {
		lines := judgeScreen(m, base, defs[m.Screen])
		changed := false

		for _, l := range lines {
			counts[l.Kind]++

			if l.Kind != auditVerdictAlready && l.Kind != auditVerdictNoisy {
				changed = true
			}
		}

		if !changed {
			unchanged++
		}

		v.Lines = append(v.Lines, lines...)
	}

	parts := []string{
		fmt.Sprintf("audit: %d screen(s)", len(measured)),
		fmt.Sprintf("%d count(s) worse (fix)", counts[auditVerdictFix]),
		fmt.Sprintf("%d timing", counts[auditVerdictTiming]),
	}

	for _, k := range []struct{ kind, label string }{
		{auditVerdictBetter, "better"}, {auditVerdictAlready, "already there"}, {auditVerdictUnstable, "unstable"},
		{auditVerdictNoisy, "noisy"}, {auditVerdictNoBase, "no baseline"}, {auditVerdictUnmeasure, "not measured"},
	} {
		if counts[k.kind] > 0 {
			parts = append(parts, fmt.Sprintf("%d %s", counts[k.kind], k.label))
		}
	}

	parts = append(parts, fmt.Sprintf("%d unchanged", unchanged))
	v.Summary = strings.Join(parts, " · ")

	return v
}

// judgeScreen is one screen's lines.
func judgeScreen(m auditMeasure, base map[string]auditMeasure, def auditScreenDef) []auditVerdictLine {
	line := func(kind, measure, was, now, rpcs, says string) auditVerdictLine {
		return auditVerdictLine{Kind: kind, Screen: m.Screen, Measure: measure, Was: was, Now: now, RPCs: rpcs, Says: says}
	}

	if m.WarmLoads == 0 {
		return []auditVerdictLine{line(auditVerdictUnmeasure, "", "", "", "", strings.Join(m.Errors, "; "))}
	}

	b, ok := base[m.Screen]
	if !ok {
		return []auditVerdictLine{line(auditVerdictNoBase, "", "", "", "",
			"not in audits/frontend/baseline.json: nothing to compare (take it with --screen "+m.Screen+" --baseline)")}
	}

	var out []auditVerdictLine

	// What frontendChanges lists as worse — the chain is judged by its passes below instead.
	for _, c := range frontendChanges(b, m) {
		switch {
		case c.Measure == "requests":
			grown := grownMethods(b.ByMethod, m.ByMethod)
			if len(grown) > 0 && len(subtract(grown, m.Unstable)) == 0 {
				out = append(out, line(auditVerdictUnstable, "requests", c.Was, c.Now, moreMethods(b.ByMethod, m.ByMethod),
					"the methods that grew differ between warm loads — "+auditSaysUnstable))
			} else {
				out = append(out, line(auditVerdictFix, "requests", c.Was, c.Now, moreMethods(b.ByMethod, m.ByMethod),
					auditSaysFix))
			}
		case c.Measure == "duplicates":
			out = append(out, line(auditVerdictFix, "duplicates", c.Was, c.Now,
				strings.Join(shortAll(m.DuplicateOf), ", "), auditSaysFix))
		case c.Measure == "after save" && strings.HasPrefix(c.Note, "missing"):
			out = append(out, line(auditVerdictFix, "after save, a listed read missing", c.Was, c.Now,
				strings.Join(shortAll(subtract(m.AfterSave.Missing, b.AfterSave.Missing)), ", "), auditSaysFix))
		case c.Measure == "after save":
			out = append(out, line(auditVerdictFix, "requests after the save", c.Was, c.Now,
				moreMethods(b.AfterSave.ByMethod, m.AfterSave.ByMethod), auditSaysFix))
		case c.Measure == "usable":
			out = append(out, line(auditVerdictTiming, "usable", c.Was, c.Now, "", auditSaysTiming))
		case c.Measure == "usable (noisy)":
			out = append(out, line(auditVerdictNoisy, "usable", c.Was, c.Now, "", c.Note))
		}
	}

	out = append(out, judgeChain(m, b, def)...)

	// Typing (P2) — judged on every pass, as the chain is (audit_frontend_typing.go, judgeTyping).
	out = append(out, judgeTyping(m, b)...)

	// Better counts.
	if m.RequestsScreen <= b.RequestsScreen-1 {
		out = append(out, line(auditVerdictBetter, "requests", fmt.Sprint(b.RequestsScreen), fmt.Sprint(m.RequestsScreen),
			fewerMethods(b.ByMethod, m.ByMethod), auditSaysBetter))
	}

	if m.Duplicates < b.Duplicates {
		out = append(out, line(auditVerdictBetter, "duplicates", fmt.Sprint(b.Duplicates), fmt.Sprint(m.Duplicates),
			strings.Join(shortAll(subtract(b.DuplicateOf, m.DuplicateOf)), ", "), auditSaysBetter))
	}

	savedBoth := b.AfterSave != nil && m.AfterSave != nil && b.AfterSave.Sent && m.AfterSave.Sent
	if savedBoth && len(m.AfterSave.Missing) < len(b.AfterSave.Missing) {
		out = append(out, line(auditVerdictBetter, "after save, listed reads missing", fmt.Sprint(len(b.AfterSave.Missing)),
			fmt.Sprint(len(m.AfterSave.Missing)), strings.Join(shortAll(subtract(b.AfterSave.Missing, m.AfterSave.Missing)), ", "),
			auditSaysBetter))
	}

	if savedBoth && m.AfterSave.Count <= b.AfterSave.Count-2 && len(m.AfterSave.Missing) <= len(b.AfterSave.Missing) {
		out = append(out, line(auditVerdictBetter, "requests after the save", fmt.Sprint(b.AfterSave.Count),
			fmt.Sprint(m.AfterSave.Count), fewerMethods(b.AfterSave.ByMethod, m.AfterSave.ByMethod), auditSaysBetter))
	}

	// Problems the baseline already has, still there and no worse.
	if b.Duplicates > 0 && m.Duplicates > 0 && m.Duplicates <= b.Duplicates {
		out = append(out, line(auditVerdictAlready, "duplicates", "", fmt.Sprint(m.Duplicates),
			strings.Join(shortAll(m.DuplicateOf), ", "), auditSaysAlready))
	}

	if b.ChainDepth >= 3 && m.ChainDepth >= 3 && !hasLine(out, "chain") {
		out = append(out, line(auditVerdictAlready, "waiting chain", "", fmt.Sprintf("depth %d", m.ChainDepth),
			chainsText(m), auditSaysAlready))
	}

	if savedBoth && (b.AfterSave.Verdict == "stale?" || b.AfterSave.Verdict == "storm") &&
		m.AfterSave.Verdict == b.AfterSave.Verdict && !hasLine(out, "save") {
		out = append(out, line(auditVerdictAlready, "after the save", "", m.AfterSave.Verdict,
			strings.Join(shortAll(append(append([]string(nil), m.AfterSave.Missing...), m.AfterSave.Twice...)), ", "),
			auditSaysAlready))
	}

	if !b.CountsAgree && !m.CountsAgree {
		out = append(out, line(auditVerdictAlready, "counts differ between warm loads", "", "",
			strings.Join(shortAll(m.Unstable), ", "), auditSaysAlready))
	}

	return out
}

// judgeChain judges the waiting chain on every dependency pass (the unstable-chain rule above).
func judgeChain(m, b auditMeasure, def auditScreenDef) []auditVerdictLine {
	now := passDepthsOf(m)
	was := passDepthsOf(b)
	nowMin, nowMax := minMax(now)
	wasMin, wasMax := minMax(was)

	if nowMin == wasMin && nowMax == wasMax {
		return nil
	}

	l := auditVerdictLine{Screen: m.Screen, Measure: "chain", Was: depthsText(was), Now: depthsText(now)}

	switch {
	case nowMin > wasMax:
		l.RPCs = chainsText(m)

		if nowMin-wasMax == 1 && throughUnstableLink(m.Chains, m.Chain, def.UnstableLinks) {
			l.Kind, l.Says = auditVerdictUnstable, "through a link this screen declares unstable — "+auditSaysUnstable
		} else {
			l.Kind, l.Says = auditVerdictFix, auditSaysFix
		}
	case nowMax < wasMin:
		l.RPCs = chainsText(m)

		if wasMin-nowMax == 1 && throughUnstableLink(b.Chains, b.Chain, def.UnstableLinks) {
			l.Kind, l.Says = auditVerdictUnstable, "the baseline's deeper chain ran through a link this screen declares "+
				"unstable — "+auditSaysUnstable
		} else {
			l.Kind, l.Says = auditVerdictBetter, auditSaysBetter
		}
	default:
		l.RPCs = chainsText(m)
		l.Kind, l.Says = auditVerdictUnstable, "the dependency passes disagree — "+auditSaysUnstable
	}

	return []auditVerdictLine{l}
}

// passDepthsOf is the chain depth each dependency pass read — one reading when only one was recorded.
func passDepthsOf(m auditMeasure) []int {
	if len(m.ChainDepths) > 0 {
		return m.ChainDepths
	}

	return []int{m.ChainDepth}
}

func minMax(xs []int) (int, int) {
	lo, hi := xs[0], xs[0]

	for _, x := range xs[1:] {
		lo = min(lo, x)
		hi = max(hi, x)
	}

	return lo, hi
}

// depthsText is "2" for one reading or passes that agree, "1·2" for passes that do not.
func depthsText(xs []int) string {
	lo, hi := minMax(xs)
	if lo == hi {
		return fmt.Sprint(lo)
	}

	parts := make([]string, len(xs))
	for i, x := range xs {
		parts[i] = fmt.Sprint(x)
	}

	return strings.Join(parts, "·")
}

// throughUnstableLink says whether every chain runs through one of the links (a consecutive from → to pair).
func throughUnstableLink(chains [][]string, chain []string, links [][2]string) bool {
	if len(chains) == 0 && len(chain) > 0 {
		chains = [][]string{chain}
	}

	if len(chains) == 0 || len(links) == 0 {
		return false
	}

	for _, c := range chains {
		found := false

		for i := 1; i < len(c) && !found; i++ {
			for _, l := range links {
				found = found || c[i-1] == l[0] && c[i] == l[1]
			}
		}

		if !found {
			return false
		}
	}

	return true
}

// grownMethods are the methods asked more often now than before.
func grownMethods(was, now map[string]int) []string {
	var out []string

	for k, n := range now {
		if n > was[k] {
			out = append(out, k)
		}
	}

	sort.Strings(out)

	return out
}

// fewerMethods names the methods asked less often now than before (gone ones as ×0).
func fewerMethods(was, now map[string]int) string {
	var parts []string

	for k, n := range was {
		if now[k] < n {
			parts = append(parts, fmt.Sprintf("%s ×%d", shortMethod(k), now[k]))
		}
	}

	sort.Strings(parts)

	return strings.Join(parts, ", ")
}

// hasLine says whether a line about the measure (a word of its name) is already there.
func hasLine(lines []auditVerdictLine, word string) bool {
	for _, l := range lines {
		if strings.Contains(l.Measure, word) {
			return true
		}
	}

	return false
}
