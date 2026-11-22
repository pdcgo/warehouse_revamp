//go:build raceaudit

// Concurrency audit for AnalyticReplayCompute against the SALES fold — Penjualan, replayed with the restock figures
// (the-report-is-processed-like-settlement). The restock side is analytic_replay_compute_race_test.go; the helpers are
// in analytic_fold_race_test.go.
//
// The claim under test: the sales fold reads `process_event_lock` FOR SHARE as the restock fold does, so a replay's
// flip waits for a sales fold in flight, and a sales fold arriving while the replay clears Penjualan's range is refused
// (errFoldLocked → 500 → Pub/Sub redelivers) — and every order ends counted once on its days.
//
//	go test -tags raceaudit -p 1 -run 'TestRace_ReplaySales|TestInterleave_ReplaySales' -v ./backend/services/supplier_service/supplier_v1/
package supplier_v1_test

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

	"gorm.io/gorm"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	supplier_v1 "github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_v1"
)

// rsUnits is what every order of these tests takes from Sumber: 3 Kaos, Rp 30.000.
const rsUnits int64 = 3

func rsHarness(t *testing.T) *san_race.Harness {
	t.Helper()

	h := san_race.New(t, append(append([]string{}, figTables...), salesRaceTables...)...)
	figInstallRawPause(h.DB())
	figResetMetadata(t, h.DB())
	t.Cleanup(func() { figResetMetadata(t, h.DB()) })

	return h
}

// rsGoods takes 3 Kaos from Sumber's batch for every transaction asked.
type rsGoods struct{ fakeGoods }

func (rsGoods) OrderTakeSuppliers(_ context.Context, _ uint64) ([]supplier_v1.SaleTakePart, error) {
	return []supplier_v1.SaleTakePart{{ProductID: salKaos, SupplierID: salSumber, TeamID: sellingA, WarehouseID: 5, Units: rsUnits}}, nil
}

func rsService(db *gorm.DB, broker supplier_v1.ReplayBroker) *supplier_v1.Service {
	return supplier_v1.NewService(db, nil, broker, &rsGoods{}, nil, nil)
}

func rsPlaced(order uint64, daysAgo int) *eventsv1.Event {
	return salePlaced(order, order, wib(jakartaDay(daysAgo), "10:00"), 30_000, saleLine(salKaos, 3, 30_000))
}

func rsCancelled(order uint64, daysAgo int) *eventsv1.Event {
	return saleCancelled(order, wib(jakartaDay(daysAgo), "11:00"))
}

// rsDay is Sumber's Penjualan units on one Jakarta day, over every product, team and warehouse.
func rsDay(t *testing.T, db *gorm.DB, day string) int64 {
	t.Helper()

	var units int64

	err := db.
		Raw(`SELECT COALESCE(SUM(sales_count), 0) FROM supplier_sale_daily_reports WHERE day = CAST(? AS date) AND supplier_id = ?`,
			day, salSumber).
		Scan(&units).
		Error
	if err != nil {
		t.Fatalf("read %s: %v", day, err)
	}

	return units
}

// rsExpect is what the events add up to on each day — each placement +3 on its day, each cancel −3 on its own — every
// event exactly once.
func rsExpect(events []*eventsv1.Event) map[string]int64 {
	out := map[string]int64{}

	for _, e := range events {
		day := e.GetOccurredAt().AsTime().In(time.FixedZone("WIB", 7*3600)).Format("2006-01-02")

		if e.GetOrderPlaced() != nil {
			out[day] += rsUnits
		} else {
			out[day] -= rsUnits
		}
	}

	return out
}

func rsCheck(t *testing.T, db *gorm.DB, name string, events []*eventsv1.Event) {
	t.Helper()

	for day, want := range rsExpect(events) {
		if got := rsDay(t, db, day); got != want {
			t.Fatalf("%s, %s: Sumber sold %d, want %d — every order exactly once", name, day, got, want)
		}
	}
}

func rsSaleClaimed(t *testing.T, db *gorm.DB, order uint64) bool {
	t.Helper()

	var n int64

	err := db.Raw(`SELECT COUNT(*) FROM supplier_sale_orders WHERE order_id = ?`, order).Scan(&n).Error
	if err != nil {
		t.Fatalf("read order %d's claim: %v", order, err)
	}

	return n == 1
}

// ── A sales fold IN FLIGHT when the replay starts ───────────────────────────────────────────────────

// A sales fold holds `process_event_lock` FOR SHARE until it commits, so the replay's compare-and-set of the lock WAITS
// for it. The fold therefore lands BEFORE the delete — and the delete removes its day row and its claim together, so the
// seek's redelivery folds it again exactly once.
func TestInterleave_ReplaySales_WaitsForASaleFoldInFlight(t *testing.T) {
	h := rsHarness(t)
	ctx := context.Background()
	broker := &fakeBroker{window: figReplayWindow}
	pool := rsService(h.DB(), broker)
	start := jakartaDay(5)

	fold(t, pool, accept(80, sellingA, figSupplier, jakartaDay(10), line{product: figProductA, ordered: 1, total: 1_000, accepted: 1}))

	p1 := rsPlaced(8_001, 8) // before the start: kept
	p2 := rsPlaced(8_002, 4) // in the range, folded long ago
	p3 := rsPlaced(8_003, 3) // in the range, FOLDING as the replay starts

	salesFold(t, pool, p1)
	salesFold(t, pool, p2)

	var waits []raceWait

	const stepR = "R replays from day-5 — its lock swap waits on A's FOR SHARE"

	sched := h.Interleave(t,
		san_race.Do("A", "A folds order 8003's placement on day-3 (uncommitted)", func(tx *gorm.DB) error {
			return rsService(tx, nil).SalesFoldHandler()(ctx, p3)
		}),
		san_race.Block("R", stepR, func(*gorm.DB) error {
			_, err := figReplay(ctx, pool, start)

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
		t.Fatalf("R: blocked=%v released=%v err=%v — want blocked behind the sales fold, released, ok", r.Blocked, r.Released, r.Err)
	}

	figRequireWaitOn(t, waits, "UPDATE", "supplier_service_metadata")

	// A committed before the delete, so the delete saw it: its row and its claim are gone, as order 8002's.
	if rsDay(t, h.DB(), jakartaDay(3)) != 0 || rsSaleClaimed(t, h.DB(), 8_003) || rsSaleClaimed(t, h.DB(), 8_002) {
		t.Fatalf("A's sale (%d units, claimed %v) survived the delete — the seek would not rebuild it",
			rsDay(t, h.DB(), jakartaDay(3)), rsSaleClaimed(t, h.DB(), 8_003))
	}

	if !rsSaleClaimed(t, h.DB(), 8_001) || rsDay(t, h.DB(), jakartaDay(8)) != rsUnits {
		t.Fatal("the sale before the start was touched")
	}

	if lock := figLock(t, h.DB()); lock != `{"lock":false}` || len(broker.seeked) != 1 {
		t.Fatalf("lock %s, %d seeks — want released, one seek", lock, len(broker.seeked))
	}

	// The seek redelivers everything from the start on — and may bring order 8001's too.
	for _, e := range []*eventsv1.Event{p3, p2, p1} {
		salesFold(t, pool, e)
	}

	rsCheck(t, h.DB(), "after the seek", []*eventsv1.Event{p1, p2, p3})
}

// ── A sales fold ARRIVING while the replay holds the lock ───────────────────────────────────────────

// Parked at each point of the lock-held window that touches Penjualan — before its day-row delete, BETWEEN the claims'
// delete and the forgetting of a cancel (a fold committing there would see a half-cleared order), after it, and inside
// the seek — a placement and a cancel are REFUSED at once, write nothing, and hold up nothing. A placement BEFORE the
// range is refused too: the lock is the whole fold's, not the range's.
func TestInterleave_ReplaySales_ASaleFoldWhileTheLockIsHeldIsRefused(t *testing.T) {
	cases := []struct {
		name string
		raw  string // pause the replay before this statement; "" parks it in the seek
	}{
		{name: "before the sale rows' delete", raw: "DELETE FROM supplier_sale_daily_reports"},
		{name: "before the claims' delete", raw: "DELETE FROM supplier_sale_orders"},
		{name: "before a cancel is forgotten", raw: "UPDATE supplier_sale_orders"},
		{name: "during the seek", raw: ""},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			h := rsHarness(t)
			ctx := context.Background()
			broker := figNewBroker(c.raw == "", 0)
			pool := rsService(h.DB(), broker)
			start := jakartaDay(5)

			fold(t, pool, accept(81, sellingA, figSupplier, jakartaDay(10), line{product: figProductA, ordered: 1, total: 1_000, accepted: 1}))

			p11, c11 := rsPlaced(8_011, 8), rsCancelled(8_011, 3) // placed before, cancelled in the range
			p12, c12 := rsPlaced(8_012, 4), rsCancelled(8_012, 2) // in the range; its cancel arrives DURING the replay
			p13 := rsPlaced(8_013, 2)                             // in the range, arrives during the replay
			p14 := rsPlaced(8_014, 7)                             // before the range, arrives during the replay

			for _, e := range []*eventsv1.Event{p11, c11, p12} {
				salesFold(t, pool, e)
			}

			replayCtx := ctx
			parked := broker.parked

			var pause *figPause
			if c.raw != "" {
				pause = figNewPause(c.raw, 1)
				replayCtx = pause.into(ctx)
				parked = pause.parked
			}

			// Let the parked replay go — once, and on a failure too: a replay left parked holds its delete's row locks,
			// and the harness's cleanup would wait on them for ever.
			var letOnce sync.Once

			letGo := func() {
				letOnce.Do(func() {
					if pause != nil {
						pause.let()
					}

					close(broker.release) // unused when the broker does not park
				})
			}
			defer letGo()

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

			for _, e := range []*eventsv1.Event{p13, c12, p14} {
				fctx, cancel := context.WithTimeout(ctx, 3*time.Second)
				at := time.Now()
				err := pool.SalesFoldHandler()(fctx, e)
				took := time.Since(at)

				cancel()

				t.Logf("sales fold of %s while the replay is parked: %v after %v", e.GetEventId(), err, took.Round(time.Millisecond))

				if !figIsLocked(err) {
					t.Fatalf("sales fold of %s during the replay = %v — want refused (errFoldLocked)", e.GetEventId(), err)
				}

				if took > time.Second {
					t.Fatalf("the refusal took %v — the fold waited on the replay", took)
				}
			}

			if rsSaleClaimed(t, h.DB(), 8_013) || rsSaleClaimed(t, h.DB(), 8_014) {
				t.Fatal("a refused sales fold claimed its order")
			}

			letGo()

			err := <-done
			if err != nil {
				t.Fatalf("replay: %v", err)
			}

			if lock := figLock(t, h.DB()); lock != `{"lock":false}` || broker.seeks() != 1 {
				t.Fatalf("lock %s, %d seeks — want released, one seek", lock, broker.seeks())
			}

			// Pub/Sub retries the three refused deliveries; the seek redelivers the range (and order 8011's placement,
			// from before it, which folds nothing).
			for _, e := range []*eventsv1.Event{p13, c12, p14, c11, p12, p11, p13} {
				salesFold(t, pool, e)
			}

			rsCheck(t, h.DB(), "after the retries and the seek", []*eventsv1.Event{p11, c11, p12, c12, p13, p14})
		})
	}
}

// ── The whole thing at once ──────────────────────────────────────────────────────────────────────────

// A replay and ten live sales deliveries released together — placements and cancels, before the range and in it, the
// deliveries staggered 2 ms apart so some land before the lock, some are in flight as it is taken, and some arrive while
// it is held. Then what Pub/Sub would do: retry the refused deliveries and redeliver the range from the seek. Every
// order must end counted exactly once on its days — a claim surviving the delete beside its deleted day row would lose
// the sale, a day row surviving beside its deleted claim would count it twice.
func TestRace_ReplaySales_BesideLiveSalesCountsEveryOrderOnce(t *testing.T) {
	h := rsHarness(t)
	ctx := context.Background()
	broker := figNewBroker(false, 10*time.Millisecond) // the lock is held across a 10 ms seek
	svc := rsService(h.DB(), broker)
	start := jakartaDay(5)

	refusedTotal, landedTotal := 0, 0

	for round := range 10 {
		figReset(t, h.DB())

		for _, table := range salesRaceTables {
			err := h.DB().Exec(`DELETE FROM ` + table).Error
			if err != nil {
				t.Fatalf("reset %s: %v", table, err)
			}
		}

		fold(t, svc, accept(uint64(round*100+99), sellingA, figSupplier, jakartaDay(10),
			line{product: figProductA, ordered: 1, total: 1_000, accepted: 1}))

		// Ten orders placed day-9 … day-1 (four before the start, the rest in it); every other one cancelled two days
		// later. The events are the orders' placements, then their cancels.
		var placements, cancels []*eventsv1.Event

		for i := range 9 {
			order := uint64(10_000 + round*100 + i)
			placements = append(placements, rsPlaced(order, 9-i))

			if i%2 == 0 && 9-i-2 >= 1 {
				cancels = append(cancels, rsCancelled(order, 9-i-2))
			}
		}

		all := append(append([]*eventsv1.Event{}, placements...), cancels...)

		// Half were folded before the replay — the delete has something to delete, and the race redelivers them.
		var live []*eventsv1.Event

		for i, e := range all {
			if i%2 == 0 {
				salesFold(t, svc, e)
			} else {
				live = append(live, e)
			}
		}

		var (
			mu      sync.Mutex
			refused []*eventsv1.Event
			landed  int
		)

		res := h.Race(t, len(live)+1, func(i int) error {
			if i == len(live) {
				_, err := figReplay(ctx, svc, start)

				return err
			}

			time.Sleep(time.Duration(i) * 2 * time.Millisecond)

			err := svc.SalesFoldHandler()(ctx, live[i])
			if figIsLocked(err) {
				mu.Lock()
				refused = append(refused, live[i])
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
		for _, e := range refused {
			salesFold(t, svc, e)
		}

		// … and the seek redelivers every event from the start's Jakarta midnight on.
		for _, e := range all {
			if e.GetOccurredAt().AsTime().In(time.FixedZone("WIB", 7*3600)).Format("2006-01-02") >= start {
				salesFold(t, svc, e)
			}
		}

		rsCheck(t, h.DB(), fmt.Sprintf("round %d", round), all)

		if lock := figLock(t, h.DB()); lock != `{"lock":false}` {
			t.Fatalf("round %d: lock %s after the replay", round, lock)
		}
	}

	t.Logf("over 10 rounds of sales deliveries beside a replay: %d landed, %d refused by the held lock — every order counted once",
		landedTotal, refusedTotal)

	if refusedTotal == 0 || landedTotal == 0 {
		t.Fatal("the deliveries all landed or were all refused — the replay never overlapped them, so this proved nothing")
	}
}
