//go:build raceaudit

// Concurrency audit for AnalyticReplayCompute against the live fold (the audit-sql skill). Helpers are in
// analytic_fold_race_test.go.
//
// The claim under test: a replay holds `process_event_lock` from BEFORE its delete until AFTER its seek, and no fold
// writes in between. A fold already running finishes first (the lock swap waits on its FOR SHARE); a fold arriving
// later is refused (errFoldLocked → 500 → Pub/Sub redelivers).
//
//	TEST_DATABASE_URL=… go test -tags raceaudit -run 'TestRace_Replay|TestInterleave_Replay' -v ./backend/services/supplier_service/supplier_v1/
package supplier_v1_test

import (
	"context"
	"strings"
	"sync"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	"github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_service_models"
)

const figWindow = 31 * 24 * time.Hour

// figParkingBroker is the fold's subscription for a replay that PARKS inside its seek — the range deleted, the lock
// still held. With park false it seeks at once.
type figParkingBroker struct {
	park    bool
	delay   time.Duration
	parked  chan struct{}
	release chan struct{}
	once    sync.Once

	mu     sync.Mutex
	seeked []time.Time
}

func figNewBroker(park bool, delay time.Duration) *figParkingBroker {
	return &figParkingBroker{park: park, delay: delay, parked: make(chan struct{}), release: make(chan struct{})}
}

func (b *figParkingBroker) ReplayWindow(context.Context) (time.Duration, error) {
	return figWindow, nil
}

func (b *figParkingBroker) Seek(_ context.Context, to time.Time) error {
	b.mu.Lock()
	b.seeked = append(b.seeked, to)
	b.mu.Unlock()

	if b.park {
		b.once.Do(func() { close(b.parked) })
		<-b.release
	}

	time.Sleep(b.delay)

	return nil
}

func (b *figParkingBroker) seeks() int {
	b.mu.Lock()
	defer b.mu.Unlock()

	return len(b.seeked)
}

func figReplay(ctx context.Context, svc interface {
	AnalyticReplayCompute(
		context.Context,
		*connect.Request[supplierv1.AnalyticReplayComputeRequest],
	) (*connect.Response[supplierv1.AnalyticReplayComputeResponse], error)
}, start string) (*connect.Response[supplierv1.AnalyticReplayComputeResponse], error) {
	return svc.AnalyticReplayCompute(ctx, connect.NewRequest(&supplierv1.AnalyticReplayComputeRequest{StartDate: start}))
}

func figLock(t *testing.T, db *gorm.DB) string {
	t.Helper()

	return metadata(t, db, supplier_service_models.MetadataProcessEventLock)
}

// figIsLocked reports whether err is the fold's refusal while process_event_lock is held (errFoldLocked).
func figIsLocked(err error) bool {
	return err != nil && strings.Contains(err.Error(), "process_event_lock")
}

// ── A fold IN FLIGHT when the replay starts ─────────────────────────────────────────────────────────

// A fold holds `process_event_lock` FOR SHARE until it commits, so the replay's compare-and-set of the lock WAITS for
// it. The fold therefore lands BEFORE the delete — and the delete removes its figures and its dedup row together, so
// the seek's redelivery folds it again exactly once.
func TestInterleave_Replay_WaitsForAFoldInFlight(t *testing.T) {
	h := figHarness(t)
	ctx := context.Background()
	broker := &fakeBroker{window: figWindow}
	pool := figService(h.DB(), broker)
	start := jakartaDay(5)

	l := line{product: figProductA, ordered: 2, total: 4_000, accepted: 2, lost: 1}
	once := figAdd(figZero, l)

	e0 := accept(60, sellingA, figSupplier, jakartaDay(10), l) // the live fold's first accept
	e1 := accept(61, sellingA, figSupplier, jakartaDay(7), l)  // before the start: kept
	e2 := accept(62, sellingA, figSupplier, jakartaDay(4), l)  // in the range, folded long ago
	e3 := accept(63, sellingA, figSupplier, jakartaDay(3), l)  // in the range, FOLDING as the replay starts

	for _, e := range []*eventsv1.Event{e0, e1, e2} {
		fold(t, pool, e)
	}

	var (
		resp  *connect.Response[supplierv1.AnalyticReplayComputeResponse]
		waits []raceWait
	)

	const stepR = "R replays from day-5 — its lock swap waits on A's FOR SHARE"

	sched := h.Interleave(t,
		san_race.Do("A", "A folds accept 63 on day-3 (uncommitted)", func(tx *gorm.DB) error {
			return figService(tx, nil).FoldHandler()(ctx, e3)
		}),
		// The replay runs on the POOL, as in production — its lock swap commits on its own.
		san_race.Block("R", stepR, func(*gorm.DB) error {
			var err error
			resp, err = figReplay(ctx, pool, start)

			return err
		}),
		san_race.Do("W", "who waits on whom", func(*gorm.DB) error {
			var err error
			waits, err = raceWaiters(h.DB())

			return err
		}),
		san_race.Commit("A"),
		san_race.Commit("R"),
	)
	sched.Report(t)
	raceLogWaiters(t, waits)

	r := sched.Get(stepR)
	if !r.Blocked || !r.Released || r.Err != nil {
		t.Fatalf("R: blocked=%v released=%v err=%v — want blocked, released, ok", r.Blocked, r.Released, r.Err)
	}

	figRequireWaitOn(t, waits, "UPDATE", "supplier_service_metadata")

	// A committed before the delete, so the delete saw it: 2 rows and 2 dedup rows, A's among them.
	if resp.Msg.GetDeletedReportRows() != 2 || resp.Msg.GetDeletedEventLogs() != 2 {
		t.Fatalf("replay deleted %d rows / %d dedup rows, want 2 / 2 (day-4 and A's day-3)",
			resp.Msg.GetDeletedReportRows(), resp.Msg.GetDeletedEventLogs())
	}

	if got := figureRow(t, h.DB(), jakartaDay(3), figSupplier, figProductA, sellingA); got != figZero || figClaimed(t, h.DB(), e3) {
		t.Fatalf("A's figures %+v / claimed %v survived the delete — they would not be rebuilt", got, figClaimed(t, h.DB(), e3))
	}

	if lock := figLock(t, h.DB()); lock != `{"lock":false}` || len(broker.seeked) != 1 {
		t.Fatalf("lock %s, %d seeks — want released, one seek", lock, len(broker.seeked))
	}

	// The seek redelivers everything from the start on.
	for _, e := range []*eventsv1.Event{e2, e3} {
		fold(t, pool, e)
	}

	for _, e := range []*eventsv1.Event{e0, e1, e2, e3} {
		day := e.GetRestockAccepted().GetAcceptedOn()
		if got := figureRow(t, h.DB(), day, figSupplier, figProductA, sellingA); got != once {
			t.Fatalf("%s: %+v, want the accept exactly once", day, got)
		}
	}
}

// ── A fold ARRIVING while the replay holds the lock ─────────────────────────────────────────────────

// Parked at each point of the lock-held window — after the swap but before the figure delete, BETWEEN the two deletes
// (the point where a committed fold would leave its figures but lose its dedup row, and be counted twice by the seek),
// and inside the seek — a fold is REFUSED at once, writes nothing, and holds up nothing. An accept outside the replayed
// range is refused too: the lock is the whole fold's, not the range's.
func TestInterleave_Replay_AFoldWhileTheLockIsHeldIsRefused(t *testing.T) {
	cases := []struct {
		name string
		raw  string // pause the replay before this statement; "" parks it in the seek
	}{
		{name: "after the swap, before the figure delete", raw: "DELETE FROM supplier_product_daily_reports"},
		{name: "between the figure delete and the dedup delete", raw: "DELETE FROM supplier_event_logs"},
		{name: "during the seek", raw: ""},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			h := figHarness(t)
			ctx := context.Background()
			broker := figNewBroker(c.raw == "", 0)
			pool := figService(h.DB(), broker)
			start := jakartaDay(5)

			l := line{product: figProductA, ordered: 2, total: 4_000, accepted: 2, lost: 1}
			once := figAdd(figZero, l)

			e0 := accept(70, sellingA, figSupplier, jakartaDay(10), l) // the live fold's first accept
			e1 := accept(71, sellingA, figSupplier, jakartaDay(7), l)  // arrives during the replay, BEFORE the start
			e2 := accept(72, sellingA, figSupplier, jakartaDay(4), l)  // in the range, folded before
			e3 := accept(73, sellingA, figSupplier, jakartaDay(3), l)  // arrives during the replay, IN the range

			fold(t, pool, e0)
			fold(t, pool, e2)

			replayCtx := ctx
			parked := broker.parked

			var pause *figPause
			if c.raw != "" {
				pause = figNewPause(c.raw, 1)
				replayCtx = pause.into(ctx)
				parked = pause.parked
			}

			done := make(chan error, 1)

			go func() {
				_, err := figReplay(replayCtx, pool, start)
				done <- err
			}()

			select {
			case <-parked:
			case err := <-done:
				t.Fatalf("the replay finished without reaching the pause: %v", err)
			case <-time.After(5 * time.Second):
				t.Fatal("the replay never reached the pause")
			}

			if lock := figLock(t, h.DB()); lock != `{"lock":true}` {
				t.Fatalf("lock is %s while the replay is parked — want held", lock)
			}

			for _, e := range []*eventsv1.Event{e3, e1} {
				fctx, cancel := context.WithTimeout(ctx, 3*time.Second)
				at := time.Now()
				err := pool.FoldHandler()(fctx, e)
				took := time.Since(at)

				cancel()

				day := e.GetRestockAccepted().GetAcceptedOn()
				t.Logf("fold of %s while the replay is parked: %v after %v", day, err, took.Round(time.Millisecond))

				if !figIsLocked(err) {
					t.Fatalf("fold of %s during the replay = %v — want refused (errFoldLocked)", day, err)
				}

				if took > time.Second {
					t.Fatalf("the refusal took %v — the fold waited on the replay", took)
				}

				if got := figureRow(t, h.DB(), day, figSupplier, figProductA, sellingA); got != figZero || figClaimed(t, h.DB(), e) {
					t.Fatalf("a refused fold wrote: figures %+v, claimed %v", got, figClaimed(t, h.DB(), e))
				}
			}

			if pause != nil {
				pause.let()
			}

			close(broker.release) // unused when the broker does not park

			err := <-done
			if err != nil {
				t.Fatalf("replay: %v", err)
			}

			if lock := figLock(t, h.DB()); lock != `{"lock":false}` || broker.seeks() != 1 {
				t.Fatalf("lock %s, %d seeks — want released, one seek", lock, broker.seeks())
			}

			// Pub/Sub retries the two refused deliveries; the seek redelivers the range.
			for _, e := range []*eventsv1.Event{e3, e1, e2} {
				fold(t, pool, e)
			}

			for _, e := range []*eventsv1.Event{e0, e1, e2, e3} {
				day := e.GetRestockAccepted().GetAcceptedOn()
				if got := figureRow(t, h.DB(), day, figSupplier, figProductA, sellingA); got != once {
					t.Fatalf("%s: %+v, want the accept exactly once", day, got)
				}
			}
		})
	}
}

// ── The whole thing at once ──────────────────────────────────────────────────────────────────────────

// A replay and eight live deliveries released together, the deliveries staggered 2 ms apart so some land before the
// lock, some are in flight as it is taken, and some arrive while it is held. Then what Pub/Sub would do: retry the
// refused deliveries and redeliver the range from the seek. Every accept must end counted exactly once — a fold whose
// figures survived the delete but whose dedup row did not would be counted twice; the reverse would be lost.
func TestRace_Replay_BesideLiveFoldsCountsEveryAcceptOnce(t *testing.T) {
	h := figHarness(t)
	ctx := context.Background()
	broker := figNewBroker(false, 10*time.Millisecond) // the lock is held across a 10 ms seek
	svc := figService(h.DB(), broker)
	start := jakartaDay(5)

	refusedTotal, landedTotal := 0, 0

	for round := range 10 {
		figReset(t, h.DB())

		la := line{product: figProductA, ordered: 2, total: 4_000, accepted: 2, lost: 1}
		lb := line{product: figProductB, ordered: 3, total: 9_000, accepted: 1, broken: 1}

		e0 := accept(uint64(round*100+99), sellingA, figSupplier, jakartaDay(10), la, lb)
		fold(t, svc, e0)

		// Days 8 … 1: three before the start, five in the range.
		events := make([]*eventsv1.Event, 8)
		for i := range events {
			events[i] = accept(uint64(round*100+i), sellingA, figSupplier, jakartaDay(8-i), la, lb)
		}

		// Half were folded before the replay — the delete has something to delete, and the race redelivers them.
		for i := 0; i < len(events); i += 2 {
			fold(t, svc, events[i])
		}

		var (
			mu      sync.Mutex
			refused []int
			landed  int
		)

		res := h.Race(t, len(events)+1, func(i int) error {
			if i == len(events) {
				_, err := figReplay(ctx, svc, start)

				return err
			}

			time.Sleep(time.Duration(i) * 2 * time.Millisecond)

			err := svc.FoldHandler()(ctx, events[i])
			if figIsLocked(err) {
				mu.Lock()
				refused = append(refused, i)
				mu.Unlock()

				return nil
			}

			if err == nil {
				mu.Lock()
				landed++
				mu.Unlock()
			}

			return err
		})

		if round == 0 {
			res.Report(t)
		}

		if res.Failed() != 0 {
			res.Report(t)
			t.Fatalf("round %d: %d callers failed", round, res.Failed())
		}

		refusedTotal += len(refused)
		landedTotal += landed

		// Pub/Sub retries the refused deliveries once the lock is released …
		for _, i := range refused {
			fold(t, svc, events[i])
		}

		// … and the seek redelivers every accept from the start on.
		for _, e := range events {
			if e.GetRestockAccepted().GetAcceptedOn() >= start {
				fold(t, svc, e)
			}
		}

		for _, e := range append([]*eventsv1.Event{e0}, events...) {
			day := e.GetRestockAccepted().GetAcceptedOn()
			gotA := figureRow(t, h.DB(), day, figSupplier, figProductA, sellingA)
			gotB := figureRow(t, h.DB(), day, figSupplier, figProductB, sellingA)

			if gotA != figAdd(figZero, la) || gotB != figAdd(figZero, lb) {
				t.Fatalf("round %d, %s: product A %+v / B %+v — want the accept exactly once (refused: %v)",
					round, day, gotA, gotB, refused)
			}
		}

		if lock := figLock(t, h.DB()); lock != `{"lock":false}` {
			t.Fatalf("round %d: lock %s after the replay", round, lock)
		}
	}

	t.Logf("over 10 rounds of 8 deliveries: %d landed, %d refused by the held lock — every accept counted once",
		landedTotal, refusedTotal)

	if refusedTotal == 0 || landedTotal == 0 {
		t.Fatal("the deliveries all landed or were all refused — the replay never overlapped them, so this proved nothing")
	}
}
