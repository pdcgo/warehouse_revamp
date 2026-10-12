package supplier_v1_test

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"

	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_service_models"
	supplier_v1 "github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_v1"
)

// fakeBroker stands in for the fold's subscription: a retention, and a record of the seek.
type fakeBroker struct {
	window time.Duration
	err    error
	seeked []time.Time
}

func (b *fakeBroker) ReplayWindow(context.Context) (time.Duration, error) {
	return b.window, b.err
}

func (b *fakeBroker) Seek(_ context.Context, to time.Time) error {
	b.seeked = append(b.seeked, to)

	return nil
}

func jakartaDay(daysAgo int) string {
	return time.Now().In(time.FixedZone("WIB", 7*60*60)).AddDate(0, 0, -daysAgo).Format("2006-01-02")
}

// A replay deletes the figures and the dedup rows from its day on — one predicate, one transaction — seeks the
// subscription to that Jakarta midnight, says "started", and lets the fold run again.
func TestAnalyticReplayCompute_DeletesFromTheDaySeeksAndUnlocks(t *testing.T) {
	db := san_testdb.DB(t)
	broker := &fakeBroker{window: 31 * 24 * time.Hour}
	svc := supplier_v1.NewService(db, nil, broker)

	fold(t, svc, accept(1, sellingA, 31, jakartaDay(10), line{product: 100, ordered: 1, total: 1000, accepted: 1}))
	fold(t, svc, accept(2, sellingA, 31, jakartaDay(5), line{product: 100, ordered: 1, total: 1000, accepted: 1}))
	fold(t, svc, accept(3, sellingA, 31, jakartaDay(2), line{product: 100, ordered: 1, total: 1000, accepted: 1}))

	resp, err := svc.AnalyticReplayCompute(context.Background(), connect.NewRequest(&supplierv1.AnalyticReplayComputeRequest{
		StartDate: jakartaDay(5),
	}))
	if err != nil {
		t.Fatalf("replay: %v", err)
	}

	if resp.Msg.GetStatus() != "started" || resp.Msg.GetDeletedReportRows() != 2 || resp.Msg.GetDeletedEventLogs() != 2 {
		t.Fatalf("replay = %+v, want started, 2 rows and 2 dedup rows", resp.Msg)
	}

	if n := countRows(t, db, &supplier_service_models.SupplierProductDailyReport{}); n != 1 {
		t.Fatalf("%d figure rows left, want the one before the start", n)
	}

	if len(broker.seeked) != 1 || broker.seeked[0].Format("2006-01-02") != jakartaDay(5) {
		t.Fatalf("seeked %v, want once, to %s", broker.seeked, jakartaDay(5))
	}

	if lock := metadata(t, db, supplier_service_models.MetadataProcessEventLock); lock != `{"lock":false}` {
		t.Fatalf("the lock is %s after the replay — the fold is stopped", lock)
	}

	// The redelivered accept folds again.
	fold(t, svc, accept(2, sellingA, 31, jakartaDay(5), line{product: 100, ordered: 1, total: 1000, accepted: 1}))

	if got := figureRow(t, db, jakartaDay(5), 31, 100, sellingA); got.RestockCount != 1 {
		t.Fatalf("the redelivered accept was not folded: %+v", got)
	}
}

// Figures folded by the backfill were never on the broker, so a replay must not delete them
// (past-accepts-are-backfilled-once): it starts AFTER the live fold's first day, or it is refused.
func TestAnalyticReplayCompute_RefusesTheBackfilledPast(t *testing.T) {
	db := san_testdb.DB(t)
	svc := supplier_v1.NewService(db, nil, &fakeBroker{window: 31 * 24 * time.Hour})

	replay := func(day string) error {
		_, err := svc.AnalyticReplayCompute(context.Background(), connect.NewRequest(&supplierv1.AnalyticReplayComputeRequest{
			StartDate: day,
		}))

		return err
	}

	// No live accept folded yet — everything there is came from the backfill.
	if code := connect.CodeOf(replay(jakartaDay(3))); code != connect.CodeFailedPrecondition {
		t.Fatalf("replay with no live fold = %v, want FailedPrecondition", code)
	}

	fold(t, svc, accept(1, sellingA, 31, jakartaDay(10), line{product: 100, ordered: 1, total: 1000, accepted: 1}))

	// The live fold's first day may still hold a backfilled accept from earlier that day.
	if code := connect.CodeOf(replay(jakartaDay(10))); code != connect.CodeFailedPrecondition {
		t.Fatalf("replay ON the live fold's first day = %v, want FailedPrecondition", code)
	}

	if err := replay(jakartaDay(9)); err != nil {
		t.Fatalf("replay the day after: %v", err)
	}
}

// Outside the subscription's retention, with no broker, and while another replay holds the lock: refused, and nothing
// is deleted.
func TestAnalyticReplayCompute_RefusesWhatItCannotRebuild(t *testing.T) {
	db := san_testdb.DB(t)
	broker := &fakeBroker{window: 7 * 24 * time.Hour}
	svc := supplier_v1.NewService(db, nil, broker)

	fold(t, svc, accept(1, sellingA, 31, jakartaDay(20), line{product: 100, ordered: 1, total: 1000, accepted: 1}))

	replay := func(svc *supplier_v1.Service, day string) error {
		_, err := svc.AnalyticReplayCompute(context.Background(), connect.NewRequest(&supplierv1.AnalyticReplayComputeRequest{
			StartDate: day,
		}))

		return err
	}

	if code := connect.CodeOf(replay(svc, jakartaDay(14))); code != connect.CodeFailedPrecondition {
		t.Fatalf("outside the retention = %v, want FailedPrecondition", code)
	}

	if code := connect.CodeOf(replay(supplier_v1.NewService(db, nil, nil), jakartaDay(3))); code != connect.CodeFailedPrecondition {
		t.Fatalf("no broker = %v, want FailedPrecondition", code)
	}

	broker.err = nil
	setEventLock(t, db, `{"lock":true}`)

	if code := connect.CodeOf(replay(svc, jakartaDay(3))); code != connect.CodeFailedPrecondition {
		t.Fatalf("lock held = %v, want FailedPrecondition", code)
	}

	if n := countRows(t, db, &supplier_service_models.SupplierProductDailyReport{}); n != 1 {
		t.Fatalf("a refused replay deleted rows: %d left", n)
	}

}
