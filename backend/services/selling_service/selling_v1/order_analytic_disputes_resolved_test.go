package selling_v1_test

import (
	"testing"

	analytic_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/analytic_base/v1"
	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// DISPUTES RESOLVED (the-order-status-moves-prototype-is-accepted, its 🔄 2026-11-20 line — the owner's checklist,
// analytic/order_metric.md given 14, *disputes resolved shown*): Order status moves' 8th count, the resolves alone — a
// move into completed straight from problem — counted BESIDE Completed, which keeps counting every resolve as accepted.

// A RESOLVE IS A COMPLETED AND A DISPUTE RESOLVED, ON ITS OWN DAY (a-fact-counts-on-the-day-it-happened): order A is a
// problem on 21 Oct and resolved on 23 Oct; order B goes shipped → completed on 23 Oct; order C is a problem on 22 Oct,
// gets a NOTE (no status) and is resolved on 24 Oct. By day, the 23rd reads 2 completed and 1 dispute resolved, the 24th
// 1 and 1 — the note between problem and completed changes nothing; B's completed is no resolve. Completed reads all
// three, exactly as before; no row carries money; a redelivery counts nothing.
func TestOrderMovesFold_AResolveCountsAsDisputesResolvedAndAsCompleted(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newServiceWithFees(t, db, knownCosts(), &fakeFees{percent: 2.5})
	analytic := selling_v1.NewAnalytic(db, fakeTeamTypes{testWarehouse: true})
	shop := insertShop(t, db, 2, "Shop", "S1", "shopee")

	a, b, c := pricedOrder(t, svc, shop), pricedOrder(t, svc, shop), pricedOrder(t, svc, shop)

	type move struct {
		order    uint64
		from, to string
		day      int
	}

	events := []*eventsv1.Event{}

	for _, m := range []move{
		{a, "shipping", "shipped", 20}, {a, "shipped", "problem", 21}, {a, "problem", "completed", 23},
		{b, "shipping", "shipped", 20}, {b, "shipped", "completed", 23},
		{c, "shipping", "shipped", 20}, {c, "shipped", "problem", 22}, {c, "problem", "completed", 24},
	} {
		if m.order == c && m.to == "completed" {
			// Customer service writes a note on the disputed order before resolving it — a row with no status.
			note := selling_service_models.OrderTimelineLog{OrderID: c, Note: "buyer agreed", From: "selling",
				CreatedAt: moveDay(23)}

			err := db.Create(&note).Error
			if err != nil {
				t.Fatalf("note: %v", err)
			}
		}

		at := moveDay(m.day)
		event := movedBy(m.order, timelineMove(t, db, m.order, m.to, at), m.from, m.to, 55, at)
		events = append(events, event)
		foldEvent(t, analytic, event)
	}

	days := []string{"2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24"}
	want := map[string]map[string]int64{
		"2026-10-20": {"shipped_count": 3},
		"2026-10-21": {"problem_count": 1},
		"2026-10-22": {"problem_count": 1},
		"2026-10-23": {"completed_count": 2, "disputes_resolved_count": 1},
		"2026-10-24": {"completed_count": 1, "disputes_resolved_count": 1},
	}

	check := func(label string) {
		t.Helper()

		datas, err := metricData(analytic, 2, analytic_basev1.GroupType_GROUP_TYPE_DAILY,
			&analytic_basev1.MetricKeys{K: &analytic_basev1.MetricKeys_Days{Days: &analytic_basev1.DayList{Days: days}}},
			metricMoves)
		if err != nil {
			t.Fatalf("%s: MetricData by day: %v", label, err)
		}

		for _, day := range days {
			wantMoves(t, label+" on "+day, datas[0].GetMovesByDay().GetItems()[day], want[day])
		}

		wantMoves(t, label+": the headline", movesSummary(t, analytic, 2), map[string]int64{
			"shipped_count": 3, "problem_count": 2, "completed_count": 3, "disputes_resolved_count": 2,
		})
	}

	check("folded")

	total, mp := movesMoney(t, db)
	if total != 0 || mp != 0 {
		t.Fatalf("the moves' rows hold total %v, mp_total %v — want none: the metric is counts only", total, mp)
	}

	for _, event := range events {
		foldEvent(t, analytic, event)
	}

	check("after the redeliveries")
}

// A SHOP FIX CARRIES A RESOLVE (an-orders-shop-is-fixed-and-counted-on-the-day): the order went the whole way under the
// wrong shop — shipped on 20 Oct, a problem on 21 Oct, resolved on 22 Oct. The fix, today, takes its Completed AND its
// Disputes resolved off the old shop and onto the new — −1 / +1 each, no money — beside every other count's; the past
// days read as before, and the re-fold of every day rewrites nothing.
func TestOrderMetricFold_AShopFixCarriesAResolve(t *testing.T) {
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
		from, to string
		day      int
	}{{"shipping", "shipped", 20}, {"shipped", "problem", 21}, {"problem", "completed", 22}} {
		at := moveDay(m.day)
		foldEvent(t, analytic, movedBy(orderID, timelineMove(t, db, orderID, m.to, at), m.from, m.to, 55, at))
	}

	err := db.Exec(`UPDATE orders SET status = 'completed' WHERE id = ?`, orderID).Error
	if err != nil {
		t.Fatalf("set completed: %v", err)
	}

	past := []string{"2026-10-20", "2026-10-21", "2026-10-22"}

	before := map[string]map[string]selling_service_models.OrderMetricColumns{}
	for _, day := range past {
		before[day] = dayFigures(t, db, 2, day)
	}

	if got := before["2026-10-22"][key("moves_disputes_resolved", wrong)]; got != cols(1, 0, 0) {
		t.Fatalf("the resolve's day holds %+v Disputes resolved under the old shop, want 1 (all: %+v)", got,
			before["2026-10-22"])
	}

	_, err = fixShop(svc, asUser(7), 2, orderID, right)
	if err != nil {
		t.Fatalf("fix: %v", err)
	}

	foldEvent(t, analytic, rec.events[len(rec.events)-1])

	today := todayInJakarta()

	wantFigures(t, "the fix's day", dayFigures(t, db, 2, today), map[string]selling_service_models.OrderMetricColumns{
		key("created", wrong):                 cols(-1, -14_350, -12_000),
		key("created", right):                 cols(1, 14_350, 12_000),
		key("warehouse_fee", wrong):           cols(-1, -350, 0),
		key("warehouse_fee", right):           cols(1, 350, 0),
		key("moves_shipped", wrong):           cols(-1, 0, 0),
		key("moves_shipped", right):           cols(1, 0, 0),
		key("moves_problem", wrong):           cols(-1, 0, 0),
		key("moves_problem", right):           cols(1, 0, 0),
		key("moves_completed", wrong):         cols(-1, 0, 0),
		key("moves_completed", right):         cols(1, 0, 0),
		key("moves_disputes_resolved", wrong): cols(-1, 0, 0),
		key("moves_disputes_resolved", right): cols(1, 0, 0),
	})

	for day, figures := range before {
		wantFigures(t, day+" after the fix", dayFigures(t, db, 2, day), figures)
	}

	for _, day := range append(past, today) {
		folded := dayFigures(t, db, 2, day)

		result := refoldOrders(t, analytic, 2, day, false)
		if result.Changed() {
			t.Fatalf("re-fold of %s changed rows: %+v", day, result.Rows)
		}

		wantFigures(t, "re-folded "+day, dayFigures(t, db, 2, day), folded)
	}
}
