package supplier_v1_test

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	analytic_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/analytic_base/v1"
	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
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
	svc := supplier_v1.NewService(db, nil, broker, nil, nil, nil)

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
	svc := supplier_v1.NewService(db, nil, &fakeBroker{window: 31 * 24 * time.Hour}, nil, nil, nil)

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
	svc := supplier_v1.NewService(db, nil, broker, nil, nil, nil)

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

	if code := connect.CodeOf(replay(supplier_v1.NewService(db, nil, nil, nil, nil, nil), jakartaDay(3))); code != connect.CodeFailedPrecondition {
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

// The NEXT replay takes a dead replay's lock over, rather than being refused by a lock nobody will release — and then
// releases it (a-dead-replays-lock-expires-after-a-minute).
func TestAnalyticReplayCompute_TakesOverADeadReplaysLock(t *testing.T) {
	db := san_testdb.DB(t)
	broker := &fakeBroker{window: 31 * 24 * time.Hour}
	svc := supplier_v1.NewService(db, nil, broker, nil, nil, nil)

	// A replay rebuilds only what live accepts folded, and starts after the first of them — so one was folded earlier.
	fold(t, svc, accept(1, sellingA, 31, jakartaDay(10), line{product: 100, ordered: 1, total: 1000, accepted: 1}))

	leaveDeadLock(t, db)

	_, err := svc.AnalyticReplayCompute(context.Background(), connect.NewRequest(&supplierv1.AnalyticReplayComputeRequest{
		StartDate: jakartaDay(5),
	}))
	if err != nil || len(broker.seeked) != 1 {
		t.Fatalf("replay over an expired lock: %v with %d seeks, want it to run", err, len(broker.seeked))
	}

	if lock := metadata(t, db, supplier_service_models.MetadataProcessEventLock); lock != `{"lock":false}` {
		t.Fatalf("the lock is %s after the replay — it must release what it took", lock)
	}
}

// ── PENJUALAN — the replay clears it from its day, and the seek rebuilds it ──────────────────────────────────

// saleOrder reads one order's claim; found false when the replay deleted it.
func saleOrder(t *testing.T, db *gorm.DB, orderID uint64) (supplier_service_models.SupplierSaleOrder, bool) {
	t.Helper()

	var rows []supplier_service_models.SupplierSaleOrder

	err := db.Where("order_id = ?", orderID).Find(&rows).Error
	if err != nil {
		t.Fatalf("read order %d's claim: %v", orderID, err)
	}

	if len(rows) == 0 {
		return supplier_service_models.SupplierSaleOrder{}, false
	}

	return rows[0], true
}

func salePartCount(t *testing.T, db *gorm.DB, orderID uint64) int64 {
	t.Helper()

	var n int64

	err := db.Model(&supplier_service_models.SupplierSaleOrderPart{}).Where("order_id = ?", orderID).Count(&n).Error
	if err != nil {
		t.Fatalf("count order %d's parts: %v", orderID, err)
	}

	return n
}

// penjualanByDay is the Statistik tab's daily read of one supplier over the replay's month.
func penjualanByDay(t *testing.T, svc *supplier_v1.Service, supplier uint64, days ...string) map[string]saleFigure {
	t.Helper()

	data := fill(t, svc, &supplierv1.MetricDataRequest{
		GroupBy: analytic_basev1.GroupType_GROUP_TYPE_DAILY,
		Filters: filters(dateRange(jakartaDay(30), jakartaDay(0)), oneSupplier(supplier)),
		Keys:    dayKeys(days...),
	})

	out := map[string]saleFigure{}
	for day, m := range data.GetSupplierByDay().GetItems() {
		out[day] = saleFigure{count: m.GetSalesCount(), value: m.GetSalesValue()}
	}

	return out
}

func replayService(db *gorm.DB, broker supplier_v1.ReplayBroker, goods *fakeGoods) *supplier_v1.Service {
	return supplier_v1.NewService(db, sellingTeams{selling: map[uint64]bool{sellingA: true, sellingB: true}}, broker, goods, nil, nil)
}

// PENJUALAN IS REPLAYED WITH THE RESTOCK FIGURES (the-report-is-processed-like-settlement — "the same, on the supplier's
// tables"): the replay clears it from its day — the day rows, the claims of the orders the seek brings back, the
// cancel's day of an order placed before it — and what the seek redelivers rebuilds EXACTLY the figures it had, in
// whatever order Pub/Sub brings them, the events from before the day it brings too folding nothing twice:
//
//	order 1  placed day-10                          before the day — untouched
//	order 2  placed day-9, cancelled day-8          before the day — untouched
//	order 3  placed day-8, cancelled day-4          placed BEFORE, cancelled IN — the cancel is forgotten and comes back
//	order 4  placed day-5, cancelled day-3          both IN — the claim goes, both come back (the cancel first)
//	order 5  cancelled day-2 BEFORE its placement day-4 was folded, both IN — the claim goes, both come back
//	order 6  placed day-3                           IN
//	order 7  cancelled day-5 before its placement day-7 was folded — placed BEFORE, cancelled IN
//	order 8  placed 00:30 WIB on the day itself     IN — the boundary is the Jakarta midnight
//	order 9  placed 23:59 WIB the day before        before the day — the seek may bring it (published after midnight)
func TestAnalyticReplayCompute_ClearsPenjualanAndTheSeekRebuildsTheSameFigures(t *testing.T) {
	db := san_testdb.DB(t)
	broker := &fakeBroker{window: 31 * 24 * time.Hour}

	goods := &fakeGoods{takes: map[uint64][]supplier_v1.SaleTakePart{
		7101: {{ProductID: salKaos, SupplierID: salSumber, TeamID: sellingA, WarehouseID: 5, Units: 2}},
		7102: {{ProductID: salCelana, SupplierID: salSinar, TeamID: sellingB, WarehouseID: 6, Units: 1}},
		7103: {
			{ProductID: salKaos, SupplierID: salSumber, TeamID: sellingA, WarehouseID: 5, Units: 3},
			{ProductID: salKaos, SupplierID: salSinar, TeamID: sellingA, WarehouseID: 5, Units: 1},
		},
		7104: {{ProductID: salKaos, SupplierID: salSumber, TeamID: sellingA, WarehouseID: 5, Units: 4}},
		7105: {{ProductID: salCelana, SupplierID: salSinar, TeamID: sellingB, WarehouseID: 6, Units: 2}},
		7106: {{ProductID: salCelana, SupplierID: salSumber, TeamID: sellingB, WarehouseID: 6, Units: 5}},
		7107: {{ProductID: salKaos, SupplierID: salSumber, TeamID: sellingA, WarehouseID: 5, Units: 1}},
		7108: {{ProductID: salKaos, SupplierID: salSumber, TeamID: sellingA, WarehouseID: 5, Units: 6}},
		7109: {{ProductID: salKaos, SupplierID: salSumber, TeamID: sellingA, WarehouseID: 5, Units: 7}},
	}}
	svc := replayService(db, broker, goods)

	// A replay starts after the live fold's first day — an accept folded long before.
	fold(t, svc, accept(1, sellingA, 31, jakartaDay(20), line{product: 100, ordered: 1, total: 1000, accepted: 1}))

	start := jakartaDay(6)

	placed := func(order uint64, daysAgo int, clock string, platformTotal float64, lines ...*eventsv1.OrderPlacedLine) *eventsv1.Event {
		return salePlaced(order, 7100+order, wib(jakartaDay(daysAgo), clock), platformTotal, lines...)
	}
	cancelled := func(order uint64, daysAgo int, clock string) *eventsv1.Event {
		return saleCancelled(order, wib(jakartaDay(daysAgo), clock))
	}

	p1 := placed(1, 10, "10:00", 20_000, saleLine(salKaos, 2, 20_000))
	p2, c2 := placed(2, 9, "10:00", 15_000, saleLine(salCelana, 1, 15_000)), cancelled(2, 8, "10:00")
	p3, c3 := placed(3, 8, "10:00", 44_000, saleLine(salKaos, 4, 40_000)), cancelled(3, 4, "10:00")
	p4, c4 := placed(4, 5, "10:00", 36_000, saleLine(salKaos, 4, 36_000)), cancelled(4, 3, "10:00")
	p5, c5 := placed(5, 4, "15:00", 50_000, saleLine(salCelana, 2, 50_000)), cancelled(5, 2, "09:00")
	p6 := placed(6, 3, "10:00", 75_000, saleLine(salCelana, 5, 70_000))
	p7, c7 := placed(7, 7, "23:00", 9_000, saleLine(salKaos, 1, 9_000)), cancelled(7, 5, "08:00")
	p8 := placed(8, 6, "00:30", 60_000, saleLine(salKaos, 6, 60_000))
	p9 := placed(9, 7, "23:59", 70_000, saleLine(salKaos, 7, 70_000))

	// Folded as they came — orders 5 and 7 cancel-first.
	for _, e := range []*eventsv1.Event{p1, p2, c2, p3, c7, p9, p7, p4, p8, c5, p5, c3, p6, c4} {
		salesFold(t, svc, e)
	}

	days := []string{jakartaDay(10), jakartaDay(9), jakartaDay(8), jakartaDay(7), jakartaDay(6), jakartaDay(5),
		jakartaDay(4), jakartaDay(3), jakartaDay(2)}
	neverReplayed := saleRows(t, db)
	neverReplayedSumber := penjualanByDay(t, svc, salSumber, days...)
	neverReplayedSinar := penjualanByDay(t, svc, salSinar, days...)

	// The fixture means something: the cancels in the range took figures back.
	if got := neverReplayedSumber[jakartaDay(4)]; got.count != -3 {
		t.Fatalf("Sumber on day-4 = %+v before the replay, want order 3's cancel (−3)", got)
	}

	_, err := svc.AnalyticReplayCompute(context.Background(), connect.NewRequest(&supplierv1.AnalyticReplayComputeRequest{
		StartDate: start,
	}))
	if err != nil {
		t.Fatalf("replay: %v", err)
	}

	// THE DELETE — only the days before the start are left, as they were. A row's key opens with its day.
	before := map[string]saleFigure{}
	for key, figure := range neverReplayed {
		if key[:10] < start {
			before[key] = figure
		}
	}

	sameSaleRows(t, "after the delete", saleRows(t, db), before)

	// The claims the seek brings back are gone with their parts; the rest are kept — order 3's and order 7's with no
	// cancel's day, so their redelivered cancels take them back again.
	for _, order := range []uint64{4, 5, 6, 8} {
		if _, found := saleOrder(t, db, order); found || salePartCount(t, db, order) != 0 {
			t.Fatalf("order %d placed in the range kept its claim (%v) or %d parts", order, found, salePartCount(t, db, order))
		}
	}

	for _, order := range []uint64{1, 2, 3, 7, 9} {
		claim, found := saleOrder(t, db, order)
		if !found || claim.PlacedDay == nil || salePartCount(t, db, order) == 0 {
			t.Fatalf("order %d placed before the range lost its claim or its parts: %+v", order, claim)
		}
	}

	for _, order := range []uint64{3, 7} {
		if claim, _ := saleOrder(t, db, order); claim.CancelledDay != nil {
			t.Fatalf("order %d's cancel in the range is still claimed (%v) — its redelivery would take nothing back",
				order, claim.CancelledDay)
		}
	}

	if claim, _ := saleOrder(t, db, 2); claim.CancelledDay == nil || claim.CancelledDay.Format("2006-01-02") != jakartaDay(8) {
		t.Fatalf("order 2's cancel before the range was forgotten: %+v", claim)
	}

	if len(broker.seeked) != 1 || broker.seeked[0].Format("2006-01-02") != start {
		t.Fatalf("seeked %v, want once, to %s", broker.seeked, start)
	}

	// THE SEEK — every event from the day's Jakarta midnight on, in Pub/Sub's own order (order 4's cancel first), and
	// three it may bring from before: order 9's, published after midnight, order 3's and a second copy of order 6's.
	for _, e := range []*eventsv1.Event{c4, c5, p8, p9, p6, c3, p5, p4, c7, p3, p6} {
		salesFold(t, svc, e)
	}

	sameSaleRows(t, "after the replay", saleRows(t, db), neverReplayed)

	for name, pair := range map[string][2]map[string]saleFigure{
		"Sumber": {penjualanByDay(t, svc, salSumber, days...), neverReplayedSumber},
		"Sinar":  {penjualanByDay(t, svc, salSinar, days...), neverReplayedSinar},
	} {
		for _, day := range days {
			checkSale(t, name+" on "+day, pair[0][day], pair[1][day])
		}
	}
}

// A CANCEL THAT CAME FIRST, its placement — from before the day — still on its way when the replay runs: the claim
// holding only the cancel is cleared, the seek brings the cancel back, and the placement, when it lands, adds on its day
// and takes back on the cancel's — as if no replay had run.
func TestAnalyticReplayCompute_ACancelFirstWhosePlacementIsOnItsWayIsRebuilt(t *testing.T) {
	db := san_testdb.DB(t)
	broker := &fakeBroker{window: 31 * 24 * time.Hour}
	goods := &fakeGoods{takes: map[uint64][]supplier_v1.SaleTakePart{
		7120: {{ProductID: salKaos, SupplierID: salSumber, TeamID: sellingA, WarehouseID: 5, Units: 3}},
	}}
	svc := replayService(db, broker, goods)

	fold(t, svc, accept(1, sellingA, 31, jakartaDay(20), line{product: 100, ordered: 1, total: 1000, accepted: 1}))

	placement := salePlaced(20, 7120, wib(jakartaDay(7), "22:00"), 30_000, saleLine(salKaos, 3, 30_000))
	cancel := saleCancelled(20, wib(jakartaDay(5), "07:00"))

	salesFold(t, svc, cancel)

	_, err := svc.AnalyticReplayCompute(context.Background(), connect.NewRequest(&supplierv1.AnalyticReplayComputeRequest{
		StartDate: jakartaDay(6),
	}))
	if err != nil {
		t.Fatalf("replay: %v", err)
	}

	if _, found := saleOrder(t, db, 20); found {
		t.Fatal("the claim holding only a cancel in the range survived the replay")
	}

	// The seek brings the cancel; the placement's own delivery lands after.
	salesFold(t, svc, cancel)
	salesFold(t, svc, placement)

	got := penjualanByDay(t, svc, salSumber, jakartaDay(7), jakartaDay(5))
	checkSale(t, "the placement's day", got[jakartaDay(7)], saleFigure{count: 3, value: 30_000})
	checkSale(t, "the cancel's day", got[jakartaDay(5)], saleFigure{count: -3, value: -30_000})
}
