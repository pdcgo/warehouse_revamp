package settlement_v1_test

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	settlementv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_service_models"
	settlement_v1 "github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_v1"
)

const (
	creator    uint64 = 7
	otherOrder uint64 = 5002
	otherShop  uint64 = 31
)

var wib = time.FixedZone("WIB", 7*60*60)

// logPosted is one SettlementLogPosted as the ledger would publish it, on a chosen day.
func logPosted(
	logID uint64,
	day string,
	shopID, orderID, orderCreator, actor uint64,
	settlementType settlementv1.SettlementType,
	change int64,
) *eventsv1.Event {
	return &eventsv1.Event{
		EventId:     fmt.Sprintf("settlement-log:%d", logID),
		OccurredAt:  timestamppb.Now(),
		AggregateId: fmt.Sprintf("shop:%d", shopID),
		Message: &eventsv1.Event_SettlementLogPosted{
			SettlementLogPosted: &eventsv1.SettlementLogPosted{
				LogId:                logID,
				UniqueId:             fmt.Sprintf("key-%d", logID),
				OrderId:              orderID,
				ShopId:               shopID,
				TeamId:               team,
				ActorId:              actor,
				OrderCreatedByUserId: orderCreator,
				SettlementType:       settlementType,
				SourceType:           settlementv1.SourceType_SOURCE_TYPE_IMPORTER,
				Change:               change,
				PostedOn:             day,
				OccurredOn:           day,
			},
		},
	}
}

// workedExample is the design's own example across three days — and the ads fee arrives LATE, after the
// fund on the day after it, which is the case the later-day shift exists for.
func workedExample() []*eventsv1.Event {
	return []*eventsv1.Event{
		logPosted(1, "2026-01-01", shop, order, creator, creator,
			settlementv1.SettlementType_SETTLEMENT_TYPE_INITIAL_TOTAL, -sale),
		logPosted(2, "2026-01-03", shop, order, creator, 3,
			settlementv1.SettlementType_SETTLEMENT_TYPE_FUND, 100_000),
		logPosted(3, "2026-01-02", shop, order, creator, 3,
			settlementv1.SettlementType_SETTLEMENT_TYPE_EXTERNAL_ADS_FEE, -10_000),
	}
}

func fold(t *testing.T, svc *settlement_v1.Service, events ...*eventsv1.Event) {
	t.Helper()

	handler := svc.FoldHandler()

	for _, event := range events {
		err := handler(context.Background(), event)
		if err != nil {
			t.Fatalf("fold %s: %v", event.GetEventId(), err)
		}
	}
}

type dayWant struct {
	day    string
	change int64
	open   int64
	close  int64
}

func assertDays(t *testing.T, got []settlement_service_models.SettlementMetricColumns, days []time.Time, want []dayWant) {
	t.Helper()

	if len(got) != len(want) {
		t.Fatalf("%d day rows, want %d", len(got), len(want))
	}

	for i := range want {
		if days[i].Format(time.DateOnly) != want[i].day || got[i].Change != want[i].change ||
			got[i].OpenBalance != want[i].open || got[i].CloseBalance != want[i].close {
			t.Fatalf("day %d = %s change %d open %d close %d, want %+v",
				i, days[i].Format(time.DateOnly), got[i].Change, got[i].OpenBalance, got[i].CloseBalance, want[i])
		}
	}
}

func shopDays(t *testing.T, db *gorm.DB, shopID uint64) ([]settlement_service_models.SettlementMetricColumns, []time.Time) {
	t.Helper()

	rows := []settlement_service_models.ShopSettlementDailyReport{}

	err := db.Where("shop_id = ? AND team_id = ?", shopID, team).Order("day ASC").Find(&rows).Error
	if err != nil {
		t.Fatalf("read shop days: %v", err)
	}

	metrics := make([]settlement_service_models.SettlementMetricColumns, 0, len(rows))
	days := make([]time.Time, 0, len(rows))

	for i := range rows {
		metrics = append(metrics, rows[i].SettlementMetricColumns)
		days = append(days, rows[i].Day)
	}

	return metrics, days
}

func userDays(t *testing.T, db *gorm.DB, userID uint64) ([]settlement_service_models.SettlementMetricColumns, []time.Time) {
	t.Helper()

	rows := []settlement_service_models.UserSettlementDailyReport{}

	err := db.Where("user_id = ? AND team_id = ?", userID, team).Order("day ASC").Find(&rows).Error
	if err != nil {
		t.Fatalf("read user days: %v", err)
	}

	metrics := make([]settlement_service_models.SettlementMetricColumns, 0, len(rows))
	days := make([]time.Time, 0, len(rows))

	for i := range rows {
		metrics = append(metrics, rows[i].SettlementMetricColumns)
		days = append(days, rows[i].Day)
	}

	return metrics, days
}

var workedExampleDays = []dayWant{
	{day: "2026-01-01", change: -120_000, open: 0, close: -120_000},
	{day: "2026-01-02", change: -10_000, open: -120_000, close: -130_000},
	{day: "2026-01-03", change: 100_000, open: -130_000, close: -30_000},
}

// ⚠ THE LATE EVENT. The ads fee for 01-02 is folded after 01-03 already exists, so 01-03's carry must be
// SHIFTED — without it 01-03 would still open at −120.000 and close −20.000, and `close − open = change`
// would hold on every row while every figure after 01-02 was wrong.
func TestFold_BuildsTheShopAndUserDaysAndShiftsLaterDays(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, nil)

	fold(t, svc, workedExample()...)

	metrics, days := shopDays(t, db, shop)
	assertDays(t, metrics, days, workedExampleDays)

	if metrics[0].InitialTotal != -sale || metrics[1].ExternalAdsFee != -10_000 || metrics[2].Fund != 100_000 {
		t.Fatalf("movements filed under the wrong columns: %+v", metrics)
	}

	// Every row of the order counts to its CREATOR — the fund and the fee were posted by someone else.
	userMetrics, userDaysGot := userDays(t, db, creator)
	assertDays(t, userMetrics, userDaysGot, workedExampleDays)

	var state settlement_service_models.ShopSettlementReport

	err := db.Where("shop_id = ? AND team_id = ?", shop, team).Take(&state).Error
	if err != nil {
		t.Fatalf("read shop state: %v", err)
	}

	if state.CloseBalance != -30_000 {
		t.Fatalf("shop state close = %d, want −30.000 — the NEWEST day's close", state.CloseBalance)
	}
}

// At-least-once delivery: the same event twice is folded once.
func TestFold_IsIdempotentOnTheEventID(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, nil)

	first := workedExample()[0]
	fold(t, svc, first, first)

	metrics, days := shopDays(t, db, shop)
	assertDays(t, metrics, days, workedExampleDays[:1])
}

// While the developer's switch is on, every event is REFUSED — the driver returns 500 and Pub/Sub
// redelivers it later — and nothing is claimed, so the redelivery is folded.
func TestFold_RefusesWhileTheEventLockIsHeld(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, nil)

	err := db.Exec(`UPDATE settlement_service_metadata SET value = '{"lock":true}' WHERE key = 'process_event_lock'`).Error
	if err != nil {
		t.Fatalf("take the lock: %v", err)
	}

	err = svc.FoldHandler()(context.Background(), workedExample()[0])
	if err == nil {
		t.Fatalf("fold while locked succeeded — it must return an error so the event is redelivered")
	}

	var claimed int64

	err = db.Raw(`SELECT COUNT(*) FROM settlement_event_logs`).Scan(&claimed).Error
	if err != nil {
		t.Fatalf("count claims: %v", err)
	}

	if claimed != 0 {
		t.Fatalf("a refused event was claimed — its redelivery would be dropped as a duplicate")
	}
}

// ⚠ A LOCK THAT CANNOT BE READ IS NOT "UNLOCKED". Failing open would make the guard vanish exactly when
// it is misconfigured.
func TestFold_RefusesAnUnparseableLock(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, nil)

	err := db.Exec(`UPDATE settlement_service_metadata SET value = 'off' WHERE key = 'process_event_lock'`).Error
	if err != nil {
		t.Fatalf("corrupt the lock: %v", err)
	}

	err = svc.FoldHandler()(context.Background(), workedExample()[0])
	if err == nil {
		t.Fatalf("fold with an unparseable lock succeeded")
	}
}

// A shop-addressed row has no order and so no creator — the user grain files it under its ACTOR.
func TestFold_AttributesAShopRowToItsActor(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, nil)

	fold(t, svc, logPosted(9, "2026-01-05", shop, 0, 0, 9,
		settlementv1.SettlementType_SETTLEMENT_TYPE_SYSTEM_ADJUSTMENT, -5_000))

	metrics, days := userDays(t, db, 9)
	assertDays(t, metrics, days, []dayWant{{day: "2026-01-05", change: -5_000, open: 0, close: -5_000}})

	if metrics[0].SystemAdjustment != -5_000 {
		t.Fatalf("system_adjustment = %d, want −5.000", metrics[0].SystemAdjustment)
	}
}

type fakeBroker struct {
	window time.Duration
	err    error
	seeks  []time.Time
}

func (b *fakeBroker) ReplayWindow(context.Context) (time.Duration, error) {
	return b.window, b.err
}

func (b *fakeBroker) Seek(_ context.Context, to time.Time) error {
	b.seeks = append(b.seeks, to)

	return nil
}

func jakartaDay(offsetDays int) string {
	return time.Now().In(wib).AddDate(0, 0, offsetDays).Format(time.DateOnly)
}

func lockValue(t *testing.T, db *gorm.DB) string {
	t.Helper()

	var value string

	err := db.Raw(`SELECT value FROM settlement_service_metadata WHERE key = 'process_event_lock'`).Scan(&value).Error
	if err != nil {
		t.Fatalf("read the lock: %v", err)
	}

	return value
}

// The replay clears its range on ONE line across three tables, seeks the Jakarta midnight it cut at,
// reports "started", and releases the lock.
func TestAnalyticReplayCompute_ClearsTheRangeAndSeeks(t *testing.T) {
	db := san_testdb.DB(t)
	broker := &fakeBroker{window: 7 * 24 * time.Hour}
	svc := settlement_v1.NewService(db, nil, broker, nil)

	fold(t, svc,
		logPosted(1, jakartaDay(-1), shop, order, creator, creator,
			settlementv1.SettlementType_SETTLEMENT_TYPE_INITIAL_TOTAL, -sale),
		logPosted(2, jakartaDay(0), shop, order, creator, 3,
			settlementv1.SettlementType_SETTLEMENT_TYPE_FUND, 100_000),
	)

	res, err := svc.AnalyticReplayCompute(context.Background(), connect.NewRequest(&settlementv1.AnalyticReplayComputeRequest{
		StartDate: jakartaDay(0),
	}))
	if err != nil {
		t.Fatalf("AnalyticReplayCompute: %v", err)
	}

	msg := res.Msg
	if msg.GetStatus() != "started" || msg.GetDeletedShopDays() != 1 || msg.GetDeletedUserDays() != 1 ||
		msg.GetDeletedEventLogs() != 1 {
		t.Fatalf("replay response = %+v — want today's one row per table deleted and yesterday kept", msg)
	}

	if len(broker.seeks) != 1 {
		t.Fatalf("seeked %d times, want 1", len(broker.seeks))
	}

	today, _ := time.ParseInLocation(time.DateOnly, jakartaDay(0), wib)
	if !broker.seeks[0].Equal(today) {
		t.Fatalf("seeked to %v, want Jakarta midnight %v", broker.seeks[0], today)
	}

	if value := lockValue(t, db); value != `{"lock":false}` {
		t.Fatalf("lock after the replay = %s, want released", value)
	}
}

// ⚠ THE ACCEPTED LIMIT IS REFUSED BY NAME, never partly done. A start older than the subscription can
// redeliver would delete days nothing can rebuild.
func TestAnalyticReplayCompute_RefusesOutsideTheRetention(t *testing.T) {
	db := san_testdb.DB(t)
	broker := &fakeBroker{window: 7 * 24 * time.Hour}
	svc := settlement_v1.NewService(db, nil, broker, nil)

	_, err := svc.AnalyticReplayCompute(context.Background(), connect.NewRequest(&settlementv1.AnalyticReplayComputeRequest{
		StartDate: jakartaDay(-30),
	}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("30 days back with a 7-day window: got %v, want FailedPrecondition", err)
	}

	if len(broker.seeks) != 0 {
		t.Fatalf("a refused replay seeked")
	}
}

// A retention that cannot be read is refused rather than guessed, and a lock already held refuses a
// second replay.
func TestAnalyticReplayCompute_RefusesAnUnreadableWindowAndAHeldLock(t *testing.T) {
	db := san_testdb.DB(t)

	unreadable := settlement_v1.NewService(db, nil, &fakeBroker{err: errors.New("admin API down")}, nil)

	_, err := unreadable.AnalyticReplayCompute(context.Background(), connect.NewRequest(&settlementv1.AnalyticReplayComputeRequest{
		StartDate: jakartaDay(0),
	}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("unreadable window: got %v, want FailedPrecondition", err)
	}

	err = db.Exec(`UPDATE settlement_service_metadata SET value = '{"lock":true}' WHERE key = 'process_event_lock'`).Error
	if err != nil {
		t.Fatalf("take the lock: %v", err)
	}

	broker := &fakeBroker{window: 7 * 24 * time.Hour}
	locked := settlement_v1.NewService(db, nil, broker, nil)

	_, err = locked.AnalyticReplayCompute(context.Background(), connect.NewRequest(&settlementv1.AnalyticReplayComputeRequest{
		StartDate: jakartaDay(0),
	}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition || len(broker.seeks) != 0 {
		t.Fatalf("held lock: got %v with %d seeks, want FailedPrecondition and none", err, len(broker.seeks))
	}

	if value := lockValue(t, db); value != `{"lock":true}` {
		t.Fatalf("a refused replay released someone else's lock: %s", value)
	}
}

// Maintenance prunes dedup rows by when they were RECEIVED, keeping everything inside the retention.
func TestAnalyticMaintenanceRun_PrunesOnlyExpiredClaims(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, nil)

	err := db.Exec(`
INSERT INTO settlement_event_logs (id, raw, day, created_at) VALUES
    ('settlement-log:old', '\x00', CURRENT_DATE, NOW() - INTERVAL '60 days'),
    ('settlement-log:new', '\x00', CURRENT_DATE - 60, NOW())`).Error
	if err != nil {
		t.Fatalf("seed claims: %v", err)
	}

	res, err := svc.AnalyticMaintenanceRun(context.Background(), connect.NewRequest(&settlementv1.AnalyticMaintenanceRunRequest{}))
	if err != nil {
		t.Fatalf("AnalyticMaintenanceRun: %v", err)
	}

	if res.Msg.GetDeletedEventLogs() != 1 {
		t.Fatalf("deleted %d claims, want 1 — a late event for an old DAY received today keeps its guard",
			res.Msg.GetDeletedEventLogs())
	}
}
