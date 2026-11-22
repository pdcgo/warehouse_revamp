package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The frontend audit's pure parts (audit_frontend_measure.go, audit_frontend_seat.go): the waiting-chain and duplicate
// math, the after-save judgement, the baseline comparison, the port picker, the template's fingerprint and the seat's
// refusals. No database, no browser.

func req(method string, start, end float64) auditRawRequest {
	return auditRawRequest{Method: method, Body: "{}", Start: start, End: end, Status: 200}
}

// The scoping's self-check, as numbers: rack detail fires RackDetail, RackHistory and RackStock at once; ProductByIds
// waits for RackStock, TeamByIds for ProductByIds — depth 3, RackStock → ProductByIds → TeamByIds.
func TestAuditChainReadsTheRackShelfAsThreeDeep(t *testing.T) {
	reqs := []auditRawRequest{
		req("RackService/RackDetail", 10, 40),
		req("RackService/RackHistory", 11, 60),
		req("RackService/RackStock", 12, 50),
		req("RackService/RackHistoryNames", 61, 80), // RackHistory → its names: depth 2, not the deepest
		req("ProductService/ProductByIds", 55, 90),
		req("TeamService/TeamByIds", 95, 120),
	}

	depth, chain, waves := chainOf(reqs, auditChainGapMS)
	if depth != 3 {
		t.Fatalf("depth = %d, want 3 (chain %v)", depth, chain)
	}

	want := "RackService/RackStock ProductService/ProductByIds TeamService/TeamByIds"
	if strings.Join(chain, " ") != want {
		t.Fatalf("chain = %v, want %s", chain, want)
	}

	if waves["RackService/RackDetail"][0] != 1 || waves["ProductService/ProductByIds"][0] != 2 ||
		waves["TeamService/TeamByIds"][0] != 3 {
		t.Fatalf("waves = %v", waves)
	}
}

// The measured chain: each request names the requests whose held-back answer delayed it (After). The real rack-detail
// load of 2026-11-21 — TeamByIds fired ~200 ms after ProductByIds answered (the 45-line shelf rendering in between),
// past the timing rule's 100 ms, and RackHistory ~60 ms after it by coincidence. The measured dependencies read
// RackStock → ProductByIds → TeamByIds whatever the gaps; the shell's reads are never part of a chain.
func TestAuditChainFromMeasuredDependencies(t *testing.T) {
	reqs := []auditRawRequest{
		{Method: "AuthService/CheckAccess", Start: 0, End: 7},               // 0 shell
		{Method: "RackService/RackStock", Start: 187, End: 195, After: nil}, // 1
		{Method: "RackService/RackDetail", Start: 188, End: 194},            // 2
		{Method: "ProductService/ProductByIds", Start: 205, End: 209, After: []int{1}},
		{Method: "RackService/RackHistory", Start: 269, End: 287, After: []int{2}},
		{Method: "TeamService/TeamByIds", Start: 405, End: 409, After: []int{1, 3}},
		{Method: "UserService/UserByIDs", Start: 330, End: 334, After: []int{2, 4, 0}},
	}
	screen := func(i int) bool { return !isShell(reqs[i], auditShell) }

	depth, chain, waves, all := chainFromDeps(reqs, screen)
	if depth != 3 {
		t.Fatalf("depth = %d (chain %v), want 3", depth, chain)
	}

	got := strings.Join(shortAll(chain), " → ")
	if got != "RackStock → ProductByIds → TeamByIds" {
		t.Fatalf("chain = %s, want RackStock → ProductByIds → TeamByIds (the later-ending parent wins a tie)", got)
	}

	if len(all) != 2 || strings.Join(shortAll(all[0]), " → ") != "RackDetail → RackHistory → UserByIDs" {
		t.Fatalf("every 3-deep chain, sorted: %v", all)
	}

	if waves["UserService/UserByIDs"][0] != 3 || waves["RackService/RackHistory"][0] != 2 || len(waves["AuthService/CheckAccess"]) != 0 {
		t.Fatalf("waves = %v", waves)
	}

	// The timing rule on the same load joins RackHistory to ProductByIds and loses TeamByIds — why the pass exists.
	_, screenReqs := splitShell(reqs, auditShell)

	timed, timedChain, _ := chainOf(screenReqs, auditChainGapMS)
	if timed == 3 && strings.Join(shortAll(timedChain), " → ") == got {
		t.Fatalf("the timing rule read the shelf right — the fixture no longer shows its failure")
	}

	reqs[3].After = []int{1, 3} // its own index — never a dependency
	reqs[1].After = []int{5}    // a cycle — broken, not looped

	depth, _, _, _ = chainFromDeps(reqs, screen)
	if depth < 1 || depth > 4 {
		t.Fatalf("a cycle: depth %d", depth)
	}
}

// The sidebar's badges are the shell only as their one-row pages; the same RPC asked by a screen is the screen's.
func TestAuditShellReadsByMethodAndBody(t *testing.T) {
	cases := []struct {
		r    auditRawRequest
		want bool
	}{
		{auditRawRequest{Method: "AuthService/CheckAccess", Body: `{"token":"x"}`}, true},
		{auditRawRequest{Method: "LiabilityService/LiabilityPositionList",
			Body: `{"teamId":"2","filter":{},"dataRequest":["X"],"page":{"page":1,"limit":1}}`}, true},
		{auditRawRequest{Method: "LiabilityService/LiabilityPositionList", // the ledger's own read of one pair
			Body: `{"teamId":"2","filter":{"counterpartyId":"3"},"dataRequest":["X"],"page":{"page":1,"limit":1}}`}, false},
		{auditRawRequest{Method: "FoundRequestService/FoundRequestList", Body: `{"page":{"page":1,"limit":1}}`}, true},
		{auditRawRequest{Method: "RackService/RackStock", Body: `{"page":{"page":1,"limit":1}}`}, false},
	}

	for _, c := range cases {
		if got := isShell(c.r, auditShell); got != c.want {
			t.Errorf("%s %s: shell %v, want %v", c.r.Method, c.r.Body, got, c.want)
		}
	}
}

// A call that starts more than 100 ms after another ended did not wait on it (the next screen's timer, a click), and
// one that started while the other was still running did not wait either.
func TestAuditChainNeedsTheEndWithinTheGap(t *testing.T) {
	reqs := []auditRawRequest{
		req("A/First", 0, 50),
		req("B/Late", 151, 200),  // 101 ms after A ended
		req("C/Overlap", 40, 45), // started before A ended (and ended 106 ms before B)
	}

	depth, chain, _ := chainOf(reqs, auditChainGapMS)
	if depth != 1 {
		t.Fatalf("depth = %d (chain %v), want 1 — nothing waited", depth, chain)
	}

	reqs[1].Start = 150 // exactly 100 ms after: it waited

	depth, _, _ = chainOf(reqs, auditChainGapMS)
	if depth != 2 {
		t.Fatalf("depth = %d, want 2 at a 100 ms gap", depth)
	}

	empty, none, _ := chainOf(nil, auditChainGapMS)
	if empty != 0 || none != nil {
		t.Fatalf("no requests: depth %d chain %v", empty, none)
	}
}

func TestAuditDuplicatesAreTheSameMethodAndBody(t *testing.T) {
	reqs := []auditRawRequest{
		{Method: "TeamService/TeamByIds", Body: `{"ids":["3"]}`},
		{Method: "TeamService/TeamByIds", Body: `{"ids":["3"]}`},
		{Method: "TeamService/TeamByIds", Body: `{"ids":["3"]}`},
		{Method: "TeamService/TeamByIds", Body: `{"ids":["4"]}`}, // another question — not a duplicate
		{Method: "ProductService/ProductByIds", Body: `{}`},
	}

	n, named := duplicatesOf(reqs)
	if n != 2 || len(named) != 1 || named[0] != "TeamService/TeamByIds" {
		t.Fatalf("duplicates = %d %v, want 2 [TeamService/TeamByIds]", n, named)
	}

	n, named = duplicatesOf(reqs[3:])
	if n != 0 || named != nil {
		t.Fatalf("no repeat: %d %v", n, named)
	}
}

func usable(ms float64) *float64 { return &ms }

func TestAuditMeasureSplitsTheShellAndFlagsAWarmLoadThatDiffers(t *testing.T) {
	shell := auditShell
	load := func(extra ...auditRawRequest) auditRawLoad {
		reqs := []auditRawRequest{req("AuthService/CheckAccess", 0, 10), req("UserService/TeamAccessList", 11, 20),
			req("RackService/RackDetail", 30, 60)}

		return auditRawLoad{Kind: "warm", UsableMS: usable(400), Requests: append(reqs, extra...)}
	}

	raw := auditRawScreen{Name: "rack-detail", Loads: []auditRawLoad{
		{Kind: "cold", UsableMS: usable(900), Requests: make([]auditRawRequest, 7)},
		load(), load(), load(),
	}}

	m := measureScreen(raw, auditScreenDef{Role: "wh_owner"}, shell, false, "2026-11-21")
	if m.RequestsShell != 2 || m.RequestsScreen != 1 || m.ColdRequests != 7 || !m.CountsAgree {
		t.Fatalf("shell %d screen %d cold %d agree %v, want 2 1 7 true", m.RequestsShell, m.RequestsScreen,
			m.ColdRequests, m.CountsAgree)
	}

	if m.UsableMS.Median != 400 || m.UsableMS.N != 3 || m.ColdUsableMS != 900 {
		t.Fatalf("usable %+v cold %v", m.UsableMS, m.ColdUsableMS)
	}

	raw.Loads = append(raw.Loads, load(req("RackService/RackHistory", 70, 90)))

	m = measureScreen(raw, auditScreenDef{}, shell, false, "2026-11-21")
	if m.CountsAgree || len(m.Unstable) != 1 || m.Unstable[0] != "RackService/RackHistory" {
		t.Fatalf("agree %v unstable %v, want a RackHistory race", m.CountsAgree, m.Unstable)
	}
}

func TestAuditAfterSaveJudgesAgainstTheListedReads(t *testing.T) {
	listed := []string{"RackService/RackDetail", "RackService/RackStock"}
	save := func(methods ...string) *auditRawInteraction {
		in := &auditRawInteraction{Name: "move", RPC: "RackService/RackMove", Sent: true}
		for _, m := range methods {
			in.Requests = append(in.Requests, auditRawRequest{Method: m})
		}

		return in
	}

	cases := []struct {
		name string
		in   *auditRawInteraction
		want string
	}{
		{"every listed read", save("RackService/RackDetail", "RackService/RackStock"), "ok"},
		{"one missing", save("RackService/RackDetail"), "stale?"},
		{"one twice", save("RackService/RackDetail", "RackService/RackStock", "RackService/RackStock"), "storm"},
		{"listed + 3", save("RackService/RackDetail", "RackService/RackStock", "A/a", "B/b", "C/c"), "storm"},
		{"listed + 2", save("RackService/RackDetail", "RackService/RackStock", "A/a", "B/b"), "ok"},
		{"not sent", &auditRawInteraction{RPC: "RackService/RackMove"}, "not sent"},
		// A write the backend refused refreshes nothing it saved (#125: OrderCreate's 400 "no return warehouse").
		{"refused", &auditRawInteraction{RPC: "RackService/RackMove", Sent: true, Status: 400,
			Requests: []auditRawRequest{{Method: "RackService/RackDetail"}, {Method: "RackService/RackStock"}}}, "refused"},
		{"answered 200", &auditRawInteraction{RPC: "RackService/RackMove", Sent: true, Status: 200,
			Requests: []auditRawRequest{{Method: "RackService/RackDetail"}, {Method: "RackService/RackStock"}}}, "ok"},
	}

	for _, c := range cases {
		got := judgeAfterSave(c.in, listed)
		if got.Verdict != c.want {
			t.Errorf("%s: verdict %q, want %q", c.name, got.Verdict, c.want)
		}

		if c.want == "refused" && got.Sent {
			t.Errorf("%s: a refused save is not a sent one — its count is never compared", c.name)
		}
	}

	if got := judgeAfterSave(save("A/a"), nil).Verdict; got != "recorded" {
		t.Errorf("nothing listed: %q, want recorded", got)
	}
}

func baseMeasure() auditMeasure {
	return auditMeasure{
		Screen: "rack-detail", RequestsScreen: 7, ByMethod: map[string]int{"RackService/RackHistory": 1},
		ChainDepth: 3, UsableMS: auditSpread{Median: 400, Min: 380, Max: 420, N: 5},
		AfterSave: &auditAfterSave{Sent: true, Count: 4},
	}
}

func kindsOf(changes []auditChange) string {
	var parts []string
	for _, c := range changes {
		parts = append(parts, c.Kind+" "+c.Measure)
	}

	return strings.Join(parts, ", ")
}

// frontendChanges lists what moved past the scoping's thresholds and tags each COUNT or TIMING
// (a-slice-fixes-the-speed-regression-it-caused) — and decides nothing.
func TestFrontendChangesTagsCountsAndTimings(t *testing.T) {
	base := baseMeasure()

	same := baseMeasure()
	same.UsableMS = auditSpread{Median: 520, Min: 500, Max: 540, N: 5} // +30 % but only +120 ms

	if c := frontendChanges(base, same); len(c) != 0 {
		t.Fatalf("under every threshold, got %s", kindsOf(c))
	}

	now := baseMeasure()
	now.RequestsScreen = 8
	now.ByMethod = map[string]int{"RackService/RackHistory": 2}
	now.Duplicates = 1
	now.DuplicateOf = []string{"RackService/RackHistory"}
	now.ChainDepth = 4
	now.AfterSave = &auditAfterSave{Sent: true, Count: 6}
	now.UsableMS = auditSpread{Median: 600, Min: 590, Max: 610, N: 5} // +50 %, +200 ms, a tight spread

	got := kindsOf(frontendChanges(base, now))
	want := "COUNT requests, COUNT duplicates, COUNT chain, COUNT after save, TIMING usable"

	if got != want {
		t.Fatalf("changes = %s\nwant      %s", got, want)
	}

	now.Noisy = true

	got = kindsOf(frontendChanges(base, now))
	if !strings.HasSuffix(got, "TIMING usable (noisy)") {
		t.Fatalf("a noisy machine's time is listed as noisy, got %s", got)
	}

	missing := baseMeasure()
	missing.AfterSave = &auditAfterSave{Sent: true, Count: 4, Missing: []string{"RackService/RackStock"}}

	if got := kindsOf(frontendChanges(base, missing)); got != "COUNT after save" {
		t.Fatalf("a listed read gone after the save: %s", got)
	}
}

// The audit's ports come from :8251/:5251; a pair whose API OR UI port another program holds is passed over.
func TestAuditPickPortPairsSkipsAPairWithEitherPortHeld(t *testing.T) {
	held := map[int]bool{8251: true, 5252: true}
	busy := func(port int) bool { return held[port] }

	seat, err := pickAuditSeat(busy)
	if err != nil {
		t.Fatal(err)
	}

	if seat.APIPort != 8253 || seat.UIPort != 5253 || seat.DB != "warehouse_test_audit" ||
		seat.Template != "warehouse_test_audit_tpl" || seat.Project != "warehouse-audit" {
		t.Fatalf("seat = %+v, want :8253/:5253 on warehouse_test_audit", seat)
	}

	if strings.Join(seat.Skipped, " ") != ":8251/:5251 :8252/:5252" {
		t.Fatalf("skipped = %v", seat.Skipped)
	}

	_, err = pickAuditSeat(func(int) bool { return true })
	if err == nil || !strings.Contains(err.Error(), "8251–8270") {
		t.Fatalf("every pair held: err = %v", err)
	}

	// The workers' picker is the same code from its own base — unchanged.
	apis, uis, _, err := pickWorkerPorts(1, busy)
	if err != nil || apis[0] != 8181 || uis[0] != 5181 {
		t.Fatalf("pickWorkerPorts = %v %v %v", apis, uis, err)
	}
}

func writeFile(t *testing.T, path, content string) {
	t.Helper()

	err := os.MkdirAll(filepath.Dir(path), 0o755)
	if err != nil {
		t.Fatal(err)
	}

	err = os.WriteFile(path, []byte(content), 0o644)
	if err != nil {
		t.Fatal(err)
	}
}

// The template is rebuilt when a migration, the seed's Go file or a fixture changes — and for nothing else (a
// service's handler, a line-ending flip of the checkout).
func TestAuditTemplateFingerprintMovesOnlyWithItsInputs(t *testing.T) {
	root := t.TempDir()
	migration := filepath.Join(root, "backend", "services", "team_service", "db_migrations", "00001_teams.sql")
	seed := filepath.Join(root, "tools", "san", "audit_frontend_seed.go")
	fixture := filepath.Join(root, "frontend", "scripts", "speed-audit", "fixtures", "regions.csv")
	handler := filepath.Join(root, "backend", "services", "team_service", "team_v1", "team_create.go")

	writeFile(t, migration, "CREATE TABLE teams ();\n")
	writeFile(t, seed, "package main\n")
	writeFile(t, fixture, "code\n31\n")
	writeFile(t, handler, "package team_v1\n")

	fp := func() string {
		got, err := auditTemplateFingerprint(root)
		if err != nil {
			t.Fatal(err)
		}

		return got
	}

	first := fp()

	writeFile(t, handler, "package team_v1 // changed\n")
	writeFile(t, migration, "CREATE TABLE teams ();\r\n")

	if fp() != first {
		t.Fatal("a handler change or a CRLF flip moved the fingerprint")
	}

	for _, f := range []string{migration, seed, fixture} {
		writeFile(t, f, "changed\n")

		next := fp()
		if next == first {
			t.Fatalf("changing %s did not move the fingerprint", filepath.Base(f))
		}

		first = next
	}

	writeFile(t, filepath.Join(root, "backend", "services", "user_service", "db_migrations", "00001_users.sql"), "x\n")

	if fp() == first {
		t.Fatal("a new service's migration did not move the fingerprint")
	}
}

// A second audit refuses while another one's lock is held by a live process — in this checkout or any other; a dead
// lock, or this process's own, never refuses.
func TestAuditRefusesASecondAuditInAnyCheckout(t *testing.T) {
	alive := func(pid int) bool { return pid == 4242 || pid == 7 }

	found := map[string]*auditLock{
		`D:\pdcgo\warehouse_revamp`:     {PID: 7}, // this process
		`D:\pdcgo\warehouse_revamp_e2e`: {PID: 4242, APIPort: 8251, UIPort: 5251},
		`D:\pdcgo\other`:                {PID: 9999}, // dead
	}

	err := auditRefusal(found, 7, alive)
	if err == nil || !strings.Contains(err.Error(), "warehouse_revamp_e2e") || !strings.Contains(err.Error(), "pid 4242") {
		t.Fatalf("a live audit in the other checkout: err = %v", err)
	}

	delete(found, `D:\pdcgo\warehouse_revamp_e2e`)
	found[`D:\pdcgo\none`] = nil

	err = auditRefusal(found, 7, alive)
	if err != nil {
		t.Fatalf("only its own lock and a dead one: %v", err)
	}
}
