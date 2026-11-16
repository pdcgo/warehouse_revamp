package main

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// `san test smoke --isolated` / `san test affected --run --isolated` — a level-2 run on a worker of its own, IN PLACE.
//
// The e2e lane (docs/development_lifecycle_decision.md#the-tester-works-in-its-own-worktree): the dev bot builds in
// the real checkout and runs its Go DB tests on warehouse_test, :8081/:5175, while the tester checks each dev snapshot
// out in a worktree of its own and runs the affected specs and the smoke set there. Run plainly, `smoke` and
// `affected --run` would put the tester on the dev's warehouse_test — the two would reset it under each other.
// --isolated runs the same batches as worker w1 instead, the seat a full run's one worker uses:
//
//	database   warehouse_test_w1, a fresh clone of warehouse_test_tpl per batch (the template migrated and seeded
//	           once per run from THIS tree — so a snapshot's new migration is in it)
//	ports      the first free worker pair from :8181/:5181 (a port another program holds is skipped, never killed)
//	events     the Pub/Sub emulator project warehouse-e2e-w1
//	locks      e2e_report/.full_run.lock (kind smoke / affected) for the whole run — a full run in any checkout of the
//	           repo refuses meanwhile, as this run refuses beside one; frontend/.e2e-lock.w1 per batch (e2e/lock.ts)
//
// It needs no frozen copy: the tester's worktree holds exactly the snapshot and nothing edits it during the run.
// It never moves last_green.json — only a full run does.

const isolatedWorker = "w1"

// isolatedSeat is the worker an --isolated run is: w1's database and events project, on the first free port pair.
func isolatedSeat(busy portBusy) (*e2eWorker, []string, error) {
	apis, uis, skipped, err := pickWorkerPorts(1, busy)
	if err != nil {
		return nil, skipped, err
	}

	return &e2eWorker{
		Name:    isolatedWorker,
		DB:      testDBName + "_" + isolatedWorker,
		APIPort: apis[0],
		UIPort:  uis[0],
		Project: "warehouse-e2e-" + isolatedWorker,
	}, skipped, nil
}

// worktreeRoots lists every checkout of the repo at root (git worktree list) — swapped in tests.
var worktreeRoots = gitWorktreeRoots

func gitWorktreeRoots(root string) ([]string, error) {
	out, err := exec.Command("git", "-C", root, "worktree", "list", "--porcelain").Output()
	if err != nil {
		return nil, err
	}

	return parseWorktreeList(string(out)), nil
}

// parseWorktreeList reads `git worktree list --porcelain`: a "worktree <path>" line opens each entry.
func parseWorktreeList(out string) []string {
	var roots []string

	for _, line := range strings.Split(strings.ReplaceAll(out, "\r\n", "\n"), "\n") {
		path, ok := strings.CutPrefix(line, "worktree ")
		if ok && strings.TrimSpace(path) != "" {
			roots = append(roots, filepath.Clean(filepath.FromSlash(strings.TrimSpace(path))))
		}
	}

	return roots
}

// sameCheckout compares two checkout paths the way Windows does (case-insensitive, either slash).
func sameCheckout(a, b string) bool {
	return strings.EqualFold(filepath.Clean(a), filepath.Clean(b))
}

// otherCheckouts are the repo's worktrees other than root. Not a git checkout (a test's temp dir) → none.
func otherCheckouts(root string) []string {
	roots, err := worktreeRoots(root)
	if err != nil {
		return nil
	}

	var out []string

	for _, r := range roots {
		if !sameCheckout(r, root) {
			out = append(out, r)
		}
	}

	return out
}

// otherCheckoutRefusal says why a run on the template and these workers may not start while another checkout of the
// same repo (at where) has this busy state: a full or --isolated run there (the template is one database for all
// checkouts), or a Playwright run there as one of the workers (warehouse_test_wN is too).
func (s busyState) otherCheckoutRefusal(where string, workers []string) error {
	if s.Full != nil {
		return fmt.Errorf("%s in the other checkout %s — both would use the template %s and %s_w1; wait for it",
			s.Full.what(), where, templateDB, testDBName)
	}

	for _, w := range workers {
		if l := s.Locks[".e2e-lock."+w]; l != nil {
			return fmt.Errorf("a Playwright run as worker %s is live in the other checkout %s (pid %d, started %s) — "+
				"on %s_%s; wait for it", w, where, l.PID, l.StartedAt, testDBName, w)
		}
	}

	return nil
}

// refuseInOtherCheckouts applies otherCheckoutRefusal to every other worktree of the repo.
func refuseInOtherCheckouts(root string, workers []string) error {
	for _, other := range otherCheckouts(root) {
		err := readBusy(other).otherCheckoutRefusal(other, workers)
		if err != nil {
			return err
		}
	}

	return nil
}

// isolatedRefusal says why an --isolated run may not start in this checkout: a full or --isolated run (the same
// template and worker database), or a Playwright run already holding frontend/.e2e-lock.w1.
func (s busyState) isolatedRefusal() error {
	if s.Full != nil {
		return fmt.Errorf("%s — it uses the template %s and %s_%s too; wait for it (go run ./tools/san test report)",
			s.Full.what(), templateDB, testDBName, isolatedWorker)
	}

	if l := s.Locks[".e2e-lock."+isolatedWorker]; l != nil {
		return fmt.Errorf("a Playwright run as worker %s is live in this folder (frontend/.e2e-lock.%s, pid %d, "+
			"started %s); wait for it", isolatedWorker, isolatedWorker, l.PID, l.StartedAt)
	}

	return nil
}

// refuseIsolatedIfBusy is isolatedRefusal here, then otherCheckoutRefusal in every other worktree.
func refuseIsolatedIfBusy(root string) error {
	err := readBusy(root).isolatedRefusal()
	if err != nil {
		return err
	}

	return refuseInOtherCheckouts(root, []string{isolatedWorker})
}

// printIsolatedSeat writes where an --isolated run would run (dry run) or runs.
func printIsolatedSeat(out io.Writer, w *e2eWorker, skipped []string) {
	fmt.Fprintf(out, "  --isolated: in place as worker %s — database %s (a clone of %s per batch) · API :%d · UI :%d · "+
		"events %s\n", w.Name, w.DB, templateDB, w.APIPort, w.UIPort, w.Project)

	for _, s := range skipped {
		fmt.Fprintf(out, "  skipped %s — another program holds it\n", s)
	}
}

// runIsolatedBatches is runLevel2's --isolated half: the lock, the template, every batch as the worker, the cleanup.
// It fills rec (Workers, E2E, Stopped); runLevel2 writes the record.
func runIsolatedBatches(ctx context.Context, root string, rec *RunRecord, batches []level2Batch, dir string,
	deadline time.Time, out io.Writer) error {
	frontend := filepath.Join(root, "frontend")
	frontends := []string{frontend}

	w, skipped, err := isolatedSeat(foreignPortBusy(frontends))
	if err != nil {
		return err
	}

	for _, lb := range batches {
		w.Batches = append(w.Batches, lb.Specs)
	}

	rec.Workers = []*e2eWorker{w}

	err = writeJSON(fullLockPath(root), fullRunLock{PID: os.Getpid(), Started: rec.Started, Workers: []string{w.Name},
		Kind: rec.Kind})
	if err != nil {
		return err
	}

	defer func() { _ = os.Remove(fullLockPath(root)) }()

	printIsolatedSeat(out, w, skipped)
	fmt.Fprintf(out, "→ the template %s, from this tree's migrations\n", templateDB)

	start := time.Now()

	err = prepareTemplate(ctx, root, dir, out)
	if err != nil {
		rec.Stopped = err.Error()
		dropTemplate(context.WithoutCancel(ctx), root, dir)

		return nil
	}

	lock := ".e2e-lock." + w.Name
	ports := []int{w.APIPort, w.UIPort}

	for i, lb := range batches {
		if ctx.Err() != nil {
			rec.Stopped = "interrupted"

			break
		}

		foreign := cleanupRun(frontend, lock, ports, frontends, true, out)

		err = preflightE2E(foreign)
		if err != nil {
			rec.Stopped = err.Error()

			break
		}

		b := &BatchResult{N: i + 1, Worker: w.Name, Specs: lb.Specs}
		fmt.Fprintf(out, "→ %s b%d %s\n", w.Name, b.N, strings.Join(lb.Specs, " "))

		err = runPlaywrightBatch(ctx, frontend, b, lb.Grep, dir, out, w.env()...)

		rec.E2E.Batches = append(rec.E2E.Batches, b)
		mergeSpecs(rec.E2E, b)

		if err != nil {
			rec.Stopped = err.Error()

			break
		}

		if b.Exit != 0 || b.CapHit || b.Counts.Failed > 0 {
			_ = copyDirFiles(filepath.Join(frontend, "test-results", w.Name),
				filepath.Join(dir, "failures", fmt.Sprintf("%s-b%d", w.Name, b.N)))
		}

		if time.Now().After(deadline) && i+1 < len(batches) {
			rec.Stopped = fmt.Sprintf("over the budget after %s-b%d", w.Name, b.N)

			break
		}
	}

	cleanupRun(frontend, lock, ports, frontends, true, io.Discard)
	dropTemplate(context.WithoutCancel(ctx), root, dir)

	w.Secs = int(time.Since(start).Seconds())

	return nil
}
