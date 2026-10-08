//go:build raceaudit

// Concurrency audit for supplier_service's FIGURES — the fold (FoldHandler → fold, and FoldBackfill through the same
// fold) — the audit-sql skill. The replay's side is analytic_replay_compute_race_test.go.
//
// ⚠ Never `san_testdb.DB(t)`: the fold's claim, its row locks and the replay's lock only mean anything across real,
// separate, COMMITTING transactions. Everything here runs on san_race over the pool.
//
//	TEST_DATABASE_URL=… go test -tags raceaudit -run 'TestRace_Fold|TestInterleave_Fold' -v ./backend/services/supplier_service/supplier_v1/
package supplier_v1_test

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"gorm.io/gorm"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	"github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_service_models"
	supplier_v1 "github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_v1"
)

// figTables are the fold's own tables, deleted before and after each test. supplier_service_metadata is NOT one of
// them: it holds the migration-seeded `process_event_lock`, without which every fold errors — figResetMetadata puts
// it back to `{"lock":false}` and drops every other key instead.
var figTables = []string{"supplier_product_daily_reports", "supplier_event_logs"}

const (
	figSupplier uint64 = 31
	figProductA uint64 = 100
	figProductB uint64 = 200

	// figUpsert is the start of the fold's figure statement — what a waiter is checked against.
	figUpsert = "INSERT INTO supplier_product_daily_reports"
)

func figHarness(t *testing.T) *san_race.Harness {
	t.Helper()

	h := san_race.New(t, figTables...)
	figInstallRawPause(h.DB())
	figResetMetadata(t, h.DB())
	t.Cleanup(func() { figResetMetadata(t, h.DB()) })

	return h
}

func figResetMetadata(t *testing.T, db *gorm.DB) {
	t.Helper()

	for _, stmt := range []string{
		`DELETE FROM supplier_service_metadata WHERE key <> 'process_event_lock'`,
		`INSERT INTO supplier_service_metadata (key, value) VALUES ('process_event_lock', '{"lock":false}')
		 ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
	} {
		err := db.Exec(stmt).Error
		if err != nil {
			t.Fatalf("reset metadata: %v", err)
		}
	}
}

// figReset empties the figures between the rounds of one test.
func figReset(t *testing.T, db *gorm.DB) {
	t.Helper()

	for _, table := range figTables {
		err := db.Exec(`DELETE FROM ` + table).Error
		if err != nil {
			t.Fatalf("reset %s: %v", table, err)
		}
	}

	figResetMetadata(t, db)
}

// figService is the real service over db — the pool, or one Interleave transaction (where the fold's own Transaction
// becomes a SAVEPOINT, and its locks are held until that transaction ends). A nil broker refuses every replay.
func figService(db *gorm.DB, broker supplier_v1.ReplayBroker) *supplier_v1.Service {
	return supplier_v1.NewService(db, nil, broker)
}

// figAdd is what folding these lines adds to a row: the units, and their value at the line's price.
func figAdd(c supplier_service_models.SupplierMetricColumns, lines ...line) supplier_service_models.SupplierMetricColumns {
	for _, l := range lines {
		value := func(units int64) int64 {
			if l.ordered <= 0 {
				return 0
			}

			return l.total * units / l.ordered
		}

		c.RestockCount += l.accepted
		c.RestockValuation += value(l.accepted)
		c.ShippingLostCount += l.lost
		c.ShippingLostValuation += value(l.lost)
		c.ShippingBrokenCount += l.broken
		c.ShippingBrokenValuation += value(l.broken)
	}

	return c
}

var figZero = supplier_service_models.SupplierMetricColumns{}

// figClaimed reports whether the event has its dedup row.
func figClaimed(t *testing.T, db *gorm.DB, event *eventsv1.Event) bool {
	t.Helper()

	var n int64

	err := db.Raw(`SELECT COUNT(*) FROM supplier_event_logs WHERE id = ?`, event.GetEventId()).Scan(&n).Error
	if err != nil {
		t.Fatalf("read dedup: %v", err)
	}

	return n == 1
}

// figLiveSince is the value a live fold of this event writes to `figures_live_since`.
func figLiveSince(event *eventsv1.Event) string {
	return event.GetOccurredAt().AsTime().UTC().Format("2006-01-02T15:04:05.000000Z")
}

// figRequireWaitOn fails unless some backend was waiting with a query containing every part.
func figRequireWaitOn(t *testing.T, waits []raceWait, parts ...string) {
	t.Helper()

	for _, w := range waits {
		all := true

		for _, p := range parts {
			if !strings.Contains(w.Waiting, p) {
				all = false

				break
			}
		}

		if all {
			return
		}
	}

	t.Fatalf("no backend was waiting on %q — the lock this test is about is not the one that held", parts)
}

// ── The raw-statement pause ─────────────────────────────────────────────────────────────────────────
//
// The fold and the replay write through tx.Exec, which runs GORM's RAW callback — not the create/query/update ones
// race_helpers_race_test.go hooks. This parks a handler before the nth raw statement whose SQL contains `match`,
// keyed on the handler's ctx, so every other caller is untouched and the handler itself is unchanged.

type figPauseKey struct{}

type figPause struct {
	match    string
	nth      int32
	seen     atomic.Int32
	parked   chan struct{}
	release  chan struct{}
	parkOnce sync.Once
	letOnce  sync.Once
}

func figNewPause(match string, nth int32) *figPause {
	return &figPause{match: match, nth: nth, parked: make(chan struct{}), release: make(chan struct{})}
}

func (p *figPause) into(ctx context.Context) context.Context {
	return context.WithValue(ctx, figPauseKey{}, p)
}

func (p *figPause) hit(sql string) {
	if !strings.Contains(sql, p.match) {
		return
	}

	if p.seen.Add(1) != p.nth {
		return
	}

	p.parkOnce.Do(func() { close(p.parked) })
	<-p.release
}

// waitParked reports whether the handler reached the pause within d.
func (p *figPause) waitParked(d time.Duration) bool {
	select {
	case <-p.parked:
		return true
	case <-time.After(d):
		return false
	}
}

// let releases the handler — now, or the moment it gets there. Safe to call twice.
func (p *figPause) let() {
	p.letOnce.Do(func() { close(p.release) })
}

var figHooksOnce sync.Once

func figInstallRawPause(db *gorm.DB) {
	figHooksOnce.Do(func() {
		err := db.Callback().Raw().Before("gorm:raw").Register("fig:pause_raw", func(tx *gorm.DB) {
			ctx := tx.Statement.Context
			if ctx == nil {
				return
			}

			p, ok := ctx.Value(figPauseKey{}).(*figPause)
			if ok && p != nil {
				p.hit(tx.Statement.SQL.String())
			}
		})
		if err != nil {
			panic(err)
		}
	})
}

// ── 1a · two DIFFERENT accepts on one row ───────────────────────────────────────────────────────────

// Eight accepts of one supplier, product, team and day folded at once: every increment lands. Even rounds start with
// no row, so the eight INSERTs race on the unique key; odd rounds start from an existing row, so they race on its
// lock. `SET col = d.col + EXCLUDED.col` is one statement, and ON CONFLICT DO UPDATE re-reads the row it locked.
func TestRace_Fold_DifferentAcceptsOnOneRowLoseNothing(t *testing.T) {
	h := figHarness(t)
	svc := figService(h.DB(), nil)
	ctx := context.Background()
	day := jakartaDay(3)

	for round := range 20 {
		figReset(t, h.DB())

		want := figZero

		if round%2 == 1 {
			seed := line{product: figProductA, ordered: 10, total: 10_000, accepted: 5}
			fold(t, svc, accept(uint64(round*100+99), sellingA, figSupplier, day, seed))
			want = figAdd(want, seed)
		}

		events := make([]*eventsv1.Event, 8)

		for i := range events {
			l := line{product: figProductA, ordered: 10, total: 10_000, accepted: int64(i + 1), broken: 1, lost: 1}
			events[i] = accept(uint64(round*100+i), sellingA, figSupplier, day, l)
			want = figAdd(want, l)
		}

		res := h.Race(t, len(events), func(i int) error {
			return svc.FoldHandler()(ctx, events[i])
		})

		if round < 2 {
			res.Report(t)
		}

		if res.Failed() != 0 {
			res.Report(t)
			t.Fatalf("round %d: %d folds failed", round, res.Failed())
		}

		got := figureRow(t, h.DB(), day, figSupplier, figProductA, sellingA)
		if got != want {
			t.Fatalf("round %d: lost an increment — got %+v, want %+v", round, got, want)
		}
	}
}

// The proof behind the race above: B's upsert of the row A is folding WAITS for A — on A's uncommitted INSERT when the
// row is new, on A's row lock when it exists — and once released adds onto A's committed figures.
func TestInterleave_Fold_SecondAcceptWaitsOnTheRowThenAdds(t *testing.T) {
	for _, existing := range []bool{false, true} {
		name := "no row yet: B waits on A's insert"
		if existing {
			name = "the row exists: B waits on A's row lock"
		}

		t.Run(name, func(t *testing.T) {
			h := figHarness(t)
			ctx := context.Background()
			day := jakartaDay(3)
			want := figZero

			if existing {
				seed := line{product: figProductA, ordered: 10, total: 10_000, accepted: 4}
				fold(t, figService(h.DB(), nil), accept(1, sellingA, figSupplier, day, seed))
				want = figAdd(want, seed)
			}

			la := line{product: figProductA, ordered: 10, total: 10_000, accepted: 2, lost: 1}
			lb := line{product: figProductA, ordered: 10, total: 10_000, accepted: 3, broken: 1}
			want = figAdd(want, la, lb)

			var waits []raceWait

			const stepB = "B folds accept 11 onto the same row — waits on A"

			sched := h.Interleave(t,
				san_race.Do("A", "A folds accept 10 (uncommitted)", func(tx *gorm.DB) error {
					return figService(tx, nil).FoldHandler()(ctx, accept(10, sellingA, figSupplier, day, la))
				}),
				san_race.Block("B", stepB, func(tx *gorm.DB) error {
					return figService(tx, nil).FoldHandler()(ctx, accept(11, sellingA, figSupplier, day, lb))
				}),
				san_race.Do("W", "who waits on whom", func(*gorm.DB) error {
					var err error
					waits, err = raceWaiters(h.DB())

					return err
				}),
				san_race.Commit("A"),
				san_race.Commit("B"),
			)
			sched.Report(t)
			raceLogWaiters(t, waits)

			b := sched.Get(stepB)
			if !b.Blocked || !b.Released || b.Err != nil {
				t.Fatalf("B: blocked=%v released=%v err=%v — want blocked, released, ok", b.Blocked, b.Released, b.Err)
			}

			figRequireWaitOn(t, waits, figUpsert)

			got := figureRow(t, h.DB(), day, figSupplier, figProductA, sellingA)
			if got != want {
				t.Fatalf("got %+v, want %+v — B did not add onto A", got, want)
			}
		})
	}
}

// ── 1b · the SAME accept delivered twice at once ─────────────────────────────────────────────────────

// One accept delivered eight times at the same instant (a Pub/Sub redelivery overlapping the original): folded once,
// and every delivery ACKed — the claim is the write, so the losers wait on it, see the conflict and write nothing.
func TestRace_Fold_SameAcceptEightTimesFoldsOnce(t *testing.T) {
	h := figHarness(t)
	svc := figService(h.DB(), nil)
	ctx := context.Background()
	day := jakartaDay(2)

	la := line{product: figProductA, ordered: 4, total: 8_000, accepted: 3, broken: 1}
	lb := line{product: figProductB, ordered: 2, total: 5_000, accepted: 1, lost: 1}

	for round := range 20 {
		figReset(t, h.DB())

		event := accept(uint64(500+round), sellingA, figSupplier, day, la, lb)

		res := h.Race(t, 8, func(int) error {
			return svc.FoldHandler()(ctx, event)
		})

		if round == 0 {
			res.Report(t)
		}

		if res.Failed() != 0 {
			res.Report(t)
			t.Fatalf("round %d: %d deliveries failed", round, res.Failed())
		}

		gotA := figureRow(t, h.DB(), day, figSupplier, figProductA, sellingA)
		gotB := figureRow(t, h.DB(), day, figSupplier, figProductB, sellingA)

		if gotA != figAdd(figZero, la) || gotB != figAdd(figZero, lb) {
			t.Fatalf("round %d: folded more than once — product A %+v, product B %+v", round, gotA, gotB)
		}

		if n := countRows(t, h.DB(), &supplier_service_models.SupplierEventLog{}); n != 1 {
			t.Fatalf("round %d: %d dedup rows, want 1", round, n)
		}
	}
}

// The proof: B's claim of the same event WAITS on A's uncommitted claim. A commits → B's claim conflicts, B folds
// nothing and is ACKed. A rolls back instead → B's claim goes through and B folds it — a failed fold is genuinely
// reprocessed by its redelivery, never mistaken for "already done".
func TestInterleave_Fold_SameAcceptSecondWaitsOnTheClaim(t *testing.T) {
	for _, aCommits := range []bool{true, false} {
		name := "A commits: B skips"
		if !aCommits {
			name = "A rolls back: B folds"
		}

		t.Run(name, func(t *testing.T) {
			h := figHarness(t)
			ctx := context.Background()
			day := jakartaDay(2)
			l := line{product: figProductA, ordered: 4, total: 8_000, accepted: 3, broken: 1}
			event := accept(30, sellingA, figSupplier, day, l)

			end := san_race.Commit("A")
			if !aCommits {
				end = san_race.Rollback("A")
			}

			var waits []raceWait

			const stepB = "B folds the same accept — its claim waits on A's"

			sched := h.Interleave(t,
				san_race.Do("A", "A folds accept 30 (uncommitted)", func(tx *gorm.DB) error {
					return figService(tx, nil).FoldHandler()(ctx, event)
				}),
				san_race.Block("B", stepB, func(tx *gorm.DB) error {
					return figService(tx, nil).FoldHandler()(ctx, event)
				}),
				san_race.Do("W", "who waits on whom", func(*gorm.DB) error {
					var err error
					waits, err = raceWaiters(h.DB())

					return err
				}),
				end,
				san_race.Commit("B"),
			)
			sched.Report(t)
			raceLogWaiters(t, waits)

			b := sched.Get(stepB)
			if !b.Blocked || !b.Released || b.Err != nil {
				t.Fatalf("B: blocked=%v released=%v err=%v — want blocked, released, ok", b.Blocked, b.Released, b.Err)
			}

			figRequireWaitOn(t, waits, "INSERT INTO supplier_event_logs")

			if got := figureRow(t, h.DB(), day, figSupplier, figProductA, sellingA); got != figAdd(figZero, l) {
				t.Fatalf("got %+v, want the accept exactly once", got)
			}

			if !figClaimed(t, h.DB(), event) {
				t.Fatal("the accept has no dedup row")
			}
		})
	}
}

// ── 1c · two accepts whose lines touch the same rows in OPPOSITE order ──────────────────────────────

// ⚠ THE FINDING, AND ITS FIX (FoldHandler.md). The fold wrote a restock's lines one statement each, in the EVENT's
// order: two accepts of one supplier, team and day naming the same two products in opposite orders each locked their
// first row, then waited on the other's — 40P01, proved by pausing each fold before its second line (72 of 90 crossed
// rounds; the history is in the report). The fold is now ONE upsert whose rows are ORDER BY product — there is no
// "second line" left to pause before, so this proves the order itself:
//
//	a third transaction holds product A's row (the lower id) → the accept listing B FIRST folds → it must block on A
//	holding NOTHING — product B's row free. In the event's order it would already hold B, and that is the half of the
//	cycle the deadlock needed.
func TestInterleave_Fold_LocksInProductOrderNotEventOrder(t *testing.T) {
	h := figHarness(t)
	svc := figService(h.DB(), nil)
	day := jakartaDay(2)

	l1 := line{product: figProductA, ordered: 1, total: 1_000, accepted: 1}
	l2 := line{product: figProductB, ordered: 1, total: 2_000, accepted: 1}

	// Both rows exist, so a FOR UPDATE has something to hold.
	fold(t, svc, accept(20, sellingA, figSupplier, day, l1, l2))

	rowOf := func(product uint64) string {
		return fmt.Sprintf(
			"SELECT 1 FROM supplier_product_daily_reports WHERE day = CAST('%s' AS date) AND supplier_id = %d "+
				"AND product_id = %d AND team_id = %d FOR UPDATE", day, figSupplier, product, sellingA)
	}

	blocker := h.DB().Begin()
	defer blocker.Rollback()

	err := blocker.Exec(rowOf(figProductA)).Error
	if err != nil {
		t.Fatalf("blocker: %v", err)
	}

	done := make(chan error, 1)

	go func() {
		// Product B first, as the restock was typed.
		done <- svc.FoldHandler()(context.Background(), accept(22, sellingA, figSupplier, day, l2, l1))
	}()

	// Wait until the fold is blocked — on the blocker, inside its upsert.
	var waits []raceWait

	for deadline := time.Now().Add(5 * time.Second); time.Now().Before(deadline); time.Sleep(20 * time.Millisecond) {
		waits, err = raceWaiters(h.DB())
		if err != nil {
			t.Fatalf("waiters: %v", err)
		}

		if len(waits) > 0 {
			break
		}
	}

	raceLogWaiters(t, waits)
	figRequireWaitOn(t, waits, figUpsert)

	// The proof: while it waits on product A, it holds NOTHING on product B.
	probe := h.DB().Begin()
	probeErr := probe.Exec(rowOf(figProductB) + " NOWAIT").Error
	probe.Rollback()

	blocker.Rollback()

	foldErr := <-done
	if foldErr != nil {
		t.Fatalf("the fold after the blocker let go: %v", foldErr)
	}

	if probeErr != nil {
		t.Fatalf("product B's row was LOCKED while the fold waited on product A — it locks in the event's order, "+
			"the half of a deadlock (FoldHandler.md): %v", probeErr)
	}

	gotA := figureRow(t, h.DB(), day, figSupplier, figProductA, sellingA)
	gotB := figureRow(t, h.DB(), day, figSupplier, figProductB, sellingA)

	if gotA != figAdd(figZero, l1, l1) || gotB != figAdd(figZero, l2, l2) {
		t.Fatalf("product A %+v, product B %+v — want both accepts once", gotA, gotB)
	}

	t.Log("blocked on product A holding nothing on product B — product order, whatever the event's")
}

// The finding with no pause: two accepts of four products each, one forward and one reversed, released together for
// 30 rounds. Before the fix 72 of 90 rounds deadlocked; now none may. Every round is checked for intact data after
// redelivering any victim; the deadlock count is asserted last.
func TestRace_Fold_OppositeLineOrdersNeverDeadlock(t *testing.T) {
	h := figHarness(t)
	svc := figService(h.DB(), nil)
	ctx := context.Background()
	day := jakartaDay(2)

	products := []uint64{101, 102, 103, 104}

	const rounds = 30

	deadlocks, reported := 0, false

	for round := range rounds {
		figReset(t, h.DB())

		fwd := make([]line, 0, len(products))
		rev := make([]line, 0, len(products))

		for i := range products {
			fwd = append(fwd, line{product: products[i], ordered: 1, total: 1_000, accepted: 1})
			rev = append(rev, line{product: products[len(products)-1-i], ordered: 1, total: 1_000, accepted: 1})
		}

		events := []*eventsv1.Event{
			accept(uint64(1000+2*round), sellingA, figSupplier, day, fwd...),
			accept(uint64(1001+2*round), sellingA, figSupplier, day, rev...),
		}

		res := h.Race(t, 2, func(i int) error {
			return svc.FoldHandler()(ctx, events[i])
		})

		if n := res.Count(san_race.Deadlock); n > 0 {
			deadlocks += n

			if !reported {
				t.Logf("round %d:", round)
				res.Report(t)

				reported = true
			}
		}

		for _, o := range res.Outcomes {
			switch o.Kind {
			case san_race.None:
			case san_race.Deadlock:
				fold(t, svc, events[o.I]) // Pub/Sub redelivers the 500
			default:
				t.Fatalf("round %d, fold %d: %v", round, o.I, o.Err)
			}
		}

		for _, p := range products {
			want := figAdd(figZero, line{product: p, ordered: 1, total: 1_000, accepted: 2})
			if got := figureRow(t, h.DB(), day, figSupplier, p, sellingA); got != want {
				t.Fatalf("round %d, product %d: %+v after the redelivery, want %+v", round, p, got, want)
			}
		}
	}

	t.Logf("%d deadlocks in %d rounds of 2 crossed folds — data intact every round after redelivery", deadlocks, rounds)

	if deadlocks > 0 {
		t.Fatalf("%d deadlocks (40P01) — the fold locks a restock's rows in the event's line order "+
			"(audits/services/supplier_service/concurrency/FoldHandler.md)", deadlocks)
	}
}

// ── 1d · `figures_live_since` under concurrent live folds ────────────────────────────────────────────

// Eight live folds of accepts on eight days at once: `figures_live_since` ends at the EARLIEST of them. Even rounds
// start with no key (eight INSERTs race on the unique key), odd rounds with a later value already recorded.
func TestRace_Fold_LiveSinceEndsAtTheEarliest(t *testing.T) {
	h := figHarness(t)
	svc := figService(h.DB(), nil)
	ctx := context.Background()
	l := line{product: figProductA, ordered: 1, total: 1_000, accepted: 1}

	for round := range 20 {
		figReset(t, h.DB())

		if round%2 == 1 {
			fold(t, svc, accept(uint64(round*100+99), sellingA, figSupplier, jakartaDay(1), l))
		}

		events := make([]*eventsv1.Event, 8)
		for i := range events {
			events[i] = accept(uint64(round*100+i), sellingA, figSupplier, jakartaDay(2+i), l)
		}

		res := h.Race(t, len(events), func(i int) error {
			return svc.FoldHandler()(ctx, events[i])
		})

		if round < 2 {
			res.Report(t)
		}

		if res.Failed() != 0 {
			res.Report(t)
			t.Fatalf("round %d: %d folds failed", round, res.Failed())
		}

		want := figLiveSince(events[len(events)-1])
		if got := metadata(t, h.DB(), supplier_service_models.MetadataFiguresLiveSince); got != want {
			t.Fatalf("round %d: figures_live_since = %q, want the earliest accept %q", round, got, want)
		}
	}
}

// The proof: B's write of `figures_live_since` WAITS for A's — ON CONFLICT DO UPDATE locks the row even when its WHERE
// turns out false — and its `EXCLUDED.value < value` is judged against A's COMMITTED value. An earlier B lowers it; a
// later B leaves it.
func TestInterleave_Fold_LiveSinceSecondWaitsThenJudgesTheCommittedValue(t *testing.T) {
	cases := []struct {
		name       string
		recorded   bool // a later value is already there, so both UPDATE rather than INSERT
		aDay, bDay int  // days ago
		wantB      bool // the final value is B's
	}{
		{name: "no key yet, B earlier: lowers after the wait", aDay: 2, bDay: 6, wantB: true},
		{name: "no key yet, B later: leaves A's", aDay: 6, bDay: 2, wantB: false},
		{name: "key recorded, B earlier: lowers after the wait", recorded: true, aDay: 2, bDay: 6, wantB: true},
		{name: "key recorded, B later: leaves A's", recorded: true, aDay: 6, bDay: 2, wantB: false},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			h := figHarness(t)
			ctx := context.Background()

			// Each accept on its own day, so A and B share no figure row: the only thing between them is the key.
			l := line{product: figProductA, ordered: 1, total: 1_000, accepted: 1}

			if c.recorded {
				fold(t, figService(h.DB(), nil), accept(1, sellingA, figSupplier, jakartaDay(1), l))
			}

			a := accept(40, sellingA, figSupplier, jakartaDay(c.aDay), l)
			b := accept(41, sellingA, figSupplier, jakartaDay(c.bDay), l)

			var waits []raceWait

			const stepB = "B folds — its figures_live_since write waits on A's"

			sched := h.Interleave(t,
				san_race.Do("A", "A folds (uncommitted)", func(tx *gorm.DB) error {
					return figService(tx, nil).FoldHandler()(ctx, a)
				}),
				san_race.Block("B", stepB, func(tx *gorm.DB) error {
					return figService(tx, nil).FoldHandler()(ctx, b)
				}),
				san_race.Do("W", "who waits on whom", func(*gorm.DB) error {
					var err error
					waits, err = raceWaiters(h.DB())

					return err
				}),
				san_race.Commit("A"),
				san_race.Commit("B"),
			)
			sched.Report(t)
			raceLogWaiters(t, waits)

			s := sched.Get(stepB)
			if !s.Blocked || !s.Released || s.Err != nil {
				t.Fatalf("B: blocked=%v released=%v err=%v — want blocked, released, ok", s.Blocked, s.Released, s.Err)
			}

			figRequireWaitOn(t, waits, "INSERT INTO supplier_service_metadata")

			want := figLiveSince(a)
			if c.wantB {
				want = figLiveSince(b)
			}

			if got := metadata(t, h.DB(), supplier_service_models.MetadataFiguresLiveSince); got != want {
				t.Fatalf("figures_live_since = %q, want %q", got, want)
			}
		})
	}
}

// ── 2 · FoldBackfill beside the live fold ───────────────────────────────────────────────────────────

// Two backfills and six live deliveries of the SAME eight accepts, all at once — every accept counted exactly once.
// The accepts fall on two days, so different accepts also share rows. Lines are in one product order throughout, so
// this measures the claim, not the line-order deadlock above.
//
// The live fold already started on a LATER day, and the live deliveries are held at a gate until a backfill has read
// its cutoff, so the backfill does not skip these accepts and must race the live deliveries on the claim. Without
// that, a live delivery lowers the cutoff first and the backfill skips everything — racing nothing.
func TestRace_FoldBackfill_BesideLiveFoldsCountsEachAcceptOnce(t *testing.T) {
	h := figHarness(t)
	svc := figService(h.DB(), nil)
	ctx := context.Background()

	backfilled := 0

	for round := range 10 {
		figReset(t, h.DB())

		fold(t, svc, accept(uint64(round*100+99), sellingA, figSupplier, jakartaDay(1),
			line{product: 900, ordered: 1, total: 1_000, accepted: 1}))

		events := make([]*eventsv1.Event, 8)
		want := map[string][2]supplier_service_models.SupplierMetricColumns{}

		for i := range events {
			day := jakartaDay(5 + i%2)
			la := line{product: figProductA, ordered: 10, total: 10_000, accepted: int64(i + 1), lost: 1}
			lb := line{product: figProductB, ordered: 5, total: 7_500, accepted: 2, broken: int64(i % 3)}

			events[i] = accept(uint64(round*100+i), sellingA, figSupplier, day, la, lb)

			w := want[day]
			w[0] = figAdd(w[0], la)
			w[1] = figAdd(w[1], lb)
			want[day] = w
		}

		var (
			mu       sync.Mutex
			results  []supplier_v1.BackfillResult
			gate     = make(chan struct{})
			gateOnce sync.Once
		)

		// The source is called once FoldBackfill has read its cutoff — that opens the gate. It hands the accepts over
		// 1 ms apart, as a source reading them in batches would, so the live deliveries catch up with it.
		source := func(each func(*eventsv1.Event) error) error {
			gateOnce.Do(func() { close(gate) })

			for _, e := range events {
				time.Sleep(time.Millisecond)

				err := each(e)
				if err != nil {
					return err
				}
			}

			return nil
		}

		res := h.Race(t, 8, func(i int) error {
			if i < 2 {
				r, err := svc.FoldBackfill(ctx, source)
				if errors.Is(err, supplier_v1.ErrAlreadyBackfilled) {
					return nil // the other backfill finished first
				}

				mu.Lock()
				results = append(results, r)
				mu.Unlock()

				return err
			}

			// A live delivery of every accept, each worker in its own order.
			select {
			case <-gate:
			case <-time.After(5 * time.Second):
				return errors.New("no backfill ever reached its source")
			}

			for k := range events {
				err := svc.FoldHandler()(ctx, events[(k+i)%len(events)])
				if err != nil {
					return err
				}
			}

			return nil
		})

		if round == 0 {
			res.Report(t)
		}

		t.Logf("round %d: backfill results %+v", round, results)

		if res.Failed() != 0 {
			res.Report(t)
			t.Fatalf("round %d: %d callers failed", round, res.Failed())
		}

		for _, r := range results {
			backfilled += r.Folded
		}

		for day, w := range want {
			gotA := figureRow(t, h.DB(), day, figSupplier, figProductA, sellingA)
			gotB := figureRow(t, h.DB(), day, figSupplier, figProductB, sellingA)

			if gotA != w[0] || gotB != w[1] {
				t.Fatalf("round %d, %s: product A %+v / B %+v, want %+v / %+v — an accept was counted twice or lost",
					round, day, gotA, gotB, w[0], w[1])
			}
		}

		if n := countRows(t, h.DB(), &supplier_service_models.SupplierEventLog{}); n != int64(len(events)+1) {
			t.Fatalf("round %d: %d dedup rows, want %d", round, n, len(events)+1)
		}
	}

	t.Logf("%d of %d accepts were folded by a backfill, the rest by a live delivery — each exactly once", backfilled, 10*8)

	if backfilled == 0 || backfilled == 10*8 {
		t.Fatalf("the backfill folded %d of %d — one side never won a claim, so the two never raced", backfilled, 10*8)
	}
}

// The proof, at the one place the backfill's own guard cannot help: a live fold has claimed an accept but not
// committed, so the backfill reads `figures_live_since` as EMPTY and goes on to fold the same accept. Its claim waits
// on the live one, sees the conflict, and skips — the claim, not the cutoff, is what keeps it to once.
func TestInterleave_FoldBackfill_WaitsOnALiveClaimThenSkips(t *testing.T) {
	h := figHarness(t)
	ctx := context.Background()
	day := jakartaDay(5)
	l := line{product: figProductA, ordered: 4, total: 8_000, accepted: 3, broken: 1}
	event := accept(50, sellingA, figSupplier, day, l)

	var (
		result supplier_v1.BackfillResult
		waits  []raceWait
	)

	const stepB = "B: the backfill reaches the same accept — its claim waits on A's"

	sched := h.Interleave(t,
		san_race.Do("A", "A: the live fold claims accept 50 (uncommitted)", func(tx *gorm.DB) error {
			return figService(tx, nil).FoldHandler()(ctx, event)
		}),
		san_race.Block("B", stepB, func(tx *gorm.DB) error {
			var err error
			result, err = figService(tx, nil).FoldBackfill(ctx, eventsOf(event))

			return err
		}),
		san_race.Do("W", "who waits on whom", func(*gorm.DB) error {
			var err error
			waits, err = raceWaiters(h.DB())

			return err
		}),
		san_race.Commit("A"),
		san_race.Commit("B"),
	)
	sched.Report(t)
	raceLogWaiters(t, waits)

	b := sched.Get(stepB)
	if !b.Blocked || !b.Released || b.Err != nil {
		t.Fatalf("B: blocked=%v released=%v err=%v — want blocked, released, ok", b.Blocked, b.Released, b.Err)
	}

	figRequireWaitOn(t, waits, "INSERT INTO supplier_event_logs")

	if result.Folded != 0 || result.Skipped != 1 {
		t.Fatalf("backfill = %+v, want 0 folded, 1 skipped", result)
	}

	if got := figureRow(t, h.DB(), day, figSupplier, figProductA, sellingA); got != figAdd(figZero, l) {
		t.Fatalf("got %+v, want the accept exactly once", got)
	}
}
