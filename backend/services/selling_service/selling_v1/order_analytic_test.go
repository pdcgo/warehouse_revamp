package selling_v1_test

import (
	"context"
	"strconv"
	"sync"
	"testing"
	"time"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/types/known/timestamppb"

	analytic_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/analytic_base/v1"
	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_metric"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// THE ORDER METRICS (order_statistic_metric.md): the fold counts each move once on its Jakarta day, and the two reads
// give each reader its own orders — a warehouse without their money.

const (
	metricCreated       = "metrics/orders/created"
	metricCancelled     = "metrics/orders/cancelled"
	metricReturnCreated = "metrics/orders/return_created"
	metricReturnArrived = "metrics/orders/return_arrived"
	metricLostCreated   = "metrics/orders/lost_created"
)

// fakeTeamTypes answers which teams are warehouses.
type fakeTeamTypes map[uint64]bool

func (f fakeTeamTypes) IsWarehouse(_ context.Context, teamID uint64) (bool, error) {
	return f[teamID], nil
}

// 10:00 WIB on 29 October.
var foldAt = time.Date(2026, 10, 29, 3, 0, 0, 0, time.UTC)

func placedEvent(orderID uint64, at time.Time) *eventsv1.Event {
	ref := strconv.FormatUint(orderID, 10)

	return &eventsv1.Event{
		EventId: "order-placed:" + ref, OccurredAt: timestamppb.New(at), AggregateId: "order:" + ref,
		Message: &eventsv1.Event_OrderPlaced{OrderPlaced: &eventsv1.OrderPlaced{OrderId: orderID}},
	}
}

func cancelledEvent(orderID uint64, at time.Time) *eventsv1.Event {
	ref := strconv.FormatUint(orderID, 10)

	return &eventsv1.Event{
		EventId: "order-cancelled:" + ref, OccurredAt: timestamppb.New(at), AggregateId: "order:" + ref,
		Message: &eventsv1.Event_OrderCancelled{OrderCancelled: &eventsv1.OrderCancelled{OrderId: orderID}},
	}
}

func movedEvent(orderID, logID uint64, to string, at time.Time) *eventsv1.Event {
	return &eventsv1.Event{
		EventId:     "order-status-changed:" + strconv.FormatUint(logID, 10),
		OccurredAt:  timestamppb.New(at),
		AggregateId: "order:" + strconv.FormatUint(orderID, 10),
		Message: &eventsv1.Event_OrderStatusChanged{OrderStatusChanged: &eventsv1.OrderStatusChanged{
			OrderId: orderID, ToStatus: to, TimelineLogId: logID,
		}},
	}
}

func foldEvent(t *testing.T, analytic *selling_v1.Analytic, event *eventsv1.Event) {
	t.Helper()

	err := analytic.FoldHandler()(context.Background(), event)
	if err != nil {
		t.Fatalf("fold %s: %v", event.GetEventId(), err)
	}
}

// october is the window every read here asks.
func october() []*analytic_basev1.FilterItem {
	return []*analytic_basev1.FilterItem{{F: &analytic_basev1.FilterItem_DateRangeFilter{
		DateRangeFilter: &analytic_basev1.DateRangeFilter{DateMin: "2026-10-01", DateMax: "2026-10-31"},
	}}}
}

func metricData(
	analytic *selling_v1.Analytic,
	teamID uint64,
	group analytic_basev1.GroupType,
	keys *analytic_basev1.MetricKeys,
	metricIDs ...string,
) ([]*sellingv1.MetricData, error) {
	resp, err := analytic.MetricData(context.Background(), connect.NewRequest(&sellingv1.MetricDataRequest{
		TeamId: teamID, GroupBy: group, Filters: october(), Keys: keys, MetricIds: metricIDs,
	}))
	if err != nil {
		return nil, err
	}

	return resp.Msg.GetMetricDatas(), nil
}

func metricSearch(
	analytic *selling_v1.Analytic,
	teamID uint64,
	group analytic_basev1.GroupType,
	metricID, field string,
) (*sellingv1.MetricSearchResponse, error) {
	resp, err := analytic.MetricSearch(context.Background(), connect.NewRequest(&sellingv1.MetricSearchRequest{
		TeamId: teamID, GroupBy: group, Filters: october(),
		Sort: &analytic_basev1.MetricSort{MetricId: metricID, Field: field},
		Page: &analytic_basev1.PaginationFilter{Limit: 10},
	}))
	if err != nil {
		return nil, err
	}

	return resp.Msg, nil
}

// pricedOrder places team 2's order of goods costing 14.000 at a 2.5% fee — total_cost 14.350, platform_total 12.000 —
// by person 7.
func pricedOrder(t *testing.T, svc *selling_v1.Service, shopID uint64) uint64 {
	t.Helper()

	created, err := svc.OrderCreate(asUser(7), connect.NewRequest(feeOrderReq(shopID)))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	return created.Msg.GetOrder().GetId()
}

// EACH MOVE COUNTS ONCE, for its own metric: a redelivery counts nothing, a move no metric counts is ACKED, and every
// figure is the order's — its total_cost and its platform_total.
func TestOrderMetricFold_EachMoveCountsOnceForItsMetric(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newServiceWithFees(t, db, knownCosts(), &fakeFees{percent: 2.5})
	analytic := selling_v1.NewAnalytic(db, fakeTeamTypes{testWarehouse: true})
	orderID := pricedOrder(t, svc, insertShop(t, db, 2, "Shop", "S1", "shopee"))

	foldEvent(t, analytic, placedEvent(orderID, foldAt))
	foldEvent(t, analytic, placedEvent(orderID, foldAt)) // the redelivery
	foldEvent(t, analytic, movedEvent(orderID, 50, "processed", foldAt))
	foldEvent(t, analytic, movedEvent(orderID, 51, "return", foldAt))
	foldEvent(t, analytic, movedEvent(orderID, 52, "lost", foldAt))
	foldEvent(t, analytic, movedEvent(orderID, 53, "return_completed", foldAt))
	foldEvent(t, analytic, cancelledEvent(orderID, foldAt))

	datas, err := metricData(analytic, 2, analytic_basev1.GroupType_GROUP_TYPE_SUMMARY, nil,
		metricCreated, metricCancelled, metricReturnCreated, metricReturnArrived, metricLostCreated)
	if err != nil {
		t.Fatalf("MetricData: %v", err)
	}

	created := datas[0].GetCreatedSummary()
	if created.GetCreatedCount() != 1 || created.GetCreatedTotal() != 14_350 || created.GetMpTotal() != 12_000 {
		t.Fatalf("created = %+v, want 1 order, 14.350, 12.000 — once, however often it was delivered", created)
	}

	cancel := datas[1].GetCancelSummary()
	if cancel.GetCancelCount() != 1 || cancel.GetCancelTotal() != 14_350 {
		t.Fatalf("cancel = %+v, want 1 order of 14.350", cancel)
	}

	if datas[2].GetReturnCreatedSummary().GetReturnCreatedCount() != 1 ||
		datas[3].GetReturnArrivedSummary().GetReturnArrivedCount() != 1 ||
		datas[4].GetLostCreatedSummary().GetLostCreatedCount() != 1 ||
		datas[4].GetLostCreatedSummary().GetLostCreatedMpTotal() != 12_000 {
		t.Fatalf("the three moves = %+v %+v %+v, want one order each", datas[2], datas[3], datas[4])
	}

	var rows int64

	err = db.Raw(`SELECT count(*) FROM order_daily_reports`).Scan(&rows).Error
	if err != nil || rows != 5 {
		t.Fatalf("%d report rows (err %v), want 5 — the confirm counts for no metric", rows, err)
	}
}

// THE DAY IS JAKARTA'S: 18:30 UTC on the 29th is 01:30 on the 30th in WIB, and counts on the 30th.
func TestOrderMetricFold_TheDayIsJakartas(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newServiceWithFees(t, db, knownCosts(), &fakeFees{percent: 2.5})
	analytic := selling_v1.NewAnalytic(db, fakeTeamTypes{})
	orderID := pricedOrder(t, svc, insertShop(t, db, 2, "Shop", "S1", "shopee"))

	foldEvent(t, analytic, placedEvent(orderID, time.Date(2026, 10, 29, 18, 30, 0, 0, time.UTC)))

	days := &analytic_basev1.MetricKeys{K: &analytic_basev1.MetricKeys_Days{
		Days: &analytic_basev1.DayList{Days: []string{"2026-10-29", "2026-10-30"}},
	}}

	datas, err := metricData(analytic, 2, analytic_basev1.GroupType_GROUP_TYPE_DAILY, days, metricCreated)
	if err != nil {
		t.Fatalf("MetricData: %v", err)
	}

	items := datas[0].GetCreatedByDay().GetItems()
	if items["2026-10-29"].GetCreatedCount() != 0 || items["2026-10-30"].GetCreatedCount() != 1 {
		t.Fatalf("by day = %+v, want the order on the 30th (WIB), and the 29th present at zero", items)
	}
}

// A WAREHOUSE READS THE ORDERS IT SHIPS, COUNTS ONLY: its money fields are UNSET, never 0, and a sort on one is
// refused. Root reads every order with its money; another seller reads none.
func TestOrderMetricData_EachReaderReadsItsOwn(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newServiceWithFees(t, db, knownCosts(), &fakeFees{percent: 2.5})
	analytic := selling_v1.NewAnalytic(db, fakeTeamTypes{testWarehouse: true})
	orderID := pricedOrder(t, svc, insertShop(t, db, 2, "Shop", "S1", "shopee"))

	foldEvent(t, analytic, placedEvent(orderID, foldAt))

	summary := func(teamID uint64) *sellingv1.OrderCreatedMetric {
		t.Helper()

		datas, err := metricData(analytic, teamID, analytic_basev1.GroupType_GROUP_TYPE_SUMMARY, nil, metricCreated)
		if err != nil {
			t.Fatalf("MetricData(%d): %v", teamID, err)
		}

		return datas[0].GetCreatedSummary()
	}

	warehouse := summary(testWarehouse)
	if warehouse.GetCreatedCount() != 1 || warehouse.CreatedTotal != nil || warehouse.MpTotal != nil {
		t.Fatalf("the warehouse read %+v, want its 1 order and NO money (unset)", warehouse)
	}

	root := summary(san_auth.RootTeamID)
	if root.GetCreatedCount() != 1 || root.CreatedTotal == nil || root.GetCreatedTotal() != 14_350 {
		t.Fatalf("root read %+v, want every order with its money", root)
	}

	other := summary(3)
	if other.GetCreatedCount() != 0 || other.CreatedTotal == nil || other.GetCreatedTotal() != 0 {
		t.Fatalf("another seller read %+v, want none of team 2's orders — and its money set, at 0", other)
	}

	_, err := metricSearch(analytic, testWarehouse, analytic_basev1.GroupType_GROUP_TYPE_SHOP, metricCreated, "created_total")
	wantCode(t, err, connect.CodeInvalidArgument)

	byCount, err := metricSearch(analytic, testWarehouse, analytic_basev1.GroupType_GROUP_TYPE_TEAM, metricCreated, "created_count")
	if err != nil || len(byCount.GetKeys().GetIds().GetIds()) != 1 || byCount.GetKeys().GetIds().GetIds()[0] != 2 {
		t.Fatalf("the warehouse grouped by TEAM = %+v (err %v), want its one seller, team 2", byCount, err)
	}
}

// THE SEARCH RANKS, THE FILL FILLS EVERY ASKED KEY: two orders in shop A and one in B rank A first; an asked shop with
// nothing comes back at zero, never missing.
func TestOrderMetricSearch_RanksAndTheFillAnswersEveryKey(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newServiceWithFees(t, db, knownCosts(), &fakeFees{percent: 2.5})
	analytic := selling_v1.NewAnalytic(db, fakeTeamTypes{})

	shopA := insertShop(t, db, 2, "Shop A", "SA", "shopee")
	shopB := insertShop(t, db, 2, "Shop B", "SB", "shopee")

	for _, shop := range []uint64{shopA, shopA, shopB} {
		foldEvent(t, analytic, placedEvent(pricedOrder(t, svc, shop), foldAt))
	}

	ranked, err := metricSearch(analytic, 2, analytic_basev1.GroupType_GROUP_TYPE_SHOP, metricCreated, "created_count")
	if err != nil {
		t.Fatalf("MetricSearch: %v", err)
	}

	ids := ranked.GetKeys().GetIds().GetIds()
	if len(ids) != 2 || ids[0] != shopA || ids[1] != shopB || ranked.GetHasNext() {
		t.Fatalf("ranked %v (next %v), want [A=%d B=%d] and no next page", ids, ranked.GetHasNext(), shopA, shopB)
	}

	asked := &analytic_basev1.MetricKeys{K: &analytic_basev1.MetricKeys_Ids{
		Ids: &analytic_basev1.IDList{Ids: []uint64{shopA, shopB, 999_999}},
	}}

	datas, err := metricData(analytic, 2, analytic_basev1.GroupType_GROUP_TYPE_SHOP, asked, metricCreated, metricCancelled)
	if err != nil {
		t.Fatalf("MetricData: %v", err)
	}

	created := datas[0].GetCreatedById().GetItems()
	if created[shopA].GetCreatedCount() != 2 || created[shopB].GetCreatedCount() != 1 || created[999_999] == nil ||
		created[999_999].GetCreatedCount() != 0 {
		t.Fatalf("created by shop = %+v, want A 2, B 1, and the unknown shop present at 0", created)
	}

	if cancel := datas[1].GetCancelById().GetItems(); len(cancel) != 3 || cancel[shopA].GetCancelCount() != 0 {
		t.Fatalf("cancel by shop = %+v, want all three asked shops at 0", cancel)
	}
}

// A BAD ASK IS REFUSED: a week keyed by a Tuesday, a metric this service does not serve, and a search with no window.
func TestOrderMetricData_RefusesABadAsk(t *testing.T) {
	db := san_testdb.DB(t)
	analytic := selling_v1.NewAnalytic(db, fakeTeamTypes{})

	tuesday := &analytic_basev1.MetricKeys{K: &analytic_basev1.MetricKeys_Days{
		Days: &analytic_basev1.DayList{Days: []string{"2026-10-27"}},
	}}

	_, err := metricData(analytic, 2, analytic_basev1.GroupType_GROUP_TYPE_WEEKLY, tuesday, metricCreated)
	wantCode(t, err, connect.CodeInvalidArgument)

	_, err = metricData(analytic, 2, analytic_basev1.GroupType_GROUP_TYPE_SUMMARY, nil, "metrics/suppliers")
	wantCode(t, err, connect.CodeInvalidArgument)

	_, err = analytic.MetricSearch(context.Background(), connect.NewRequest(&sellingv1.MetricSearchRequest{
		TeamId: 2, GroupBy: analytic_basev1.GroupType_GROUP_TYPE_SHOP,
		Sort: &analytic_basev1.MetricSort{MetricId: metricCreated, Field: "created_count"},
		Page: &analytic_basev1.PaginationFilter{Limit: 10},
	}))
	wantCode(t, err, connect.CodeInvalidArgument)
}

// The five pass the same startup check every metric does (san_metric.ValidateDescriptors).
func TestOrderMetrics_PassTheStartupCheck(t *testing.T) {
	err := san_metric.ValidateDescriptors()
	if err != nil {
		t.Fatalf("ValidateDescriptors: %v", err)
	}
}

// moveRecorder captures events from concurrent publishes.
type moveRecorder struct {
	mu     sync.Mutex
	events []*eventsv1.Event
}

func (r *moveRecorder) send(_ context.Context, _ *role_basev1.Identity, event *eventsv1.Event) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	r.events = append(r.events, event)

	return nil
}

// A BATCH MOVE ANNOUNCES EACH ORDER (the-status-changes-publish-nothing): one OrderStatusChanged per order, from and to,
// its event id derived from the order's own timeline row, after the commit.
func TestOrderStatusChange_PublishesEachMove(t *testing.T) {
	db := san_testdb.DB(t)
	rec := &moveRecorder{}
	svc := newServiceWithEvents(t, db, rec.send)
	shopID := insertShop(t, db, 2, "Shop", "S1", "shopee")

	first, second := placeOrder(t, svc, 2, shopID), placeOrder(t, svc, 2, shopID)

	rec.mu.Lock()
	rec.events = nil // the two placements
	rec.mu.Unlock()

	changeStatus(t, svc, testWarehouse, sellingv1.OrderStatus_ORDER_STATUS_PROCESSED, "", first, second)

	moved := map[uint64]*eventsv1.OrderStatusChanged{}

	for _, event := range rec.events {
		change := event.GetOrderStatusChanged()
		if change == nil {
			t.Fatalf("published %v, want only OrderStatusChanged", event.GetMessage())
		}

		if event.GetEventId() != "order-status-changed:"+strconv.FormatUint(change.GetTimelineLogId(), 10) {
			t.Fatalf("event id %q, want it derived from timeline row %d", event.GetEventId(), change.GetTimelineLogId())
		}

		moved[change.GetOrderId()] = change
	}

	for _, id := range []uint64{first, second} {
		change := moved[id]
		if change == nil || change.GetFromStatus() != "pending" || change.GetToStatus() != "processed" ||
			change.GetTeamId() != 2 || change.GetTimelineLogId() == 0 {
			t.Fatalf("order %d's event = %+v, want pending → processed for team 2, naming its timeline row", id, change)
		}
	}

	if len(rec.events) != 2 {
		t.Fatalf("%d events for a batch of 2, want one per order", len(rec.events))
	}
}
