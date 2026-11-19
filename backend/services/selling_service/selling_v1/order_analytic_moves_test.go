package selling_v1_test

import (
	"strconv"
	"testing"
	"time"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"

	analytic_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/analytic_base/v1"
	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// ORDER STATUS MOVES (the-order-status-moves-prototype-is-accepted): one metric, a count per status an order moved TO —
// Confirmed · Back to pending · Picked · Handed over · Shipped · Problem · Completed — each move on its own Jakarta day,
// under the order's creator, read by the seller, the warehouse that ships it and root, and nobody else; counts only.

const metricMoves = "metrics/orders/moves"

// moveFields is the seven counts in the proto's order.
var moveFields = []string{
	"confirmed_count", "back_to_pending_count", "picked_count", "handed_over_count", "shipped_count", "problem_count",
	"completed_count",
}

// moveCounts is a moves message as the seven counts, by field name.
func moveCounts(m *sellingv1.OrderMovesMetric) map[string]int64 {
	return map[string]int64{
		"confirmed_count":       m.GetConfirmedCount(),
		"back_to_pending_count": m.GetBackToPendingCount(),
		"picked_count":          m.GetPickedCount(),
		"handed_over_count":     m.GetHandedOverCount(),
		"shipped_count":         m.GetShippedCount(),
		"problem_count":         m.GetProblemCount(),
		"completed_count":       m.GetCompletedCount(),
	}
}

func wantMoves(t *testing.T, label string, got *sellingv1.OrderMovesMetric, want map[string]int64) {
	t.Helper()

	counts := moveCounts(got)
	for _, field := range moveFields {
		if counts[field] != want[field] {
			t.Fatalf("%s: %s = %d, want %d (all: %v)", label, field, counts[field], want[field], counts)
		}
	}
}

// movesSummary is the reader's Order status moves over october().
func movesSummary(t *testing.T, analytic *selling_v1.Analytic, teamID uint64) *sellingv1.OrderMovesMetric {
	t.Helper()

	datas, err := metricData(analytic, teamID, analytic_basev1.GroupType_GROUP_TYPE_SUMMARY, nil, metricMoves)
	if err != nil {
		t.Fatalf("MetricData(%d): %v", teamID, err)
	}

	return datas[0].GetMovesSummary()
}

// todaysData is MetricData over today alone (Jakarta) — the window of moves made through the real RPCs, which happen now.
func todaysData(t *testing.T, analytic *selling_v1.Analytic, teamID uint64, metricIDs ...string) []*sellingv1.MetricData {
	t.Helper()

	today := todayInJakarta()

	resp, err := analytic.MetricData(t.Context(), connect.NewRequest(&sellingv1.MetricDataRequest{
		TeamId: teamID, GroupBy: analytic_basev1.GroupType_GROUP_TYPE_SUMMARY, MetricIds: metricIDs,
		Filters: []*analytic_basev1.FilterItem{{F: &analytic_basev1.FilterItem_DateRangeFilter{
			DateRangeFilter: &analytic_basev1.DateRangeFilter{DateMin: today, DateMax: today},
		}}},
	}))
	if err != nil {
		t.Fatalf("MetricData today (%d): %v", teamID, err)
	}

	return resp.Msg.GetMetricDatas()
}

// movedBy is an OrderStatusChanged into `to` made by `actor` at `at` — the event a move announces.
func movedBy(orderID, logID uint64, from, to string, actor uint64, at time.Time) *eventsv1.Event {
	return &eventsv1.Event{
		EventId:     "order-status-changed:" + strconv.FormatUint(logID, 10),
		OccurredAt:  timestamppb.New(at),
		AggregateId: "order:" + strconv.FormatUint(orderID, 10),
		Message: &eventsv1.Event_OrderStatusChanged{OrderStatusChanged: &eventsv1.OrderStatusChanged{
			TeamId: 2, OrderId: orderID, FromStatus: from, ToStatus: to, ActorId: actor, TimelineLogId: logID,
		}},
	}
}

// moveAs makes one move through OrderStatusChange as person `actor` — never the order's creator here.
func moveAs(t *testing.T, svc *selling_v1.Service, actor, teamID, orderID uint64, to sellingv1.OrderStatus, note string) {
	t.Helper()

	res, err := svc.OrderStatusChange(asUser(actor), connect.NewRequest(&sellingv1.OrderStatusChangeRequest{
		TeamId: teamID, OrderIds: []uint64{orderID}, To: to, Note: note,
	}))
	if err != nil {
		t.Fatalf("OrderStatusChange(%d → %v): %v", orderID, to, err)
	}

	if !res.Msg.GetResults()[0].GetMoved() {
		t.Fatalf("order %d → %v refused: %s", orderID, to, res.Msg.GetResults()[0].GetRefusedReason())
	}
}

// movesMoney is the money every Order status moves row holds — it must be none.
func movesMoney(t *testing.T, db *gorm.DB) (float64, float64) {
	t.Helper()

	var sums struct {
		Total   float64
		MpTotal float64
	}

	err := db.Raw(`SELECT COALESCE(SUM(total), 0) AS total, COALESCE(SUM(mp_total), 0) AS mp_total
FROM order_daily_reports WHERE metric LIKE 'moves\_%'`).Scan(&sums).Error
	if err != nil {
		t.Fatalf("the moves' money: %v", err)
	}

	return sums.Total, sums.MpTotal
}

// EVERY MOVE IS NAMED BY WHERE THE ORDER WENT (the-order-metric-ids-name-what-moved), through the real moves: order A
// is confirmed, picked, handed back from picked, confirmed and picked again, handed over, shipped, a problem and resolved;
// order B is confirmed, handed back from processed, confirmed, picked, handed over, shipped and completed. Every move
// published OrderStatusChanged; folded, the resolve is a Completed, both hand backs are a Back to pending, and the two
// placements' own pending rows are NONE of them. No move row carries money, and a redelivery counts nothing.
func TestOrderMovesFold_EveryMoveIsNamedByWhereTheOrderWent(t *testing.T) {
	db := san_testdb.DB(t)
	rec := &moveRecorder{}
	svc := selling_v1.NewService(db, knownCosts(), rec.send, &fakeCatalog{}, &fakeCredit{}, everyoneMayWrite{}, nil,
		&fakeFees{percent: 2.5}, nil, nil, nil)
	analytic := selling_v1.NewAnalytic(db, fakeTeamTypes{testWarehouse: true})
	shop := insertShop(t, db, 2, "Shop", "S1", "shopee")

	a, b := pricedOrder(t, svc, shop), pricedOrder(t, svc, shop)

	const crew = 55

	type step struct {
		order uint64
		team  uint64
		to    sellingv1.OrderStatus
		note  string
	}

	for _, s := range []step{
		{a, testWarehouse, sellingv1.OrderStatus_ORDER_STATUS_PROCESSED, ""},
		{a, testWarehouse, sellingv1.OrderStatus_ORDER_STATUS_PICKED, ""},
		{a, testWarehouse, sellingv1.OrderStatus_ORDER_STATUS_PENDING, "cancelled on the platform"},
		{a, testWarehouse, sellingv1.OrderStatus_ORDER_STATUS_PROCESSED, ""},
		{a, testWarehouse, sellingv1.OrderStatus_ORDER_STATUS_PICKED, ""},
		{a, testWarehouse, sellingv1.OrderStatus_ORDER_STATUS_SHIPPING, ""},
		{a, 2, sellingv1.OrderStatus_ORDER_STATUS_SHIPPED, ""},
		{a, 2, sellingv1.OrderStatus_ORDER_STATUS_PROBLEM, ""},
		{a, 2, sellingv1.OrderStatus_ORDER_STATUS_COMPLETED, ""},
		{b, testWarehouse, sellingv1.OrderStatus_ORDER_STATUS_PROCESSED, ""},
		{b, testWarehouse, sellingv1.OrderStatus_ORDER_STATUS_PENDING, "goods on no rack"},
		{b, testWarehouse, sellingv1.OrderStatus_ORDER_STATUS_PROCESSED, ""},
		{b, testWarehouse, sellingv1.OrderStatus_ORDER_STATUS_PICKED, ""},
		{b, testWarehouse, sellingv1.OrderStatus_ORDER_STATUS_SHIPPING, ""},
		{b, 2, sellingv1.OrderStatus_ORDER_STATUS_SHIPPED, ""},
		{b, 2, sellingv1.OrderStatus_ORDER_STATUS_COMPLETED, ""},
	} {
		moveAs(t, svc, crew, s.team, s.order, s.to, s.note)
	}

	moved := 0

	for _, event := range rec.events {
		if event.GetOrderStatusChanged() != nil {
			moved++
		}

		foldEvent(t, analytic, event)
	}

	if moved != 16 {
		t.Fatalf("%d OrderStatusChanged published, want one per move — 16", moved)
	}

	wantMoves(t, "team 2's moves", todaysData(t, analytic, 2, metricMoves)[0].GetMovesSummary(), map[string]int64{
		"confirmed_count": 4, "back_to_pending_count": 2, "picked_count": 3, "handed_over_count": 2,
		"shipped_count": 2, "problem_count": 1, "completed_count": 2,
	})

	total, mp := movesMoney(t, db)
	if total != 0 || mp != 0 {
		t.Fatalf("the moves' rows hold total %v, mp_total %v — want none: the metric is counts only", total, mp)
	}

	// The five are untouched: two placements, nothing else.
	datas := todaysData(t, analytic, 2, metricCreated, metricCancelled)
	if datas[0].GetCreatedSummary().GetCreatedCount() != 2 || datas[1].GetCancelSummary().GetCancelCount() != 0 {
		t.Fatalf("the five = %+v %+v, want 2 created and no cancel", datas[0], datas[1])
	}

	// A redelivery of every move counts nothing.
	for _, event := range rec.events {
		foldEvent(t, analytic, event)
	}

	wantMoves(t, "after the redeliveries", todaysData(t, analytic, 2, metricMoves)[0].GetMovesSummary(), map[string]int64{
		"confirmed_count": 4, "back_to_pending_count": 2, "picked_count": 3, "handed_over_count": 2,
		"shipped_count": 2, "problem_count": 1, "completed_count": 2,
	})
}

// moveDay is 10:00 WIB on a day of October 2026 — where a test's moves fall.
func moveDay(day int) time.Time {
	return time.Date(2026, 10, day, 10, 0, 0, 0, time.FixedZone("WIB", 7*60*60))
}

// EACH MOVE ON ITS OWN DAY, UNDER THE ORDER'S CREATOR (a-fact-counts-on-the-day-it-happened,
// a-metrics-user-is-the-orders-creator): the order is Ani's (person 7), every move made by crew member 55. By day, each
// count sits on its move's day and nowhere else; by Created by, every move is Ani's — person 55 has no row.
func TestOrderMovesFold_EachMoveOnItsOwnDayUnderTheCreator(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newServiceWithFees(t, db, knownCosts(), &fakeFees{percent: 2.5})
	analytic := selling_v1.NewAnalytic(db, fakeTeamTypes{testWarehouse: true})
	orderID := pricedOrder(t, svc, insertShop(t, db, 2, "Shop", "S1", "shopee"))

	type move struct {
		from, to string
		day      int
	}

	for _, m := range []move{
		{"pending", "processed", 20}, {"processed", "picked", 21}, {"picked", "shipping", 21},
		{"shipping", "shipped", 22}, {"shipped", "completed", 25},
	} {
		at := moveDay(m.day)
		logID := timelineMove(t, db, orderID, m.to, at)
		foldEvent(t, analytic, movedBy(orderID, logID, m.from, m.to, 55, at))
	}

	days := []string{"2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"}

	datas, err := metricData(analytic, 2, analytic_basev1.GroupType_GROUP_TYPE_DAILY,
		&analytic_basev1.MetricKeys{K: &analytic_basev1.MetricKeys_Days{Days: &analytic_basev1.DayList{Days: days}}},
		metricMoves)
	if err != nil {
		t.Fatalf("MetricData by day: %v", err)
	}

	byDay := datas[0].GetMovesByDay().GetItems()
	want := map[string]map[string]int64{
		"2026-10-20": {"confirmed_count": 1},
		"2026-10-21": {"picked_count": 1, "handed_over_count": 1},
		"2026-10-22": {"shipped_count": 1},
		"2026-10-23": {},
		"2026-10-24": {},
		"2026-10-25": {"completed_count": 1},
	}

	for _, day := range days {
		if byDay[day] == nil {
			t.Fatalf("day %s missing from %v — every asked day comes back", day, byDay)
		}

		wantMoves(t, "on "+day, byDay[day], want[day])
	}

	// BY CREATED BY: only the creator ranks; the crew member who made every move has no figure.
	ranked, err := metricSearch(analytic, 2, analytic_basev1.GroupType_GROUP_TYPE_USER, metricMoves, "confirmed_count")
	if err != nil {
		t.Fatalf("MetricSearch by user: %v", err)
	}

	if ids := ranked.GetKeys().GetIds().GetIds(); len(ids) != 1 || ids[0] != 7 {
		t.Fatalf("ranked creators %v, want [7] — the order's creator, never the crew (55)", ids)
	}

	people, err := metricData(analytic, 2, analytic_basev1.GroupType_GROUP_TYPE_USER,
		&analytic_basev1.MetricKeys{K: &analytic_basev1.MetricKeys_Ids{Ids: &analytic_basev1.IDList{Ids: []uint64{7, 55}}}},
		metricMoves)
	if err != nil {
		t.Fatalf("MetricData by user: %v", err)
	}

	items := people[0].GetMovesById().GetItems()
	wantMoves(t, "the creator", items[7], map[string]int64{
		"confirmed_count": 1, "picked_count": 1, "handed_over_count": 1, "shipped_count": 1, "completed_count": 1,
	})
	wantMoves(t, "the crew member", items[55], map[string]int64{})
}

// THE WAREHOUSE READS THE ORDERS IT SHIPS — EVERY COUNT (a-warehouse-reads-the-orders-it-ships,
// a-warehouse-sees-no-seller-money: none of these is money): Gudang 900 is given exactly the seller's figures and may
// rank by any of them; root reads them too; another seller and another warehouse are given nothing.
func TestOrderMovesData_EachReaderReadsItsOwn(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newServiceWithFees(t, db, knownCosts(), &fakeFees{percent: 2.5})
	const otherWarehouse = 901
	analytic := selling_v1.NewAnalytic(db, fakeTeamTypes{testWarehouse: true, otherWarehouse: true})
	orderID := pricedOrder(t, svc, insertShop(t, db, 2, "Shop", "S1", "shopee"))

	for i, to := range []string{"processed", "picked", "shipping", "shipped", "problem"} {
		at := moveDay(20 + i)
		foldEvent(t, analytic, movedBy(orderID, timelineMove(t, db, orderID, to, at), "", to, 55, at))
	}

	every := map[string]int64{
		"confirmed_count": 1, "picked_count": 1, "handed_over_count": 1, "shipped_count": 1, "problem_count": 1,
	}

	wantMoves(t, "the seller", movesSummary(t, analytic, 2), every)
	wantMoves(t, "the warehouse that ships it", movesSummary(t, analytic, testWarehouse), every)
	wantMoves(t, "root", movesSummary(t, analytic, san_auth.RootTeamID), every)
	wantMoves(t, "another seller", movesSummary(t, analytic, 3), map[string]int64{})
	wantMoves(t, "another warehouse", movesSummary(t, analytic, otherWarehouse), map[string]int64{})

	// The warehouse ranks its sellers by a count — nothing is refused, since nothing is money — and fills them.
	ranked, err := metricSearch(analytic, testWarehouse, analytic_basev1.GroupType_GROUP_TYPE_TEAM, metricMoves,
		"handed_over_count")
	if err != nil {
		t.Fatalf("the warehouse's search: %v", err)
	}

	if ids := ranked.GetKeys().GetIds().GetIds(); len(ids) != 1 || ids[0] != 2 {
		t.Fatalf("the warehouse's sellers %v, want [2]", ids)
	}

	datas, err := metricData(analytic, testWarehouse, analytic_basev1.GroupType_GROUP_TYPE_TEAM,
		&analytic_basev1.MetricKeys{K: &analytic_basev1.MetricKeys_Ids{Ids: &analytic_basev1.IDList{Ids: []uint64{2}}}},
		metricMoves)
	if err != nil {
		t.Fatalf("the warehouse's fill: %v", err)
	}

	wantMoves(t, "the warehouse's row for its seller", datas[0].GetMovesById().GetItems()[2], every)

	for _, team := range []uint64{3, otherWarehouse} {
		nothing, err := metricSearch(analytic, team, analytic_basev1.GroupType_GROUP_TYPE_TEAM, metricMoves, "confirmed_count")
		if err != nil {
			t.Fatalf("team %d's search: %v", team, err)
		}

		if ids := nothing.GetKeys().GetIds().GetIds(); len(ids) != 0 {
			t.Fatalf("team %d ranked %v, want nothing — not its orders", team, ids)
		}
	}
}

// THE HEADLINE IS THE SUM OF ITS ROWS (the-headline-is-the-sum-of-its-rows): three orders over two shops and two
// creators, their moves over three days. Grouped by every key the metric offers, each count summed over the rows the
// search lists equals the headline — so the search lists every key with ANY move, not only the sorted count's.
func TestOrderMovesData_TheHeadlineIsTheSumOfItsRows(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newServiceWithFees(t, db, knownCosts(), &fakeFees{percent: 2.5})
	analytic := selling_v1.NewAnalytic(db, fakeTeamTypes{testWarehouse: true})
	shopA := insertShop(t, db, 2, "Shop A", "SA", "shopee")
	shopB := insertShop(t, db, 2, "Shop B", "SB", "shopee")

	ani := pricedOrder(t, svc, shopA)
	budi, err := svc.OrderCreate(asUser(8), connect.NewRequest(feeOrderReq(shopB)))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	other := pricedOrder(t, svc, shopB)

	type move struct {
		order uint64
		to    string
		day   int
	}

	for _, m := range []move{
		{ani, "processed", 20}, {ani, "picked", 20}, {ani, "shipping", 21}, {ani, "shipped", 22}, {ani, "completed", 22},
		{budi.Msg.GetOrder().GetId(), "processed", 21}, {budi.Msg.GetOrder().GetId(), "pending", 21},
		{budi.Msg.GetOrder().GetId(), "processed", 22},
		// Only a completed on its day for this one — the search must still list the 22nd's shop and creator.
		{other, "completed", 22},
	} {
		at := moveDay(m.day)
		foldEvent(t, analytic, movedBy(m.order, timelineMove(t, db, m.order, m.to, at), "", m.to, 55, at))
	}

	headline := moveCounts(movesSummary(t, analytic, 2))
	if headline["confirmed_count"] != 3 || headline["completed_count"] != 2 || headline["back_to_pending_count"] != 1 {
		t.Fatalf("headline = %v, want 3 confirmed, 1 back to pending, 2 completed", headline)
	}

	for _, group := range []analytic_basev1.GroupType{
		analytic_basev1.GroupType_GROUP_TYPE_SHOP, analytic_basev1.GroupType_GROUP_TYPE_TEAM,
		analytic_basev1.GroupType_GROUP_TYPE_WAREHOUSE, analytic_basev1.GroupType_GROUP_TYPE_USER,
		analytic_basev1.GroupType_GROUP_TYPE_DAILY, analytic_basev1.GroupType_GROUP_TYPE_WEEKLY,
		analytic_basev1.GroupType_GROUP_TYPE_MONTHLY,
	} {
		// Ranked by the count the third order lacks on a day of its own, so a search reading only that count drops it.
		ranked, err := metricSearch(analytic, 2, group, metricMoves, "picked_count")
		if err != nil {
			t.Fatalf("%s search: %v", group, err)
		}

		datas, err := metricData(analytic, 2, group, ranked.GetKeys(), metricMoves)
		if err != nil {
			t.Fatalf("%s fill: %v", group, err)
		}

		rows := map[string]int64{}

		if byDay := datas[0].GetMovesByDay(); byDay != nil {
			for _, item := range byDay.GetItems() {
				for field, n := range moveCounts(item) {
					rows[field] += n
				}
			}
		}

		for _, item := range datas[0].GetMovesById().GetItems() {
			for field, n := range moveCounts(item) {
				rows[field] += n
			}
		}

		for _, field := range moveFields {
			if rows[field] != headline[field] {
				t.Fatalf("by %s: %s over the rows = %d, the headline %d — the rows do not add up (rows %v)",
					group, field, rows[field], headline[field], rows)
			}
		}
	}
}

// placementRowOn moves the order's placement — its row and its first timeline row, into pending — to `at`.
func placementRowOn(t *testing.T, db *gorm.DB, orderID uint64, at time.Time) {
	t.Helper()

	backdateOrder(t, db, orderID, at)

	err := db.Exec(`UPDATE order_timeline_logs SET created_at = ?
WHERE id = (SELECT MIN(id) FROM order_timeline_logs WHERE order_id = ? AND status = 'pending')`, at, orderID).Error
	if err != nil {
		t.Fatalf("backdate the placement row of %d: %v", orderID, err)
	}
}

// THE RE-FOLD REBUILDS THE MOVES AS THE FOLD WROTE THEM (a-wrong-day-is-refolded-from-the-log): one day of an order's
// whole way out, the placement's own pending row on that day too. Folded, wiped, two move events lost: the re-fold
// writes back exactly what the fold had, claims the two, and never counts the placement's row as a Back to pending; the
// late redeliveries fold nothing, and a second run rewrites nothing.
func TestOrderDayRefold_RebuildsTheMovesAsTheFoldWould(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newServiceWithFees(t, db, knownCosts(), &fakeFees{percent: 2.5})
	analytic := selling_v1.NewAnalytic(db, fakeTeamTypes{testWarehouse: true})
	orderID := pricedOrder(t, svc, insertShop(t, db, 2, "Shop", "S1", "shopee"))

	placementRowOn(t, db, orderID, wibOn(9, 0))
	foldEvent(t, analytic, placedEvent(orderID, wibOn(9, 0)))

	events := []*eventsv1.Event{}

	for i, to := range []string{"processed", "pending", "processed", "picked", "shipping", "shipped", "problem", "completed"} {
		at := wibOn(10+i, 0)
		event := movedBy(orderID, timelineMove(t, db, orderID, to, at), "", to, 55, at)
		events = append(events, event)
		foldEvent(t, analytic, event)
	}

	folded := dayFigures(t, db, 2, refoldDay)

	want := map[string]int64{
		"moves_confirmed": 2, "moves_back_to_pending": 1, "moves_picked": 1, "moves_handed_over": 1,
		"moves_shipped": 1, "moves_problem": 1, "moves_completed": 1,
	}

	for metric, n := range want {
		row := folded[metric+"/"+itoa(rowShop(t, db, orderID))+"/"+itoa(testWarehouse)+"/7"]
		if row.OrderCount != n || row.Total != 0 || row.MpTotal != 0 {
			t.Fatalf("%s = %+v, want %d moves and no money (all: %+v)", metric, row, n, folded)
		}
	}

	// THE DAMAGE: the day's rows gone, the back to pending's and the completed's events never claimed.
	err := db.Exec(`DELETE FROM order_daily_reports WHERE team_id = 2 AND day = CAST(? AS date)`, refoldDay).Error
	if err != nil {
		t.Fatal(err)
	}

	lost := []string{events[1].GetEventId(), events[7].GetEventId()}

	err = db.Exec(`DELETE FROM order_event_logs WHERE id IN ?`, lost).Error
	if err != nil {
		t.Fatal(err)
	}

	result := refoldOrders(t, analytic, 2, refoldDay, false)

	// The placement and the eight moves — the placement's pending row is no move.
	if result.Claimed != 2 || result.Counted != 9 || result.InFlight != 0 {
		t.Fatalf("result = counted %d claimed %d in flight %d, want 9 counted, the 2 lost claimed",
			result.Counted, result.Claimed, result.InFlight)
	}

	wantFigures(t, "the re-folded day", dayFigures(t, db, 2, refoldDay), folded)

	for _, id := range lost {
		if !claimed(t, db, id) {
			t.Fatalf("%s is not claimed — a redelivery would count it twice", id)
		}
	}

	foldEvent(t, analytic, events[1])
	foldEvent(t, analytic, events[7])
	wantFigures(t, "after the late redeliveries", dayFigures(t, db, 2, refoldDay), folded)

	versions := dayVersions(t, db, 2, refoldDay)

	second := refoldOrders(t, analytic, 2, refoldDay, false)
	if second.Changed() || second.Claimed != 0 {
		t.Fatalf("a second run changed %v, claimed %d — want nothing", second.Changed(), second.Claimed)
	}

	for key, v := range dayVersions(t, db, 2, refoldDay) {
		if versions[key] != v {
			t.Fatalf("row %s was rewritten by a run that changed nothing", key)
		}
	}
}

// rowShop is the order's shop now.
func rowShop(t *testing.T, db *gorm.DB, orderID uint64) uint64 {
	t.Helper()

	var order selling_service_models.Order

	err := db.Select("shop_id").Where("id = ?", orderID).Take(&order).Error
	if err != nil {
		t.Fatalf("the order's shop: %v", err)
	}

	return order.ShopID
}

// A SHOP FIX CARRIES THE MOVES (an-orders-shop-is-fixed-and-counted-on-the-day): the order was confirmed, picked and
// handed over under the wrong shop on 20–21 Oct. The fix, today, takes each of those counts off the old shop and onto
// the new — −1 / +1, no money — beside the placement's; the past days read as before, and the re-fold of every day
// rewrites nothing.
func TestOrderMetricFold_AShopFixCarriesTheMoves(t *testing.T) {
	db := san_testdb.DB(t)
	rec := &moveRecorder{}
	svc := selling_v1.NewService(db, knownCosts(), rec.send, &fakeCatalog{}, &fakeCredit{}, everyoneMayWrite{}, nil,
		&fakeFees{percent: 2.5}, nil, nil, nil)
	analytic := selling_v1.NewAnalytic(db, fakeTeamTypes{testWarehouse: true})
	wrong := insertShop(t, db, 2, "Melati Official", "MO", "shopee")
	right := insertShop(t, db, 2, "Melati Store", "MS", "shopee")

	orderID := pricedOrder(t, svc, wrong)
	placementRowOn(t, db, orderID, moveDay(20))
	foldEvent(t, analytic, placedEvent(orderID, moveDay(20)))

	for _, m := range []struct {
		to  string
		day int
	}{{"processed", 20}, {"picked", 21}, {"shipping", 21}} {
		at := moveDay(m.day)
		foldEvent(t, analytic, movedBy(orderID, timelineMove(t, db, orderID, m.to, at), "", m.to, 55, at))
	}

	err := db.Exec(`UPDATE orders SET status = 'shipping' WHERE id = ?`, orderID).Error
	if err != nil {
		t.Fatalf("set shipping: %v", err)
	}

	before := map[string]map[string]selling_service_models.OrderMetricColumns{
		"2026-10-20": dayFigures(t, db, 2, "2026-10-20"),
		"2026-10-21": dayFigures(t, db, 2, "2026-10-21"),
	}

	_, err = fixShop(svc, asUser(7), 2, orderID, right)
	if err != nil {
		t.Fatalf("fix: %v", err)
	}

	foldEvent(t, analytic, rec.events[len(rec.events)-1])

	today := todayInJakarta()

	wantFigures(t, "the fix's day", dayFigures(t, db, 2, today), map[string]selling_service_models.OrderMetricColumns{
		key("created", wrong):           cols(-1, -14_350, -12_000),
		key("created", right):           cols(1, 14_350, 12_000),
		key("warehouse_fee", wrong):     cols(-1, -350, 0),
		key("warehouse_fee", right):     cols(1, 350, 0),
		key("moves_confirmed", wrong):   cols(-1, 0, 0),
		key("moves_confirmed", right):   cols(1, 0, 0),
		key("moves_picked", wrong):      cols(-1, 0, 0),
		key("moves_picked", right):      cols(1, 0, 0),
		key("moves_handed_over", wrong): cols(-1, 0, 0),
		key("moves_handed_over", right): cols(1, 0, 0),
	})

	for day, figures := range before {
		wantFigures(t, day+" after the fix", dayFigures(t, db, 2, day), figures)
	}

	for _, day := range []string{"2026-10-20", "2026-10-21", today} {
		folded := dayFigures(t, db, 2, day)

		result := refoldOrders(t, analytic, 2, day, false)
		if result.Changed() {
			t.Fatalf("re-fold of %s changed rows: %+v", day, result.Rows)
		}

		wantFigures(t, "re-folded "+day, dayFigures(t, db, 2, day), folded)
	}
}
