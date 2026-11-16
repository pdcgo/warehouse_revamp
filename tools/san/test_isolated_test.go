package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

// --isolated level-2 runs (test_isolated.go): the seat, the worktree list, and the refusals across checkouts.

func TestIsolatedSeatIsWorkerOneOnTheFirstFreePair(t *testing.T) {
	w, skipped, err := isolatedSeat(func(port int) bool { return port == 8181 })
	if err != nil {
		t.Fatal(err)
	}

	if w.Name != "w1" || w.DB != "warehouse_test_w1" || w.Project != "warehouse-e2e-w1" {
		t.Errorf("seat %+v — want worker w1 on warehouse_test_w1, warehouse-e2e-w1", w)
	}

	if w.APIPort != 8182 || w.UIPort != 5182 {
		t.Errorf("ports :%d/:%d — want :8182/:5182 (:8181 is held by another program)", w.APIPort, w.UIPort)
	}

	if strings.Join(skipped, " ") != ":8181/:5181" {
		t.Errorf("skipped %v", skipped)
	}

	env := strings.Join(w.env(), " ")
	for _, want := range []string{"E2E_WORKER=w1", "E2E_DB_NAME=warehouse_test_w1", "E2E_DB_TEMPLATE=warehouse_test_tpl",
		"E2E_API_PORT=8182", "E2E_UI_PORT=5182", "E2E_PUBSUB_PROJECT=warehouse-e2e-w1"} {
		if !strings.Contains(env, want) {
			t.Errorf("env %q lacks %s", env, want)
		}
	}
}

func TestParseWorktreeList(t *testing.T) {
	out := "worktree D:/pdcgo/warehouse_revamp\r\nHEAD d0d9ecd4\r\nbranch refs/heads/backup/inventory\r\n\r\n" +
		"worktree D:/pdcgo/warehouse_revamp_e2e\nHEAD f4b7572c\ndetached\n\n"

	got := parseWorktreeList(out)
	want := []string{filepath.Clean("D:/pdcgo/warehouse_revamp"), filepath.Clean("D:/pdcgo/warehouse_revamp_e2e")}

	if strings.Join(got, "|") != strings.Join(want, "|") {
		t.Errorf("parseWorktreeList = %q, want %q", got, want)
	}
}

func TestOtherCheckoutsLeavesOutItself(t *testing.T) {
	defer func(f func(string) ([]string, error)) { worktreeRoots = f }(worktreeRoots)

	worktreeRoots = func(string) ([]string, error) {
		return []string{filepath.Clean("D:/pdcgo/warehouse_revamp"), filepath.Clean("D:/pdcgo/warehouse_revamp_e2e")}, nil
	}

	got := otherCheckouts("d:\\PDCGO\\warehouse_revamp_e2e")
	if len(got) != 1 || !sameCheckout(got[0], "D:/pdcgo/warehouse_revamp") {
		t.Errorf("otherCheckouts = %q — want the dev checkout only", got)
	}

	worktreeRoots = func(string) ([]string, error) { return nil, errors.New("not a git repository") }

	if got := otherCheckouts("D:/x"); len(got) != 0 {
		t.Errorf("not a checkout: %q, want none", got)
	}
}

func TestIsolatedRefusals(t *testing.T) {
	alive := &e2eLock{PID: 42, StartedAt: "x"}
	full := &fullRunLock{PID: 42, Started: time.Now(), Copy: "D:/c", Workers: []string{"w1"}}
	smoke := &fullRunLock{PID: 42, Started: time.Now(), Workers: []string{"w1"}, Kind: "smoke"}

	cases := []struct {
		name      string
		state     busyState
		isolated  string // "" = it may start
		accept    string
		full      string
		liveTree  string
		otherSide string // otherCheckoutRefusal for worker w1
	}{
		{name: "nothing live", state: busyState{Locks: map[string]*e2eLock{}}},
		{
			name:  "the live tree's own smoke (.e2e-lock): another database",
			state: busyState{Locks: map[string]*e2eLock{".e2e-lock": alive}},
			// The live tree's smoke refuses a second live-tree run (and accept-run's re-runs there) only.
			liveTree: "another e2e run is live", accept: "another e2e run is live",
		},
		{
			name: "a full run", state: busyState{Full: full, Locks: map[string]*e2eLock{}},
			isolated: "a full run is live", accept: "a full run is live", full: "a full run is live",
			otherSide: "a full run is live",
		},
		{
			name: "an --isolated smoke run", state: busyState{Full: smoke, Locks: map[string]*e2eLock{}},
			// It never moves last_green.json, so accept-run (on warehouse_test) may go on.
			isolated: "an --isolated smoke run is live", full: "an --isolated smoke run is live",
			otherSide: "an --isolated smoke run is live",
		},
		{
			name: "a Playwright run as w1", state: busyState{Locks: map[string]*e2eLock{".e2e-lock.w1": alive}},
			isolated: "worker w1 is live", full: "runs as worker w1", otherSide: "worker w1 is live",
		},
		{
			name: "a Playwright run as w2", state: busyState{Locks: map[string]*e2eLock{".e2e-lock.w2": alive}},
		},
	}

	for _, c := range cases {
		check := func(who string, err error, want string) {
			switch {
			case want == "" && err != nil:
				t.Errorf("%s: %s refused — %v", c.name, who, err)
			case want != "" && (err == nil || !strings.Contains(err.Error(), want)):
				t.Errorf("%s: %s = %v, want %q", c.name, who, err, want)
			}
		}

		check("an --isolated run", c.state.isolatedRefusal(), c.isolated)
		check("accept-run", c.state.acceptRefusal(), c.accept)
		check("a full run", c.state.fullRefusal(false, []string{"w1"}), c.full)
		check("the live tree's smoke", c.state.liveTreeRefusal(), c.liveTree)
		check("a run in the other checkout", c.state.otherCheckoutRefusal("D:/other", []string{"w1"}), c.otherSide)
	}
}

// A full run in the dev checkout stops the tester's --isolated run in its worktree, and the other way round.
func TestRefusalsReachAcrossCheckouts(t *testing.T) {
	dev, wt := t.TempDir(), t.TempDir()

	for _, r := range []string{dev, wt} {
		err := os.MkdirAll(filepath.Join(r, "frontend"), 0o755)
		if err != nil {
			t.Fatal(err)
		}

		err = os.MkdirAll(reportDir(r), 0o755)
		if err != nil {
			t.Fatal(err)
		}
	}

	defer func(f func(string) ([]string, error)) { worktreeRoots = f }(worktreeRoots)

	worktreeRoots = func(string) ([]string, error) { return []string{dev, wt}, nil }

	err := refuseIsolatedIfBusy(wt)
	if err != nil {
		t.Fatalf("nothing live, yet refused: %v", err)
	}

	other := os.Getppid() // a live process that is not this one

	writeLock := func(root string, l fullRunLock) {
		b, err := json.Marshal(l)
		if err != nil {
			t.Fatal(err)
		}

		err = os.WriteFile(fullLockPath(root), b, 0o644)
		if err != nil {
			t.Fatal(err)
		}
	}

	writeLock(dev, fullRunLock{PID: other, Started: time.Now(), Copy: "D:/c", Workers: []string{"w1"}})

	err = refuseIsolatedIfBusy(wt)
	if err == nil || !strings.Contains(err.Error(), "in the other checkout") || !strings.Contains(err.Error(), "a full run is live") {
		t.Errorf("a full run in the dev checkout: %v", err)
	}

	err = refuseFullIfBusy(wt, false, []string{"w1"})
	if err == nil || !strings.Contains(err.Error(), "in the other checkout") {
		t.Errorf("a second full run, from the worktree: %v", err)
	}

	err = os.Remove(fullLockPath(dev))
	if err != nil {
		t.Fatal(err)
	}

	writeLock(wt, fullRunLock{PID: other, Started: time.Now(), Workers: []string{"w1"}, Kind: "affected"})

	err = refuseFullIfBusy(dev, false, []string{"w1"})
	if err == nil || !strings.Contains(err.Error(), "an --isolated affected run is live") {
		t.Errorf("a full run in the dev checkout beside the worktree's --isolated run: %v", err)
	}

	// The dev checkout's own smoke and Go DB tests (warehouse_test) are not stopped by it.
	err = refuseIfBusy(dev)
	if err != nil {
		t.Errorf("the dev checkout's smoke refused: %v", err)
	}

	err = os.Remove(fullLockPath(wt))
	if err != nil {
		t.Fatal(err)
	}

	// A Playwright run as w1 in the dev checkout (a hand-started repro) stops the worktree's --isolated run.
	err = os.WriteFile(filepath.Join(dev, "frontend", ".e2e-lock.w1"),
		[]byte(`{"pid":`+strconv.Itoa(other)+`,"startedAt":"x"}`), 0o644)
	if err != nil {
		t.Fatal(err)
	}

	err = refuseIsolatedIfBusy(wt)
	if err == nil || !strings.Contains(err.Error(), "worker w1 is live in the other checkout") {
		t.Errorf("a w1 Playwright run in the dev checkout: %v", err)
	}
}
