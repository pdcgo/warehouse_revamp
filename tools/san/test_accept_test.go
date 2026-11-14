package main

import (
	"bytes"
	"context"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const acceptStamp = "20261114-100420"

// acceptRepo is a checkout whose e2e_report holds one ended full run shaped like 20261114-100420 — go 47 ✓, e2e
// 312 passed / 2 skipped, Storybook red with the real log — after mutate. The run's fingerprint differs from the live
// tree by one file, so a test can tell which one last_green.json became.
func acceptRepo(t *testing.T, mutate func(rec *RunRecord, dir string)) (string, string) {
	t.Helper()

	root := fakeRepo(t, map[string]string{
		"frontend/src/components/chrome/Logo.stories.tsx": "export default {};\n",
		"frontend/e2e/b_broken.spec.ts":                   "test(\"b\", async () => {});\n",
	})

	fp, err := takeFingerprint(root)
	if err != nil {
		t.Fatal(err)
	}

	fp.Files["frontend/src/only_in_the_run.ts"] = "0000"

	dir := filepath.Join(root, "e2e_report", "runs", acceptStamp)

	rec := &RunRecord{
		ID: acceptStamp, Kind: "full", Fingerprint: fp.Sum(),
		Go:      &PartResult{Passed: 47, Log: "D:/gone/go.log"},
		Stories: &PartResult{Exit: 1, Passed: 2547, Failed: 4, Log: "D:/gone/stories.log"},
		E2E: &E2EResult{Specs: map[string]*SpecResult{}, Batches: []*BatchResult{
			{N: 1, Worker: "w1", Specs: []string{"auth.spec.ts"}, Counts: Counts{Passed: 312, Skipped: 2}, Log: "D:/gone/w1-b1.log"},
		}},
	}

	writeTree(t, dir, map[string]string{
		"stories.log":    firstRunAsIfEveryFileRan(t),
		"proto/a.proto":  "syntax = \"proto3\";\n",
		"w1-b1.log":      "",
		"go.log":         "",
		"summary.md":     "old summary\n",
		"unrelated.keep": "",
	})

	if mutate != nil {
		mutate(rec, dir)
	}

	err = writeJSON(filepath.Join(dir, "fingerprint.json"), fp)
	if err != nil {
		t.Fatal(err)
	}

	err = writeJSON(filepath.Join(dir, "run.json"), rec)
	if err != nil {
		t.Fatal(err)
	}

	return root, dir
}

func fakeAcceptExec(t *testing.T, calls map[string]int, red map[string]bool, e2eCalls *[][]string) acceptExec {
	return acceptExec{
		Story: countingRunner(calls, red),
		E2E:   func(logDir string) batchRunner { return fakeBatches(t, logDir, e2eCalls, red) },
	}
}

var searchRequest = acceptRequest{Stamp: acceptStamp, Named: []string{"frontend/" + searchStory},
	Reason: "the owner made this run the first green baseline (a-file-that-fails-to-load-is-re-run-once)"}

func TestAcceptRunRefuses(t *testing.T) {
	globalSetupFailed := func(rec *RunRecord, dir string) {
		rec.Stories = &PartResult{Passed: 2551, Log: "stories.log"}
		rec.E2E.Batches = append(rec.E2E.Batches, &BatchResult{N: 2, Worker: "w1", Exit: 1,
			Specs: []string{"a_ok.spec.ts", "b_broken.spec.ts"}, Log: filepath.Join(dir, "w1-b2.log")})

		err := os.WriteFile(filepath.Join(dir, "w1-b2.json"), []byte(fixture(t, "pw_global_setup.json")), 0o644)
		if err != nil {
			t.Fatal(err)
		}
	}

	cases := []struct {
		name   string
		mutate func(rec *RunRecord, dir string)
		req    acceptRequest
		want   string
	}{
		{"go red", func(rec *RunRecord, _ string) { rec.Go.Exit, rec.Go.Failed = 1, 1 }, searchRequest, "go test is not green"},
		{"an e2e test failed", func(rec *RunRecord, _ string) {
			b := rec.E2E.Batches[0]
			b.Exit, b.Counts.Failed, b.Failures = 1, 1, []string{"orders.spec.ts › places an order"}
		}, searchRequest, "the e2e has 1 failed tests (orders.spec.ts › places an order)"},
		{"a partial run", func(rec *RunRecord, _ string) { rec.Partial, rec.PartialWhy = true, "--skip go" }, searchRequest,
			"partial run"},
		{"a stopped run", func(rec *RunRecord, _ string) { rec.Stopped = "interrupted" }, searchRequest, "stopped early"},
		{"already accepted", func(rec *RunRecord, _ string) { rec.Acceptances = []*Acceptance{{Green: true}} },
			searchRequest, "already accepted"},
		{"an earlier red acceptance", func(rec *RunRecord, _ string) { rec.Acceptances = []*Acceptance{{Green: false}} },
			searchRequest, "a second failure is red"},
		{"a red re-run inside the run", func(rec *RunRecord, _ string) {
			rec.Reruns = []*Rerun{{Part: "stories", File: "src/a.stories.tsx", Result: "✗ failed to load again"}}
		}, searchRequest, "a second load failure is red"},
		{"the Search timeout is a check failure", nil, acceptRequest{Stamp: acceptStamp},
			"CHECK failures remain (never re-run by the rule): " + searchStory + " (Test timed out in 15000ms.)"},
		{"--rerun needs --reason", nil, acceptRequest{Stamp: acceptStamp, Named: []string{searchStory}},
			"--rerun needs --reason"},
		{"--rerun names only a failed file", nil, acceptRequest{Stamp: acceptStamp, Reason: "x",
			Named: []string{searchStory, "src/components/Never.stories.tsx"}}, "src/components/Never.stories.tsx did not fail"},
		{"a story failure naming no file", func(_ *RunRecord, dir string) {
			log := strings.Replace(firstRunAsIfEveryFileRan(t), "Error: Failed to run the test D:/hermes/cache/"+
				"scratch/san_frozen_1114/frontend/src/pages/supplier-discover/index.stories.tsx.", "Error: socket hang up", 1)

			err := os.WriteFile(filepath.Join(dir, "stories.log"), []byte(log), 0o644)
			if err != nil {
				t.Fatal(err)
			}
		}, searchRequest, "no file can be named for"},
		{"story files that never ran", func(_ *RunRecord, dir string) {
			err := os.WriteFile(filepath.Join(dir, "stories.log"), []byte(fixture(t, "stories_20261114-100420.txt")), 0o644)
			if err != nil {
				t.Fatal(err)
			}
		}, searchRequest, "29 never ran"},
		{"an e2e batch red with no load error of its specs", globalSetupFailed, acceptRequest{Stamp: acceptStamp},
			"no load error naming only its specs"},
		{"no such run", nil, acceptRequest{Stamp: "20200101-000000"}, "no run 20200101-000000"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			root, dir := acceptRepo(t, tc.mutate)
			before, _ := os.ReadFile(filepath.Join(dir, "run.json"))

			calls := map[string]int{}

			var e2eCalls [][]string

			_, err := runAccept(context.Background(), root, tc.req, false, fakeAcceptExec(t, calls, nil, &e2eCalls), "test",
				io.Discard)
			if err == nil || !strings.Contains(err.Error(), "refused") || !strings.Contains(err.Error(), tc.want) {
				t.Fatalf("want a refusal with %q, got %v", tc.want, err)
			}

			if len(calls) > 0 || len(e2eCalls) > 0 {
				t.Errorf("a refusal re-runs nothing: %v %v", calls, e2eCalls)
			}

			_, statErr := os.Stat(filepath.Join(root, "e2e_report", "last_green.json"))
			after, _ := os.ReadFile(filepath.Join(dir, "run.json"))

			if statErr == nil || !bytes.Equal(before, after) {
				t.Error("a refusal moves nothing and writes nothing")
			}
		})
	}
}

func TestAcceptRunMovesLastGreenToTheRunsFingerprint(t *testing.T) {
	root, dir := acceptRepo(t, nil)
	calls := map[string]int{}

	var out bytes.Buffer

	a, err := runAccept(context.Background(), root, searchRequest, false, fakeAcceptExec(t, calls, nil, nil),
		"san test accept-run "+acceptStamp, &out)
	if err != nil {
		t.Fatalf("%v\n%s", err, out.String())
	}

	if len(calls) != 11 || calls[searchStory] != 1 {
		t.Fatalf("the 10 load-failed files and the named one, each once: %v", calls)
	}

	for f, n := range calls {
		if n != 1 {
			t.Errorf("%s re-run %d times", f, n)
		}
	}

	runFp, _ := readFingerprint(filepath.Join(dir, "fingerprint.json"))

	lg, err := readFingerprint(filepath.Join(root, "e2e_report", "last_green.json"))
	if err != nil {
		t.Fatal(err)
	}

	if lg.Run != acceptStamp || lg.Sum() != runFp.Sum() || lg.Files["frontend/src/only_in_the_run.ts"] != "0000" {
		t.Errorf("last_green.json is the RUN's fingerprint, not the tree's: run %s sum %s", lg.Run, lg.Sum())
	}

	_, err = os.Stat(filepath.Join(root, "e2e_report", "last_green_proto", "proto", "a.proto"))
	if err != nil {
		t.Errorf("the run's .proto files become last_green_proto/: %v", err)
	}

	rec, _ := readRun(filepath.Join(dir, "run.json"))
	if !rec.Green || !rec.MovedGreen || rec.accepted() == nil || rec.Stories.Classes == nil {
		t.Fatalf("the run record keeps the acceptance: %+v", rec)
	}

	got := rec.accepted()
	if !got.MovedGreen || got.Reason != searchRequest.Reason || len(got.Named) != 1 || got.Named[0] != searchStory ||
		len(got.Reruns) != 11 || got.Where != "the live tree" || got.TreeFingerprint == rec.Fingerprint {
		t.Errorf("acceptance %+v", got)
	}

	kinds := map[string]int{}
	for _, r := range got.Reruns {
		kinds[r.Kind]++

		if r.File == "src/components/chrome/Logo.stories.tsx" && (r.SameAsRun == nil || !*r.SameAsRun) {
			t.Errorf("Logo reads as the run tested it: %+v", r.SameAsRun)
		}
	}

	if kinds["load"] != 10 || kinds["named"] != 1 || a == nil {
		t.Errorf("kinds %v", kinds)
	}

	summary, _ := os.ReadFile(filepath.Join(dir, "summary.md"))
	latest, _ := os.ReadFile(filepath.Join(root, "e2e_report", "latest.md"))

	for _, want := range []string{"## Accepted ", "| stories | `" + searchStory + "` | named | named with --rerun: the owner",
		"GREEN (accepted ", "Per file: 10 failed to load, 1 failed a check"} {
		if !strings.Contains(string(summary), want) {
			t.Errorf("summary.md lacks %q:\n%s", want, summary)
		}
	}

	if !strings.Contains(string(latest), "**Accepted**") || !strings.Contains(string(latest), "(run "+acceptStamp+")") {
		t.Errorf("latest.md names the accepted baseline:\n%s", latest)
	}

	_, err = runAccept(context.Background(), root, searchRequest, false, fakeAcceptExec(t, calls, nil, nil), "again", io.Discard)
	if err == nil || !strings.Contains(err.Error(), "already accepted") {
		t.Errorf("a second acceptance is refused: %v", err)
	}
}

func TestAcceptRunWithARedRerunMovesNothing(t *testing.T) {
	root, dir := acceptRepo(t, nil)
	calls := map[string]int{}

	_, err := runAccept(context.Background(), root, searchRequest, false,
		fakeAcceptExec(t, calls, map[string]bool{searchStory: true}, nil), "test", io.Discard)
	if err == nil || !strings.Contains(err.Error(), "not accepted") {
		t.Fatalf("a red re-run is not accepted: %v", err)
	}

	_, statErr := os.Stat(filepath.Join(root, "e2e_report", "last_green.json"))
	if statErr == nil {
		t.Error("last_green.json must not move")
	}

	rec, _ := readRun(filepath.Join(dir, "run.json"))
	if rec.Green || len(rec.Acceptances) != 1 || rec.Acceptances[0].Green {
		t.Errorf("the red attempt is recorded, the run stays red: %+v", rec.Acceptances)
	}

	summary, _ := os.ReadFile(filepath.Join(dir, "summary.md"))
	if !strings.Contains(string(summary), "## Not accepted ") {
		t.Errorf("summary.md records the attempt:\n%s", summary)
	}
}

func TestAcceptRunReRunsAnE2ELoadFailure(t *testing.T) {
	root, dir := acceptRepo(t, func(rec *RunRecord, dir string) {
		rec.Stories = &PartResult{Passed: 2551, Log: "stories.log"}
		rec.E2E.Batches = append(rec.E2E.Batches, &BatchResult{N: 2, Worker: "w1", Exit: 1,
			Specs: []string{"a_ok.spec.ts", "b_broken.spec.ts", "c_ok.spec.ts"}, Log: "D:/gone/w1-b2.log"})

		err := os.WriteFile(filepath.Join(dir, "w1-b2.json"), []byte(fixture(t, "pw_missing_import.json")), 0o644)
		if err != nil {
			t.Fatal(err)
		}
	})

	var e2eCalls [][]string

	_, err := runAccept(context.Background(), root, acceptRequest{Stamp: acceptStamp}, false,
		fakeAcceptExec(t, map[string]int{}, nil, &e2eCalls), "test", io.Discard)
	if err != nil {
		t.Fatal(err)
	}

	if len(e2eCalls) != 2 || e2eCalls[0][0] != "b_broken.spec.ts" {
		t.Fatalf("the load-failed spec alone, then the two that never ran: %v", e2eCalls)
	}

	rec, _ := readRun(filepath.Join(dir, "run.json"))
	if a := rec.accepted(); a == nil || len(a.Reruns) != 3 || a.Reruns[0].SameAsRun == nil || !*a.Reruns[0].SameAsRun {
		t.Errorf("accepted with three e2e re-runs: %+v", rec.Acceptances)
	}
}

func TestAcceptRunDryRunChangesNothing(t *testing.T) {
	root, dir := acceptRepo(t, nil)
	before, _ := os.ReadFile(filepath.Join(dir, "run.json"))
	calls := map[string]int{}

	var out bytes.Buffer

	_, err := runAccept(context.Background(), root, searchRequest, true, fakeAcceptExec(t, calls, nil, nil), "test", &out)
	if err != nil {
		t.Fatal(err)
	}

	after, _ := os.ReadFile(filepath.Join(dir, "run.json"))
	if len(calls) > 0 || !bytes.Equal(before, after) || !strings.Contains(out.String(), "11 files, each ONCE by itself") {
		t.Errorf("a dry run re-runs and writes nothing:\n%s", out.String())
	}

	_, err = runSan(t, root, "test", "accept-run")
	if err == nil || !strings.Contains(err.Error(), "name the run") {
		t.Errorf("accept-run without a stamp: %v", err)
	}
}
