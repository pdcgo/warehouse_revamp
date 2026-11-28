package main

import (
	"archive/tar"
	"bytes"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"
)

const testSHA = "0123456789abcdef0123456789abcdef01234567"

func testJob(headed bool) jobParams {
	return jobParams{
		L:   remoteLayout{Base: "/home/pdc/warehouse_revamp_e2e", Run: "20261127-190000-smoke-PC-warehouse_revamp"},
		SHA: testSHA, Kind: "smoke", Args: []string{"--isolated"}, San: "san-abc",
		Subs:   []submodule{{Path: "backend/pkgs/san_receipt_readers", SHA: "7fb940cdffa55137acbeeb4b4c836c65260a6c81"}},
		Headed: headed, Display: ":0", PWVersion: "1.61.1", GoVersion: "1.25.8", ImageTag: "pw1.61.1-go1.25.8-x",
		Sender: "PC-warehouse_revamp", Cap: 1800,
	}
}

func TestShqQuotesAnyWordForTheShell(t *testing.T) {
	for in, want := range map[string]string{
		"plain":        "'plain'",
		"it's a b":     `'it'\''s a b'`,
		"$HOME;rm -rf": "'$HOME;rm -rf'",
	} {
		if got := shq(in); got != want {
			t.Fatalf("shq(%q) = %s, want %s", in, got, want)
		}
	}
}

func TestPlanBundleSendsNothingTheOtherPCHas(t *testing.T) {
	p := planBundle(testSHA, true, []string{"aaa"}, func(string) bool { return true })
	if p.Needed {
		t.Fatalf("the other PC has the commit: no bundle, got %+v", p)
	}
}

func TestPlanBundleLeavesOutOnlyCommitsBothSidesHave(t *testing.T) {
	local := map[string]bool{"aaa": true, "ccc": true}

	p := planBundle(testSHA, false, []string{"aaa", "bbb", "ccc", "aaa", testSHA, ""},
		func(c string) bool { return local[c] })

	if !p.Needed || strings.Join(p.Exclude, ",") != "aaa,ccc" {
		t.Fatalf("want a bundle leaving out aaa and ccc (bbb is unknown here, the commit itself never), got %+v", p)
	}

	first := planBundle(testSHA, false, nil, func(string) bool { return true })
	if !first.Needed || len(first.Exclude) != 0 {
		t.Fatalf("a first run sends the whole history: %+v", first)
	}
}

func TestBundleCarriesOneRefNamedByItsCommit(t *testing.T) {
	args := bundleArgs(testSHA, bundlePlan{Needed: true, Exclude: []string{"aaa"}})

	want := []string{"bundle", "create", "-", "refs/san-send/" + testSHA, "^aaa"}
	if strings.Join(args, " ") != strings.Join(want, " ") {
		t.Fatalf("got %v, want %v", args, want)
	}
}

func TestParseGitlinksKeepsOnlySubmodules(t *testing.T) {
	ls := "100644 blob 1111111111111111111111111111111111111111\tgo.mod\r\n" +
		"160000 commit bc5b18e660d715e6a6df57dc1695b1f5575160b0\tbackend/pkgs/san_pgpartition\n" +
		"040000 tree 2222222222222222222222222222222222222222\tbackend\n"

	subs := parseGitlinks(ls)
	if len(subs) != 1 || subs[0].Path != "backend/pkgs/san_pgpartition" ||
		subs[0].TarName() != "backend_pkgs_san_pgpartition-bc5b18e660d715e6a6df57dc1695b1f5575160b0.tar" {
		t.Fatalf("got %+v", subs)
	}
}

// The owner's two-sender rules (2026-11-27): one run at a time behind a lock on the other PC, the commit fetched and
// checked out by its SHA only, the report written into the run's own folder.
func TestJobScriptLocksFetchesBySHAAndReportsIntoItsRunFolder(t *testing.T) {
	s, err := render(jobScript, testJob(false))
	if err != nil {
		t.Fatal(err)
	}

	for _, want := range []string{
		`exec 9>"$BASE/run.lock"`,
		"if ! flock -n 9; then",
		`say "⏳ waiting: another e2e run holds this PC`,
		"until flock -w 300 9;",
		`cp "$RUNDIR/info.json" "$BASE/run.lock.json"`,
		"docker ps -aq --filter 'name=^san-e2e-'",
		"'refs/san-send/" + testSHA + ":refs/san/commits/" + testSHA + "'",
		`[ "$(git rev-parse 'refs/san/commits/` + testSHA + `^{commit}')" = "$SHA" ]`,
		`git checkout -q --force --detach "$SHA"`,
		`-v "$RUNDIR/e2e_report:/work/e2e_report"`,
		"HEADED=0",
	} {
		if !strings.Contains(s, want) {
			t.Fatalf("run.sh lacks %q:\n%s", want, s)
		}
	}

	if regexp.MustCompile(`git (fetch|checkout|pull)[^\n]*(refs/heads|origin|FETCH_HEAD|backup/)`).MatchString(s) {
		t.Fatalf("run.sh fetches or checks out a branch name — only the commit's SHA may be:\n%s", s)
	}

	lock := strings.Index(s, "flock -n 9")
	fetch := strings.Index(s, "git fetch")
	run := strings.Index(s, `"${RC[@]}" run`)

	if lock < 0 || fetch < lock || run < fetch {
		t.Fatalf("the lock must be taken before the checkout changes and the run starts (lock %d, fetch %d, run %d)",
			lock, fetch, run)
	}
}

func TestJobScriptHeadedMountsTheDesktopsDisplay(t *testing.T) {
	s, err := render(jobScript, testJob(true))
	if err != nil {
		t.Fatal(err)
	}

	for _, want := range []string{"HEADED=1", "/run/user/\"$(id -u)\"/.mutter-Xwaylandauth.*", "-S /tmp/.X11-unix/X0",
		`XMOUNT=(-v "$XA:/tmp/.san-xauth:ro" -e DISPLAY=':0' -e XAUTHORITY=/tmp/.san-xauth)`,
		`-e SAN_E2E_HEADED="$HEADED"`} {
		if !strings.Contains(s, want) {
			t.Fatalf("headed run.sh lacks %q", want)
		}
	}
}

func TestJobScriptsAreValidBash(t *testing.T) {
	bash, err := exec.LookPath("bash")
	if err != nil {
		t.Skip("no bash here")
	}

	for _, tpl := range []string{"run.sh", "inner.sh"} {
		tmpl := jobScript
		if tpl == "inner.sh" {
			tmpl = innerScript
		}

		s, err := render(tmpl, testJob(true))
		if err != nil {
			t.Fatal(err)
		}

		f := filepath.Join(t.TempDir(), tpl)

		err = os.WriteFile(f, []byte(s), 0o644)
		if err != nil {
			t.Fatal(err)
		}

		out, err := exec.Command(bash, "-n", f).CombinedOutput()
		if err != nil {
			t.Fatalf("%s does not parse: %v\n%s", tpl, err, out)
		}
	}
}

func TestInnerScriptRunsTheSendersSanWithTheArgs(t *testing.T) {
	s, err := render(innerScript, testJob(false))
	if err != nil {
		t.Fatal(err)
	}

	if !strings.Contains(s, "exec /san-bin/san-abc 'test' 'smoke' '--isolated'") || !strings.Contains(s, "npm ci") {
		t.Fatalf("inner.sh:\n%s", s)
	}
}

func TestVersionsComeFromTheCommitsPins(t *testing.T) {
	v, err := goVersionOf("module x\n\ngo 1.25.8\n")
	if err != nil || v != "1.25.8" {
		t.Fatalf("go line: %q %v", v, err)
	}

	v, err = goVersionOf("module x\n\ngo 1.25\n\ntoolchain go1.25.9\n")
	if err != nil || v != "1.25.9" {
		t.Fatalf("the toolchain line wins: %q %v", v, err)
	}

	pw, err := playwrightVersionOf([]byte(`{"packages":{"node_modules/@playwright/test":{"version":"1.61.1"}}}`))
	if err != nil || pw != "1.61.1" {
		t.Fatalf("playwright: %q %v", pw, err)
	}

	if imageTag([]byte("FROM a"), "1.61.1", "1.25.8") == imageTag([]byte("FROM b"), "1.61.1", "1.25.8") {
		t.Fatal("a changed Dockerfile must name a new image")
	}
}

func tarOf(t *testing.T, files map[string]string) *bytes.Buffer {
	t.Helper()

	var b bytes.Buffer

	tw := tar.NewWriter(&b)

	for name, body := range files {
		err := tw.WriteHeader(&tar.Header{Name: name, Mode: 0o644, Size: int64(len(body)), Typeflag: tar.TypeReg})
		if err != nil {
			t.Fatal(err)
		}

		_, err = tw.Write([]byte(body))
		if err != nil {
			t.Fatal(err)
		}
	}

	err := tw.Close()
	if err != nil {
		t.Fatal(err)
	}

	return &b
}

func TestExtractTarWritesTheReportAndRefusesEscapes(t *testing.T) {
	dst := t.TempDir()

	tops, err := extractTar(tarOf(t, map[string]string{"level2/20261127-190000-smoke/summary.md": "GREEN"}), dst)
	if err != nil || len(tops) != 1 || tops[0] != "level2" {
		t.Fatalf("tops %v err %v", tops, err)
	}

	b, err := os.ReadFile(filepath.Join(dst, "level2", "20261127-190000-smoke", "summary.md"))
	if err != nil || string(b) != "GREEN" {
		t.Fatalf("got %q %v", b, err)
	}

	for _, bad := range []string{"../escape.txt", "/etc/passwd", "level2/../../x", "C:/x"} {
		_, err = extractTar(tarOf(t, map[string]string{bad: "x"}), dst)
		if err == nil {
			t.Fatalf("%q must be refused", bad)
		}
	}
}

func TestHeadlessFalseAddsHeadedToPlaywright(t *testing.T) {
	t.Setenv(headedEnv, "")

	if strings.Contains(strings.Join(playwrightBatchArgs([]string{"a.spec.ts"}, "x"), " "), "--headed") {
		t.Fatal("headless by default")
	}

	t.Setenv(headedEnv, "1")

	got := strings.Join(playwrightBatchArgs([]string{"a.spec.ts"}, "x"), " ")
	if got != "a.spec.ts --grep x --reporter=line,json --headed" {
		t.Fatalf("got %q", got)
	}
}

func TestLocalHeadlessFalseIsHeadedHere(t *testing.T) {
	t.Setenv(headedEnv, "")

	c, err := parseDevConfig([]byte("e2e_test:\n  type: local\n  headless: false\n"))
	if err != nil {
		t.Fatal(err)
	}

	applyLocalHeadless(c)

	if os.Getenv(headedEnv) != "1" {
		t.Fatal("type local, headless false: the browsers show on this machine")
	}
}

func TestWorkerBindsLoopbackExceptInTheRunner(t *testing.T) {
	w := &e2eWorker{Name: "w1", APIPort: 8181, UIPort: 5181, DB: "warehouse_test_w1", Project: "warehouse-e2e-w1"}

	t.Setenv(bindHostEnv, "")

	if !strings.Contains(strings.Join(w.env(), " "), "E2E_API_ADDR=localhost:8181") {
		t.Fatalf("here: loopback — %v", w.env())
	}

	t.Setenv(bindHostEnv, "0.0.0.0")

	if !strings.Contains(strings.Join(w.env(), " "), "E2E_API_ADDR=0.0.0.0:8181") {
		t.Fatalf("in the runner: every interface — %v", w.env())
	}
}

func TestCommandsNotYetRemoteRefuseUnderTypeSSH(t *testing.T) {
	root := t.TempDir()

	t.Setenv(inRunnerEnv, "")

	err := refuseRemoteNotBuilt(root, "full")
	if err != nil {
		t.Fatalf("no development.yaml: runs here — %v", err)
	}

	err = os.WriteFile(filepath.Join(root, devConfigFile), []byte(ownerShapeYAML), 0o600)
	if err != nil {
		t.Fatal(err)
	}

	err = refuseRemoteNotBuilt(root, "full")
	if err == nil || !strings.Contains(err.Error(), "set type: local") {
		t.Fatalf("type ssh: full must refuse, not run on this machine — %v", err)
	}

	t.Setenv(inRunnerEnv, "1")

	_, remote, err := remoteHere(root)
	if err != nil || remote {
		t.Fatalf("inside the runner a run is never sent on: remote=%v err=%v", remote, err)
	}
}

func TestSenderNamesTheMachineAndTheCheckout(t *testing.T) {
	a := senderName("DESKTOP 1", "D:/pdcgo/warehouse_revamp")
	b := senderName("DESKTOP 1", "D:/pdcgo/warehouse_revamp_e2e/")

	if a != "DESKTOP_1-warehouse_revamp" || b != "DESKTOP_1-warehouse_revamp_e2e" {
		t.Fatalf("got %q %q", a, b)
	}
}

func TestPreflightInTheRunnerChecksPostgresNotDocker(t *testing.T) {
	t.Setenv(inRunnerEnv, "1")

	old := dialPostgres

	defer func() { dialPostgres = old }()

	var dialled string

	dialPostgres = func(addr string) error {
		dialled = addr

		return errors.New("connection refused")
	}

	err := preflightE2E(nil)
	if err == nil || !strings.Contains(err.Error(), "does not answer on localhost:5433") || dialled != "localhost:5433" {
		t.Fatalf("in the runner the preflight dials Postgres (no docker CLI there): dialled %q, err %v", dialled, err)
	}

	dialPostgres = func(string) error { return nil }

	err = preflightE2E(nil)
	if err != nil {
		t.Fatalf("Postgres answers: %v", err)
	}
}

func TestAffectedSendsTheChangeMeasuredHere(t *testing.T) {
	got := strings.Join(affectedRemoteArgs([]string{"a.go", "b.tsx"}, true), " ")
	if got != "--run --files a.go,b.tsx --isolated" {
		t.Fatalf("got %q", got)
	}

	got = strings.Join(affectedRemoteArgs(nil, false), " ")
	if got != "--run --files ," {
		t.Fatalf("no change is an empty --files list (the smoke set alone), got %q", got)
	}

	changed, source, err := changedFiles(t.TempDir(), ",", time.Time{})
	if err != nil || len(changed) != 0 || source != "--files" {
		t.Fatalf("the other PC reads \"--files ,\" as no change: %v %q %v", changed, source, err)
	}
}
