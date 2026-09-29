//go:build raceaudit

// Concurrency audit for SettlementPost's IMPORTED SHOP ROW path (the audit-sql skill).
//
// settlement-asks-the-shop-for-its-primary-cs: a row the importer posts to a SHOP asks the shop for its
// primary CS — a network call — and only then writes. Three things can go wrong when two of them land at
// once, and this file proves each absent:
//
//  1. PATTERN 6 — a lock held across the ask. If the shop's account row were taken FOR UPDATE before the
//     ask, every post on that shop would queue behind the shop service's latency. The spec forbids it;
//     TestInterleave_ImportedShopRow_TheAskHoldsNoLock parks one ask and shows a second post to the SAME
//     shop commit around it.
//  2. A LOST UPDATE on the shop account under an import's burst — the ask moves where the transaction
//     starts, so the account lock is re-proved here, and every row must carry the primary.
//  3. A DOUBLE WRITE of one imported key — every retry now asks first, then races the idempotency check.
//
// Build-tagged because san_race COMMITS. It empties ONLY settlement's own tables (settlementTables, from
// post_entry_race_test.go) — selling's tables are never touched: the ask is a stub here, and the real one
// is measured in post_entry_import_perf_test.go.
//
//	go test -tags raceaudit -run "TestRace_ImportedShopRow|TestInterleave_ImportedShopRow" -v ./backend/services/settlement_service/settlement_v1/
package settlement_v1_test

import (
	"context"
	"errors"
	"fmt"
	"sync/atomic"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	settlementv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	"github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_service_models"
	settlement_v1 "github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_v1"
)

const (
	// The shop every imported row below lands on, and a second one for the collision.
	imrShop      uint64 = 8_801
	imrOtherShop uint64 = 8_802

	// Two uploaders, so the stub can tell whose ask to park.
	imrActorA uint64 = 501
	imrActorB uint64 = 502
)

const imrImporter = settlementv1.SourceType_SOURCE_TYPE_IMPORTER

// raceShopPrimary answers the shop's primary CS for a race: safe for concurrent callers (the unit tests'
// stubPrimary counts with a plain int), optionally slow like a network hop, and able to PARK one asker on
// a gate — a shop service that has not answered yet.
type raceShopPrimary struct {
	user  uint64
	delay time.Duration
	asked atomic.Int64

	parkActor uint64        // whose ask parks…
	parked    chan struct{} // …closed once it is inside the ask…
	release   chan struct{} // …and held there until this is closed
}

func (p *raceShopPrimary) PrimaryUser(ctx context.Context, _, _, askingUserID uint64) (uint64, error) {
	p.asked.Add(1)

	if p.parkActor != 0 && askingUserID == p.parkActor {
		close(p.parked)

		select {
		case <-p.release:
		case <-ctx.Done():
			return 0, ctx.Err()
		}
	}

	if p.delay > 0 {
		time.Sleep(p.delay)
	}

	return p.user, nil
}

func imrRow(shopID uint64, key string, change int64, actor uint64, source settlementv1.SourceType) settlement_v1.PostInput {
	return settlement_v1.PostInput{
		TeamID:         team,
		ShopID:         shopID,
		UniqueID:       key,
		SettlementType: settlementv1.SettlementType_SETTLEMENT_TYPE_OTHER,
		SourceType:     source,
		Change:         change,
		OccurredOn:     "2026-09-28",
		ActorID:        actor,
	}
}

func imrShopBalance(t *testing.T, db *gorm.DB, shopID uint64) int64 {
	t.Helper()

	var balance int64

	err := db.Raw(`SELECT last_balance FROM shop_settlements WHERE shop_id = ?`, shopID).
		Scan(&balance).
		Error
	if err != nil {
		t.Fatalf("read shop %d's account: %v", shopID, err)
	}

	return balance
}

// imrShopRows is the shop's direct rows in the order they were WRITTEN — the id is drawn at insert, and
// the insert runs under the account lock, so id order is lock order.
func imrShopRows(t *testing.T, db *gorm.DB, shopID uint64) []settlement_service_models.SettlementLog {
	t.Helper()

	rows := []settlement_service_models.SettlementLog{}

	err := db.
		Where("shop_id = ? AND order_id IS NULL", shopID).
		Order("id ASC").
		Find(&rows).
		Error
	if err != nil {
		t.Fatalf("read shop %d's rows: %v", shopID, err)
	}

	return rows
}

// imrAssertChain checks the ledger's own definition row by row: each row's balance is the one before it
// plus its change. Two posts that read the same previous balance would leave two rows on one link — the
// signature of a lost update, visible even when the final number happens to be right.
func imrAssertChain(t *testing.T, rows []settlement_service_models.SettlementLog) int64 {
	t.Helper()

	var running int64

	for _, row := range rows {
		running += row.Change

		if row.Balance != running {
			t.Fatalf("row %d (%s) has balance %d, want %d — it was built on a stale previous balance",
				row.ID, row.UniqueID, row.Balance, running)
		}
	}

	return running
}

// ⚠ THE BUG THIS PROVES IS ABSENT — pattern 6, a lock held across a foreign call.
//
// A is an imported shop row whose ask PARKS: the shop service has not answered. While it waits, B posts
// to the SAME shop, and a third transaction takes the shop's account FOR UPDATE NOWAIT. Both must succeed
// at once — if A had opened its transaction and locked the account before asking, B would queue behind the
// shop service and the NOWAIT would fail with 55P03. Then A is answered, and must build on B's committed
// position: it reads the account AFTER the ask, under the lock, never a value from before it.
func TestInterleave_ImportedShopRow_TheAskHoldsNoLock(t *testing.T) {
	h := san_race.New(t, settlementTables...)
	db := h.DB()
	ctx := context.Background()

	primary := &raceShopPrimary{
		user:      shopPrimaryCS,
		parkActor: imrActorA,
		parked:    make(chan struct{}),
		release:   make(chan struct{}),
	}
	svc := settlement_v1.NewService(db, nil, nil, primary)

	// The account exists and holds a position before either post, so there is a real row to lock.
	_, err := svc.PostEntry(ctx, imrRow(imrShop, "imr-open", -1_000, uploader, imrImporter))
	if err != nil {
		t.Fatalf("open the shop account: %v", err)
	}

	const (
		stepA       = "A posts an imported shop row — its ask parks, the shop has not answered"
		stepInAsk   = "A is inside the ask"
		stepB       = "B posts an imported shop row to the SAME shop — must commit at once"
		stepProbe   = "the shop account FOR UPDATE NOWAIT — nobody may hold it"
		stepRelease = "the shop answers A"
	)

	var (
		resultA, resultB settlement_v1.PostResult
		errA, errB       error
	)

	sched := h.Interleave(t,
		san_race.Block("A", stepA, func(*gorm.DB) error {
			resultA, errA = svc.PostEntry(ctx, imrRow(imrShop, "imr-a", -2_000, imrActorA, imrImporter))

			return errA
		}),
		san_race.Do("C", stepInAsk, func(*gorm.DB) error {
			select {
			case <-primary.parked:
				return nil
			case <-time.After(5 * time.Second):
				return errors.New("A never reached the shop's ask")
			}
		}),
		san_race.Do("B", stepB, func(*gorm.DB) error {
			// A deadline, so a post queued behind A's lock FAILS with evidence instead of hanging.
			bctx, cancel := context.WithTimeout(ctx, 5*time.Second)
			defer cancel()

			resultB, errB = svc.PostEntry(bctx, imrRow(imrShop, "imr-b", -3_000, imrActorB, imrImporter))

			return errB
		}),
		san_race.Do("B", stepProbe, func(tx *gorm.DB) error {
			return tx.Exec(`SELECT 1 FROM shop_settlements WHERE shop_id = ? FOR UPDATE NOWAIT`, imrShop).Error
		}),
		san_race.Commit("B"),
		san_race.Do("C", stepRelease, func(*gorm.DB) error {
			close(primary.release)

			return nil
		}),
		san_race.Commit("C"),
	)

	sched.Report(t)

	if !sched.Get(stepA).Blocked {
		t.Fatalf("A returned before B ran (%v) — the schedule never held an ask open, so it proves nothing",
			sched.Get(stepA).Err)
	}

	for _, step := range []string{stepInAsk, stepB, stepProbe} {
		got := sched.Get(step)
		if got.Kind != san_race.None {
			t.Fatalf("%q ended %s: %v — a lock is held across the ask", step, got.Kind, got.Err)
		}
	}

	if errA != nil || errB != nil {
		t.Fatalf("A: %v, B: %v — both posts are legitimate", errA, errB)
	}

	if resultB.Entry.ID >= resultA.Entry.ID {
		t.Fatalf("B's row %d was written after A's %d — B waited for A's ask", resultB.Entry.ID, resultA.Entry.ID)
	}

	// A read the account after the ask, under its lock — so it builds on B's committed row.
	if resultA.Entry.Balance != resultB.Entry.Balance-2_000 {
		t.Fatalf("A's balance %d, want B's %d − 2 000 — A built on a position read before its ask",
			resultA.Entry.Balance, resultB.Entry.Balance)
	}

	for _, result := range []settlement_v1.PostResult{resultA, resultB} {
		if result.Entry.UserID != shopPrimaryCS {
			t.Fatalf("row %s counts for %d, want the primary CS %d", result.Entry.UniqueID, result.Entry.UserID, shopPrimaryCS)
		}
	}

	rows := imrShopRows(t, db, imrShop)
	running := imrAssertChain(t, rows)

	balance := imrShopBalance(t, db, imrShop)
	if balance != -6_000 || running != balance {
		t.Fatalf("last_balance %d, log sums to %d — want −6 000 both", balance, running)
	}
}

// ⚠ THE PROOF OF SAFETY for the account lock the ask now sits in front of: a poster that HOLDS the shop's
// account makes the next imported row wait — after its ask, at the lock — and the waiter re-reads the
// balance once it gets the lock, so the held poster's movement is not lost.
func TestInterleave_ImportedShopRow_APosterHoldingTheAccountBlocksTheNext(t *testing.T) {
	h := san_race.New(t, settlementTables...)
	db := h.DB()
	ctx := context.Background()

	primary := &raceShopPrimary{user: shopPrimaryCS}
	svc := settlement_v1.NewService(db, nil, nil, primary)

	_, err := svc.PostEntry(ctx, imrRow(imrShop, "imr-held-open", -1_000, uploader, imrImporter))
	if err != nil {
		t.Fatalf("open the shop account: %v", err)
	}

	const (
		stepLock  = "A takes the shop account FOR UPDATE, as a poster mid-transaction does"
		stepB     = "B posts an imported shop row — asks, then waits at the account lock"
		stepWrite = "A writes its row and moves the account by −2 000"
	)

	var (
		resultB settlement_v1.PostResult
		errB    error
	)

	sched := h.Interleave(t,
		san_race.Do("A", stepLock, func(tx *gorm.DB) error {
			return tx.Exec(`SELECT last_balance FROM shop_settlements WHERE shop_id = ? FOR UPDATE`, imrShop).Error
		}),
		san_race.Block("B", stepB, func(*gorm.DB) error {
			resultB, errB = svc.PostEntry(ctx, imrRow(imrShop, "imr-held-b", -3_000, imrActorB, imrImporter))

			return errB
		}),
		san_race.Do("A", stepWrite, func(tx *gorm.DB) error {
			err := tx.Exec(`
INSERT INTO settlement_logs (shop_id, team_id, actor_id, user_id, source_type, settlement_type, change, balance, unique_id, occurred_on)
VALUES (?, ?, ?, ?, 'importer', 'other', -2000, -3000, 'imr-held-a', '2026-09-28')`,
				imrShop, team, imrActorA, shopPrimaryCS).Error
			if err != nil {
				return err
			}

			return tx.Exec(`UPDATE shop_settlements SET last_balance = last_balance - 2000 WHERE shop_id = ?`, imrShop).Error
		}),
		san_race.Commit("A"),
		san_race.Commit("B"),
	)

	sched.Report(t)

	got := sched.Get(stepB)
	if !got.Blocked || !got.Released {
		t.Fatalf("B did not wait on A's account lock (blocked=%v released=%v) — the lock the balance depends on is not held",
			got.Blocked, got.Released)
	}

	if errB != nil {
		t.Fatalf("B: %v", errB)
	}

	// −1 000 opening, −2 000 by A, −3 000 by B. B built on −1 000 would read −4 000: the lost update.
	if resultB.Entry.Balance != -6_000 {
		t.Fatalf("B's balance %d, want −6 000 — B used a balance read before it held the lock", resultB.Entry.Balance)
	}

	running := imrAssertChain(t, imrShopRows(t, db, imrShop))

	balance := imrShopBalance(t, db, imrShop)
	if balance != -6_000 || running != balance {
		t.Fatalf("last_balance %d, log sums to %d — want −6 000 both", balance, running)
	}
}

// ⚠ THE BUG THIS PROVES IS ABSENT: an import's BURST on one shop loses nothing, and every row counts for
// the primary CS. Each ask sleeps, like a network hop, so the posters reach the account together.
func TestRace_ImportedShopRow_ABurstLosesNothingAndCountsForThePrimary(t *testing.T) {
	h := san_race.New(t, settlementTables...)
	db := h.DB()
	ctx := context.Background()

	primary := &raceShopPrimary{user: shopPrimaryCS, delay: 5 * time.Millisecond}
	svc := settlement_v1.NewService(db, nil, nil, primary)

	const posters = 16

	res := h.Race(t, posters, func(i int) error {
		_, err := svc.PostEntry(ctx, imrRow(imrShop, fmt.Sprintf("imr-burst-%d", i), -int64(1_000*(i+1)), uploader, imrImporter))

		return err
	})

	res.Report(t)

	if res.Failed() != 0 {
		t.Fatalf("%d of %d distinct imported rows failed — every one was a legitimate entry", res.Failed(), posters)
	}

	// Distinct amounts, so a lost row shows in the sum: −(1 + 2 + … + 16) × 1 000.
	const want int64 = -136_000

	rows := imrShopRows(t, db, imrShop)
	if len(rows) != posters {
		t.Fatalf("%d rows, want %d", len(rows), posters)
	}

	running := imrAssertChain(t, rows)

	balance := imrShopBalance(t, db, imrShop)
	if balance != want || running != want {
		t.Fatalf("last_balance %d, log sums to %d, want %d — lost to a read-modify-write race", balance, running, want)
	}

	for _, row := range rows {
		if row.UserID != shopPrimaryCS || row.ActorID != uploader {
			t.Fatalf("row %s: user_id %d, actor_id %d — want the primary %d and the uploader %d",
				row.UniqueID, row.UserID, row.ActorID, shopPrimaryCS, uploader)
		}
	}

	// Logged, not asserted: how often the shop is asked is a cost, and a fix may lower it.
	t.Logf("the shop was asked %d times for %d rows of one shop", primary.asked.Load(), posters)
}

// The realistic collision: an import's burst while a person posts by hand on the same shop. The hand-posted
// rows skip the ask and reach the lock first; the balance must still be the sum, and only the imported
// rows carry the primary.
func TestRace_ImportedShopRow_ImportedAndManualShareOneAccount(t *testing.T) {
	h := san_race.New(t, settlementTables...)
	db := h.DB()
	ctx := context.Background()

	primary := &raceShopPrimary{user: shopPrimaryCS, delay: 5 * time.Millisecond}
	svc := settlement_v1.NewService(db, nil, nil, primary)

	const posters = 16

	res := h.Race(t, posters, func(i int) error {
		source := imrImporter
		if i%2 == 1 {
			source = settlementv1.SourceType_SOURCE_TYPE_MANUAL
		}

		_, err := svc.PostEntry(ctx, imrRow(imrShop, fmt.Sprintf("imr-mixed-%d", i), -int64(1_000*(i+1)), uploader, source))

		return err
	})

	res.Report(t)

	if res.Failed() != 0 {
		t.Fatalf("%d of %d posts failed", res.Failed(), posters)
	}

	rows := imrShopRows(t, db, imrShop)
	running := imrAssertChain(t, rows)

	balance := imrShopBalance(t, db, imrShop)
	if len(rows) != posters || balance != -136_000 || running != balance {
		t.Fatalf("%d rows, last_balance %d, log sum %d — want %d rows and −136 000 both", len(rows), balance, running, posters)
	}

	for _, row := range rows {
		want := uint64(0)
		if row.SourceType == "importer" {
			want = shopPrimaryCS
		}

		if row.UserID != want {
			t.Fatalf("row %s (%s) counts for %d, want %d", row.UniqueID, row.SourceType, row.UserID, want)
		}
	}

	t.Logf("the shop was asked %d times for %d imported and %d hand-posted rows",
		primary.asked.Load(), posters/2, posters/2)
}

// ⚠ THE BUG THIS PROVES IS ABSENT: N retries of ONE imported row, at once, write it once. Every retry now
// ASKS FIRST (the ask precedes the idempotency check), so all of them reach the account together.
func TestRace_ImportedShopRow_SameKeyWritesOnce(t *testing.T) {
	h := san_race.New(t, settlementTables...)
	db := h.DB()
	ctx := context.Background()

	primary := &raceShopPrimary{user: shopPrimaryCS, delay: 5 * time.Millisecond}
	svc := settlement_v1.NewService(db, nil, nil, primary)

	const retries = 16

	created := make([]bool, retries)

	res := h.Race(t, retries, func(i int) error {
		result, err := svc.PostEntry(ctx, imrRow(imrShop, "imr-retry", -7_000, uploader, imrImporter))
		created[i] = result.Created

		return err
	})

	res.Report(t)

	if res.Failed() != 0 {
		t.Fatalf("%d of %d retries failed — a retry must succeed idempotently", res.Failed(), retries)
	}

	wrote := 0

	for _, c := range created {
		if c {
			wrote++
		}
	}

	var rows int64

	err := db.Raw(`SELECT COUNT(*) FROM settlement_logs WHERE unique_id = ?`, "imr-retry").Scan(&rows).Error
	if err != nil {
		t.Fatalf("count: %v", err)
	}

	balance := imrShopBalance(t, db, imrShop)

	if rows != 1 || wrote != 1 || balance != -7_000 {
		t.Fatalf("%d rows, %d callers told created, last_balance %d after %d retries — want 1, 1 and −7 000",
			rows, wrote, balance, retries)
	}

	// Logged, not asserted: the ask precedes the idempotency check today, so every retry asks — a cost
	// the performance audit prices, and one a fix may remove.
	t.Logf("the shop was asked %d times for %d retries of one row", primary.asked.Load(), retries)
}

// ⚠ WHAT A KEY COLLIDING ACROSS SHOPS ANSWERS, one at a time and at once.
//
// One at a time, a key already held by another shop's row is refused as InvalidArgument
// (#a-key-held-by-another-account-is-refused) — the existence check finds it. At once, the existence check
// cannot see the other transaction's uncommitted row: the insert waits on the unique index, then fails
// with 23505 — which dbError maps to Internal. The data is right either way (one row); the answer is not.
func TestInterleave_ImportedShopRow_AKeyCollidingAcrossShopsAnswersInternal(t *testing.T) {
	h := san_race.New(t, settlementTables...)
	db := h.DB()
	ctx := context.Background()

	svc := settlement_v1.NewService(db, nil, nil, &raceShopPrimary{user: shopPrimaryCS})

	// One at a time: the contract's answer.
	_, err := svc.PostEntry(ctx, imrRow(imrShop, "imr-collide-seq", -1_000, uploader, imrImporter))
	if err != nil {
		t.Fatalf("first shop: %v", err)
	}

	_, err = svc.PostEntry(ctx, imrRow(imrOtherShop, "imr-collide-seq", -1_000, uploader, imrImporter))
	sequential := connect.CodeOf(err)

	const (
		stepA = "A writes key K on shop 1 — not yet committed"
		stepB = "B posts key K on shop 2 — its existence check cannot see A's row, its insert waits on A's key"
	)

	var errB error

	sched := h.Interleave(t,
		san_race.Do("A", stepA, func(tx *gorm.DB) error {
			return tx.Exec(`
INSERT INTO settlement_logs (shop_id, team_id, actor_id, user_id, source_type, settlement_type, change, balance, unique_id, occurred_on)
VALUES (?, ?, ?, ?, 'importer', 'other', -1000, -2000, 'imr-collide', '2026-09-28')`,
				imrShop, team, uploader, shopPrimaryCS).Error
		}),
		san_race.Block("B", stepB, func(*gorm.DB) error {
			_, errB = svc.PostEntry(ctx, imrRow(imrOtherShop, "imr-collide", -1_000, uploader, imrImporter))

			return errB
		}),
		san_race.Commit("A"),
		san_race.Commit("B"),
	)

	sched.Report(t)

	got := sched.Get(stepB)
	if !got.Blocked || !got.Released {
		t.Fatalf("B did not wait on A's key (blocked=%v released=%v)", got.Blocked, got.Released)
	}

	var rows int64

	err = db.Raw(`SELECT COUNT(*) FROM settlement_logs WHERE unique_id = ?`, "imr-collide").Scan(&rows).Error
	if err != nil {
		t.Fatalf("count: %v", err)
	}

	if rows != 1 {
		t.Fatalf("%d rows hold one key — the unique index did not hold", rows)
	}

	t.Logf("a key held by another shop's row: one at a time → %v · at once → %v (%v)",
		sequential, connect.CodeOf(errB), errB)

	if sequential != connect.CodeInvalidArgument {
		t.Fatalf("one at a time answered %v, want InvalidArgument", sequential)
	}

	// THE CONTRACT: one collision, one answer. Errorf, so the real-poster rounds below still run.
	if connect.CodeOf(errB) != sequential {
		t.Errorf("the same collision answers %v one at a time but %v at once — a unique violation surfacing as %v",
			sequential, connect.CodeOf(errB), connect.CodeOf(errB))
	}

	// The same collision with two REAL posters, released together — how often the window is met.
	codes := map[connect.Code]int{}

	for round := 0; round < 20; round++ {
		key := fmt.Sprintf("imr-collide-race-%d", round)

		res := h.Race(t, 2, func(i int) error {
			shopID := imrShop
			if i == 1 {
				shopID = imrOtherShop
			}

			_, err := svc.PostEntry(ctx, imrRow(shopID, key, -1_000, uploader, imrImporter))

			return err
		})

		for _, outcome := range res.Outcomes {
			if outcome.Err != nil {
				codes[connect.CodeOf(outcome.Err)]++
			}
		}
	}

	t.Logf("20 rounds of two real posters racing one key on two shops — the loser's answer: %v", codes)

	if codes[connect.CodeInternal] > 0 {
		t.Errorf("%d of 20 real collisions answered Internal, not InvalidArgument", codes[connect.CodeInternal])
	}
}

// ⚠ THE LOCK-ORDER PROOF for the fold, with the new attribution: an imported shop row now folds under its
// PRIMARY CS (posted.user_id), so one person's user key is shared by shop rows of every shop they are
// primary of, and by order rows they created. Two shops × two people, crossed — every shop key and every
// user key is taken by two events at once. The fold takes shop THEN user, always; a single path taking
// them the other way round would deadlock here.
func TestRace_ImportedShopRow_FoldsCrossingShopsAndPrimariesNeverDeadlock(t *testing.T) {
	h := san_race.New(t, foldTables...)
	db := h.DB()
	ctx := context.Background()

	svc := settlement_v1.NewService(db, nil, nil, nil)

	const (
		primaryOne uint64 = 70
		primaryTwo uint64 = 71
	)

	// shop, order (0 = a shop row), the person it counts for, change.
	type crossing struct {
		shop, order, user uint64
		change            int64
	}

	pattern := []crossing{
		{imrShop, 0, primaryOne, -1_000},         // an imported shop row of shop 1 → its primary
		{imrOtherShop, 0, primaryTwo, -2_000},    // an imported shop row of shop 2 → its primary
		{imrShop, 9_101, primaryTwo, 3_000},      // an order row of shop 1, created by shop 2's primary
		{imrOtherShop, 9_102, primaryOne, 4_000}, // an order row of shop 2, created by shop 1's primary
	}

	events := make([]*eventsv1.Event, 0, 2*len(pattern))

	for round := 0; round < 2; round++ {
		for i, c := range pattern {
			logID := uint64(9_500 + round*len(pattern) + i)
			day := fmt.Sprintf("2026-09-%02d", 10+round)

			var event *eventsv1.Event
			if c.order == 0 {
				event = logPosted(logID, day, c.shop, 0, 0, uploader, settlementv1.SettlementType_SETTLEMENT_TYPE_WITHDRAWAL, c.change)
				event.GetSettlementLogPosted().UserId = c.user
			} else {
				event = logPosted(logID, day, c.shop, c.order, c.user, uploader, settlementv1.SettlementType_SETTLEMENT_TYPE_FUND, c.change)
			}

			events = append(events, event)
		}
	}

	res := h.Race(t, len(events), func(i int) error {
		return svc.FoldHandler()(ctx, events[i])
	})

	res.Report(t)

	if res.Count(san_race.Deadlock) != 0 || res.Failed() != 0 {
		t.Fatalf("%d deadlocks, %d failures across %d crossing folds — the shop-then-user order is broken",
			res.Count(san_race.Deadlock), res.Failed(), len(events))
	}

	sum := func(table, key string, id uint64) int64 {
		var total int64

		err := db.Raw(`SELECT COALESCE(SUM(change), 0) FROM `+table+` WHERE `+key+` = ? AND team_id = ?`, id, team).
			Scan(&total).
			Error
		if err != nil {
			t.Fatalf("sum %s: %v", table, err)
		}

		return total
	}

	for _, want := range []struct {
		table, key string
		id         uint64
		total      int64
	}{
		{"shop_settlement_daily_reports", "shop_id", imrShop, 2 * (-1_000 + 3_000)},
		{"shop_settlement_daily_reports", "shop_id", imrOtherShop, 2 * (-2_000 + 4_000)},
		{"user_settlement_daily_reports", "user_id", primaryOne, 2 * (-1_000 + 4_000)},
		{"user_settlement_daily_reports", "user_id", primaryTwo, 2 * (-2_000 + 3_000)},
	} {
		got := sum(want.table, want.key, want.id)
		if got != want.total {
			t.Fatalf("%s %s=%d moved %d, want %d", want.table, want.key, want.id, got, want.total)
		}
	}
}
