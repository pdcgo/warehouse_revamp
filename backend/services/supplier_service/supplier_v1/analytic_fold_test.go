package supplier_v1_test

import (
	"context"
	"errors"
	"testing"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_service_models"
	supplier_v1 "github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_v1"
)

// An accept adds its six figures (each-figure-is-read-at-the-accept): good units, short, broken — each valued at the
// line's price, total × units ÷ ordered, so a line adds back to what the supplier charged.
func TestFold_AnAcceptAddsItsSixFigures(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	// 10 ordered for Rp 30.000: 7 good, 1 short, 2 broken. 3 ordered for Rp 100: a price that does not divide.
	fold(t, svc, accept(1, sellingA, 31, "2026-10-03",
		line{product: 100, ordered: 10, total: 30000, accepted: 7, lost: 1, broken: 2},
		line{product: 200, ordered: 3, total: 100, accepted: 3},
	))

	got := figureRow(t, db, "2026-10-03", 31, 100, sellingA)
	if want := columns(7, 21000, 1, 3000, 2, 6000); got != want {
		t.Fatalf("product 100 = %+v, want %+v", got, want)
	}

	// 3 of 3 for Rp 100 is Rp 100 — never 3 × a rounded 33.
	got = figureRow(t, db, "2026-10-03", 31, 200, sellingA)
	if want := columns(3, 100, 0, 0, 0, 0); got != want {
		t.Fatalf("product 200 = %+v, want %+v", got, want)
	}
}

// Two accepts of one product on one day are ONE row, summed — the decided key (the-report-is-keyed-by-team-not-by-store).
// Another team buying the same item is its own row.
func TestFold_OneDayOneProductOneTeamIsOneRow(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	fold(t, svc, accept(1, sellingA, 31, "2026-10-03", line{product: 100, ordered: 5, total: 5000, accepted: 5}))
	fold(t, svc, accept(2, sellingA, 31, "2026-10-03", line{product: 100, ordered: 4, total: 4000, accepted: 3, broken: 1}))
	fold(t, svc, accept(3, sellingB, 31, "2026-10-03", line{product: 900, ordered: 2, total: 2000, accepted: 2}))

	if got, want := figureRow(t, db, "2026-10-03", 31, 100, sellingA), columns(8, 8000, 0, 0, 1, 1000); got != want {
		t.Fatalf("team A's row = %+v, want %+v", got, want)
	}

	if got, want := figureRow(t, db, "2026-10-03", 31, 900, sellingB), columns(2, 2000, 0, 0, 0, 0); got != want {
		t.Fatalf("team B's row = %+v, want %+v", got, want)
	}

	if n := countRows(t, db, &supplier_service_models.SupplierProductDailyReport{}); n != 2 {
		t.Fatalf("%d rows, want 2", n)
	}
}

// The same event twice folds ONCE — a redelivery, a republish and a replay all collide on the event's id.
func TestFold_TheSameAcceptTwiceFoldsOnce(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	event := accept(1, sellingA, 31, "2026-10-03", line{product: 100, ordered: 5, total: 5000, accepted: 5})
	fold(t, svc, event)
	fold(t, svc, event)

	if got, want := figureRow(t, db, "2026-10-03", 31, 100, sellingA), columns(5, 5000, 0, 0, 0, 0); got != want {
		t.Fatalf("row = %+v, want %+v — the redelivery was folded again", got, want)
	}
}

// A restock that names no supplier has no figures (the-supplier-comes-from-the-restock-until-lines-name-a-store) — and
// it is ACKED, never redelivered, because it will never be anything else. Another variant is acked too.
func TestFold_NoSupplierAndOtherEventsFoldNothing(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	fold(t, svc, accept(1, sellingA, 0, "2026-10-03", line{product: 100, ordered: 5, total: 5000, accepted: 5}))
	fold(t, svc, &eventsv1.Event{EventId: "x", Message: &eventsv1.Event_MemberRemoved{MemberRemoved: &eventsv1.MemberRemoved{}}})

	if n := countRows(t, db, &supplier_service_models.SupplierProductDailyReport{}); n != 0 {
		t.Fatalf("%d figure rows, want none", n)
	}

	if n := countRows(t, db, &supplier_service_models.SupplierEventLog{}); n != 0 {
		t.Fatalf("%d dedup rows, want none — nothing was folded", n)
	}
}

// While a replay holds the lock the webhook refuses — an error, so Pub/Sub redelivers — and writes nothing, not even
// its claim.
func TestFold_RefusedWhileTheLockIsHeld(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	setEventLock(t, db, `{"lock":true}`)

	err := svc.FoldHandler()(context.Background(),
		accept(1, sellingA, 31, "2026-10-03", line{product: 100, ordered: 5, total: 5000, accepted: 5}))
	if err == nil {
		t.Fatal("the fold ran while the lock was held")
	}

	if n := countRows(t, db, &supplier_service_models.SupplierEventLog{}); n != 0 {
		t.Fatalf("%d dedup rows — a refused event must not be claimed, or its redelivery is skipped", n)
	}
}

// A lock value that does not parse is an ERROR, never "unlocked" — for a lock, failing open is the wrong direction.
func TestFold_AnUnreadableLockIsAnError(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	setEventLock(t, db, `locked`)

	err := svc.FoldHandler()(context.Background(),
		accept(1, sellingA, 31, "2026-10-03", line{product: 100, ordered: 5, total: 5000, accepted: 5}))
	if err == nil {
		t.Fatal("an unreadable lock was read as unlocked")
	}
}

// The live fold records where it began — the EARLIEST accept it folded, lowered and never raised — and the backfill
// folds only what came before it (past-accepts-are-backfilled-once).
func TestFoldBackfill_FoldsOnlyWhatCameBeforeTheLiveFold(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	fold(t, svc, accept(5, sellingA, 31, "2026-10-05", line{product: 100, ordered: 1, total: 1000, accepted: 1}))
	fold(t, svc, accept(4, sellingA, 31, "2026-10-04", line{product: 100, ordered: 1, total: 1000, accepted: 1}))
	fold(t, svc, accept(6, sellingA, 31, "2026-10-06", line{product: 100, ordered: 1, total: 1000, accepted: 1}))

	if got := metadata(t, db, supplier_service_models.MetadataFiguresLiveSince); got[:10] != "2026-10-04" {
		t.Fatalf("figures_live_since = %q, want the 4th — the earliest accept folded live", got)
	}

	result, err := svc.FoldBackfill(context.Background(), eventsOf(
		accept(1, sellingA, 31, "2026-09-01", line{product: 100, ordered: 2, total: 2000, accepted: 2}),
		accept(4, sellingA, 31, "2026-10-04", line{product: 100, ordered: 1, total: 1000, accepted: 1}),
		accept(6, sellingA, 31, "2026-10-06", line{product: 100, ordered: 1, total: 1000, accepted: 1}),
	))
	if err != nil {
		t.Fatalf("backfill: %v", err)
	}

	if result.Folded != 1 || result.Skipped != 2 {
		t.Fatalf("backfill folded %d, skipped %d — want 1 and 2", result.Folded, result.Skipped)
	}

	if got, want := figureRow(t, db, "2026-09-01", 31, 100, sellingA), columns(2, 2000, 0, 0, 0, 0); got != want {
		t.Fatalf("the backfilled day = %+v, want %+v", got, want)
	}

	if got, want := figureRow(t, db, "2026-10-04", 31, 100, sellingA), columns(1, 1000, 0, 0, 0, 0); got != want {
		t.Fatalf("a live day = %+v, want %+v — the backfill folded it twice", got, want)
	}
}

// Run twice, the backfill folds nothing and says so; and it never moves the live fold's start.
func TestFoldBackfill_ASecondRunFoldsNothing(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	events := eventsOf(accept(1, sellingA, 31, "2026-09-01", line{product: 100, ordered: 2, total: 2000, accepted: 2}))

	_, err := svc.FoldBackfill(context.Background(), events)
	if err != nil {
		t.Fatalf("first backfill: %v", err)
	}

	if got := metadata(t, db, supplier_service_models.MetadataFiguresLiveSince); got != "" {
		t.Fatalf("the backfill set figures_live_since = %q — only the live fold may", got)
	}

	_, err = svc.FoldBackfill(context.Background(), events)
	if !errors.Is(err, supplier_v1.ErrAlreadyBackfilled) {
		t.Fatalf("second backfill err = %v, want ErrAlreadyBackfilled", err)
	}

	if got, want := figureRow(t, db, "2026-09-01", 31, 100, sellingA), columns(2, 2000, 0, 0, 0, 0); got != want {
		t.Fatalf("row = %+v, want %+v", got, want)
	}
}

// One accept naming a product on TWO lines adds both — the single upsert groups by product first, because one INSERT
// may not touch a row twice. Each line is still valued at its own price.
func TestFold_OneProductOnTwoLinesAddsBoth(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	fold(t, svc, accept(1, sellingA, 31, "2026-10-03",
		line{product: 100, ordered: 4, total: 4000, accepted: 3, broken: 1},
		line{product: 100, ordered: 2, total: 3000, accepted: 2},
	))

	if got, want := figureRow(t, db, "2026-10-03", 31, 100, sellingA), columns(5, 6000, 0, 0, 1, 1000); got != want {
		t.Fatalf("row = %+v, want %+v — 3 at Rp 1.000 and 2 at Rp 1.500, one broken at Rp 1.000", got, want)
	}
}
