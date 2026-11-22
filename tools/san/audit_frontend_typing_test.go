package main

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
)

// The typing measures' pure parts (audit_frontend_typing.go, P2 #125): which keystroke a commit belongs to, the
// trailing commits, the median, the top re-renderers, the per-field figures over the passes, and the verdict's new
// count lines (the every-pass rule). No browser.

func commit(t float64, n int, names map[string]int) auditRawCommit {
	return auditRawCommit{T: t, N: n, Names: names}
}

// typedPass is one recorded pass: keys at 100, 200, 300 (the last key's frames end at 330, the quiet at 830).
func typedPass(field string, pass int, commits ...auditRawCommit) auditRawTyping {
	return auditRawTyping{Field: field, TestID: "f-" + field, Pass: pass, Keys: []float64{100, 200, 300},
		Settled: []float64{120, 220, 330}, End: 830, Commits: commits, Hooked: true}
}

// A commit belongs to the last keydown at or before it — a commit AT a keydown is that key's —, up to the last key's
// two frames; after them it trails, up to the end of the quiet; before the first key or after the quiet it is not the
// typing's.
func TestAuditTypingCountsPerKeystrokeAndTrailing(t *testing.T) {
	raw := typedPass("name", 0,
		commit(90, 5, nil),   // before the first key: not counted
		commit(101, 40, nil), // key 0
		commit(150, 2, nil),  // key 0, a second commit (an answer drawn)
		commit(200, 40, nil), // AT key 1's keydown: key 1's
		commit(301, 40, nil), // key 2
		commit(325, 3, nil),  // key 2 — still inside its two frames (330)
		commit(600, 10, nil), // trailing
		commit(900, 7, nil),  // after the quiet: not counted
	)

	commits, components, trailing := typingCounts(raw)

	if got := joinInts(commits); got != "2 1 2" {
		t.Fatalf("commits per keystroke %s, want 2 1 2", got)
	}

	if got := joinInts(components); got != "42 40 43" {
		t.Fatalf("components per keystroke %s, want 42 40 43", got)
	}

	if trailing != 1 {
		t.Fatalf("trailing %d, want 1", trailing)
	}

	if medianInts(commits) != 2 || medianInts(components) != 42 {
		t.Fatalf("medians %v / %v, want 2 / 42", medianInts(commits), medianInts(components))
	}

	if medianInts([]int{1, 3, 2, 4}) != 2.5 || medianInts([]int{7}) != 7 || medianInts(nil) != 0 {
		t.Fatalf("median of an even count is the mean of the middle two: %v", medianInts([]int{1, 3, 2, 4}))
	}

	none := raw
	none.Keys = nil

	c, k, tr := typingCounts(none)
	if c != nil || k != nil || tr != 0 {
		t.Fatalf("no keystroke counts nothing: %v %v %d", c, k, tr)
	}
}

func joinInts(xs []int) string {
	parts := make([]string, len(xs))
	for i, x := range xs {
		parts[i] = fmtCount(float64(x))
	}

	return strings.Join(parts, " ")
}

// Per field: the headline is the first counted pass, every pass is kept, the top re-renderers are summed by name over
// the keys and the quiet (most first, a tie by name), and a pass that cannot be counted says why.
func TestAuditTypingMeasurePerFieldAndPass(t *testing.T) {
	page := map[string]int{"OrderCreatePage": 1, "Field": 3}
	raws := []auditRawTyping{
		typedPass("buyer name", 0, commit(101, 40, page), commit(201, 40, page), commit(301, 40, page),
			commit(600, 2, map[string]int{"QuoteBadge": 1, "Field": 1})),
		typedPass("buyer name", 1, commit(101, 40, page), commit(201, 40, page), commit(202, 1, nil),
			commit(301, 40, page), commit(302, 1, nil)),
		{Field: "address", Pass: 0, Error: "locator.click: Timeout 10000ms exceeded"},
		{Field: "quantity", Pass: 0, Keys: []float64{1}, Hooked: false},
	}
	fields := []auditTypingField{{Name: "buyer name", TestID: "f-buyer name"}, {Name: "address"}, {Name: "quantity"},
		{Name: "note"}}

	got := measureTyping(raws, fields)
	if len(got) != 4 {
		t.Fatalf("one figure per field in the screen's order, got %d", len(got))
	}

	name := got[0]
	if name.Field != "buyer name" || name.Keys != 3 || name.CommitsPerKey != 1 || name.ComponentsPerKey != 40 ||
		name.Trailing != 1 {
		t.Fatalf("headline = the first pass: %+v", name)
	}

	if len(name.Passes) != 2 || name.Passes[1].CommitsPerKey != 2 || name.Passes[1].Trailing != 0 {
		t.Fatalf("every pass kept: %+v", name.Passes)
	}

	if topText(name.Top, 3) != "Field ×10, OrderCreatePage ×3, QuoteBadge ×1" {
		t.Fatalf("top re-renderers %q", topText(name.Top, 3))
	}

	if !strings.Contains(got[1].Error, "pass 1: locator.click") || typingMeasured(got[1]) {
		t.Errorf("a pass that broke says so and is not measured: %+v", got[1])
	}

	if !strings.Contains(got[2].Error, "React never attached") {
		t.Errorf("a page React never attached to is not counted: %+v", got[2])
	}

	if got[3].Error != "the driver typed nothing into it" {
		t.Errorf("a field with no pass: %+v", got[3])
	}
}

// typed builds a field's figures from its passes' commits/key, components/key and trailing commits.
func typed(field string, passes ...auditTypingPass) auditTyping {
	t := auditTyping{Field: field, Keys: 10, Passes: passes}
	t.CommitsPerKey, t.ComponentsPerKey, t.Trailing = passes[0].CommitsPerKey, passes[0].ComponentsPerKey,
		passes[0].Trailing

	return t
}

func tp(commits, components float64, trailing int) auditTypingPass {
	return auditTypingPass{CommitsPerKey: commits, ComponentsPerKey: components, Trailing: trailing}
}

// The verdict's typing lines, by the every-pass rule: a typing count is a FIX only when every pass now reads worse
// than every baseline pass by its threshold (commits/key +1, components/key +25 %, trailing +1), better only when every
// pass reads better, `unstable` when the passes straddle the threshold, and nothing within it; a field the baseline
// lacks has no base, a field not measured says why.
func TestAuditTypingVerdictEveryPass(t *testing.T) {
	base := auditMeasure{Screen: "order-create", Typing: []auditTyping{
		typed("buyer name", tp(1, 40, 0), tp(1, 40, 0)),
	}}

	cases := []struct {
		name string
		now  auditTyping
		want string // the lines, "kind measure was→now" joined by " | "
	}{
		{"unchanged", typed("buyer name", tp(1, 40, 0), tp(1, 40, 0)), ""},
		{"commits worse in every pass", typed("buyer name", tp(2, 40, 0), tp(2, 40, 0)),
			"FIX typing buyer name · commits/key 1→2"},
		{"commits worse in one pass only", typed("buyer name", tp(1, 40, 0), tp(2, 40, 0)),
			"unstable typing buyer name · commits/key 1→1·2"},
		{"components +25 % in every pass", typed("buyer name", tp(1, 50, 0), tp(1, 52, 0)),
			"FIX typing buyer name · components/key 40→50·52"},
		{"components under +25 %", typed("buyer name", tp(1, 45, 0), tp(1, 48, 0)), ""},
		{"components across +25 % in one pass", typed("buyer name", tp(1, 49, 0), tp(1, 50, 0)),
			"unstable typing buyer name · components/key 40→49·50"},
		{"a trailing commit in every pass", typed("buyer name", tp(1, 40, 1), tp(1, 40, 1)),
			"FIX typing buyer name · trailing commits 0→1"},
		{"a trailing commit in one pass", typed("buyer name", tp(1, 40, 0), tp(1, 40, 1)),
			"unstable typing buyer name · trailing commits 0→0·1"},
		{"a field new to the baseline", typed("address", tp(1, 40, 0)), "no base typing address →1 commit(s)"},
		{"a field not measured", auditTyping{Field: "buyer name", Error: "pass 1: no keystroke reached the page"},
			"not measured typing buyer name →"},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			m := auditMeasure{Screen: "order-create", Typing: []auditTyping{c.now}}

			var got []string
			for _, l := range judgeTyping(m, base) {
				s := l.Kind + " " + l.Measure + " " + l.Was + "→" + l.Now
				if l.Kind == auditVerdictNoBase {
					s = l.Kind + " " + l.Measure + " →" + strings.SplitN(l.Now, " ", 3)[0] + " " +
						strings.SplitN(l.Now, " ", 3)[1]
				}

				got = append(got, s)
			}

			if strings.Join(got, " | ") != c.want {
				t.Fatalf("lines %q, want %q", strings.Join(got, " | "), c.want)
			}
		})
	}

	better := auditMeasure{Screen: "order-create", Typing: []auditTyping{typed("buyer name", tp(3, 90, 2), tp(3, 90, 2))}}
	now := auditMeasure{Screen: "order-create", Typing: []auditTyping{typed("buyer name", tp(1, 40, 0), tp(2, 40, 0))}}

	var kinds []string
	for _, l := range judgeTyping(now, better) {
		kinds = append(kinds, l.Kind+" "+strings.TrimPrefix(l.Measure, "typing buyer name · "))
	}

	if strings.Join(kinds, ", ") != "better commits/key, better components/key, better trailing commits" {
		t.Fatalf("every pass better reads better: %v", kinds)
	}
}

// The verdict carries the typing lines among the screen's (judgeScreen), and frontendChanges lists a typing count past
// its threshold as a COUNT.
func TestAuditTypingJoinsTheVerdictAndTheChanges(t *testing.T) {
	rack := map[string]int{"OrderService/OrderCreate": 1}
	b := measured("order-create", 1, rack, 1)
	b.Typing = []auditTyping{typed("quantity", tp(1, 40, 1), tp(1, 40, 1))}

	m := measured("order-create", 1, rack, 1)
	m.Typing = []auditTyping{typed("quantity", tp(3, 40, 1), tp(3, 41, 1))}
	m.Typing[0].Top = []auditRenderCount{{Name: "OrderCreatePage", Renders: 30}}

	v := judgeAudit([]auditMeasure{m}, map[string]auditMeasure{"order-create": b}, nil)
	if v.Summary != "audit: 1 screen(s) · 1 count(s) worse (fix) · 0 timing · 0 unchanged" {
		t.Fatalf("summary %q", v.Summary)
	}

	want := "  FIX       order-create · typing quantity · commits/key 1 → 3 · re-renders OrderCreatePage ×30 — " +
		auditSaysFix
	if len(v.Lines) != 1 || v.Lines[0].String() != want {
		t.Fatalf("lines:\n%s\nwant\n%s", v, want)
	}

	changes := frontendChanges(b, m)
	if len(changes) != 1 || changes[0].Kind != auditChangeCount || changes[0].Screen != "order-create" ||
		changes[0].Measure != "typing quantity · commits/key" || changes[0].Was != "1" || changes[0].Now != "3" {
		t.Fatalf("changes %+v", changes)
	}
}

// Where a re-render starts (the driver's roots: a component that rendered while its nearest component above did not)
// is summed over the typing span and ranked by the components it drew — a page re-rendering the whole form outranks
// many one-component context updates; the finding names the widest start once for every heavy field.
func TestAuditTypingNamesWhereTheReRenderStarts(t *testing.T) {
	page := map[string][]int{"OrderCreatePage": {1, 3800}, "FieldRoot": {19, 57}}
	raw := typedPass("address", 0,
		auditRawCommit{T: 90, N: 3800, Roots: map[string][]int{"OrderCreatePage": {1, 3800}}}, // before the keys
		auditRawCommit{T: 101, N: 3857, Roots: page},
		auditRawCommit{T: 201, N: 3857, Roots: page},
		auditRawCommit{T: 301, N: 3857, Roots: page},
		auditRawCommit{T: 302, N: 3, Roots: map[string][]int{"ComboboxItem": {1, 3}, "Broken": {1}}},
	)

	starts := topStarts(raw, 5)
	if got := startsText(starts, 5); got != "OrderCreatePage ×3 (3800 a time), FieldRoot ×57 (3 a time), ComboboxItem ×1 (3 a time)" {
		t.Fatalf("starts %q", got)
	}

	ty := measureTyping([]auditRawTyping{raw}, []auditTypingField{{Name: "address", TestID: "f-address"}})[0]
	if len(ty.Starts) != 3 || ty.Starts[0].Name != "OrderCreatePage" {
		t.Fatalf("the headline pass keeps its starts: %+v", ty.Starts)
	}

	ty.App = []auditRenderCount{{Name: "OrderCreatePage", Renders: 3}}
	if got := renderersText(ty, 1); got != "start at OrderCreatePage ×3 (3800 a time); most OrderCreatePage ×3" {
		t.Fatalf("renderersText %q", got)
	}

	m := auditMeasure{Screen: "order-create", Typing: []auditTyping{ty,
		{Field: "buyer name", TestID: "f-buyer", Keys: 3, CommitsPerKey: 1, ComponentsPerKey: 3826,
			Passes: []auditTypingPass{{CommitsPerKey: 1, ComponentsPerKey: 3826}}}}}

	var heavy []string

	for _, f := range findingsOf(m, auditScreenDef{}) {
		if strings.Contains(f, "re-renders the form, not the field") {
			heavy = append(heavy, f)
		}
	}

	if len(heavy) != 1 || !strings.Contains(heavy[0], "the address 3857 (1 commit(s)), the buyer name 3826 (1 commit(s)), "+
		"the widest re-render starting at OrderCreatePage ×3 (3800 a time)") {
		t.Fatalf("one finding for every heavy field, naming the widest start: %q", heavy)
	}
}

// The app's own components are the ones frontend/src declares — a function or a const, exported or not, in a .tsx
// that is no story and no test; an ALL-CAPS const is a constant.
func TestAuditAppComponentNamesComeFromTheSource(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "frontend", "src", "pages", "x")

	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}

	write := func(name, body string) {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	write("index.tsx", "export default function OrderCreatePage() {}\r\nfunction CardTitle<T>(p: T) {}\r\n"+
		"export const AddressPicker = memo(() => null)\r\nconst LineRow: FC<P> = () => null\r\nconst MAX_LINES = 10\r\n"+
		"const helper = () => 1\r\n")
	write("x.stories.tsx", "export const StoryOnly = {}\n")
	write("x.test.tsx", "function TestOnly() {}\n")
	write("util.ts", "export function NotTsx() {}\n")

	got := appComponentNames(root)

	var names []string
	for name := range got {
		names = append(names, name)
	}

	sort.Strings(names)

	if strings.Join(names, " ") != "AddressPicker CardTitle LineRow OrderCreatePage" {
		t.Fatalf("app names %v", names)
	}
}
