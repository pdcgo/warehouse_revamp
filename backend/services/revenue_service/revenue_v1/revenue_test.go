package revenue_v1_test

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	revenuev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/revenue/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	revenue_v1 "github.com/pdcgo/warehouse_revamp/backend/services/revenue_service/revenue_v1"
)

// #75 — an order's expected margin is computed once and STORED, so #76 has a number to reconcile a
// real payout against.
func TestRevenueRecord_FreezesTheExpectedMargin(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := context.Background()

	const team, order uint64 = 2, 42

	rec, err := svc.RevenueRecord(ctx, connect.NewRequest(&revenuev1.RevenueRecordRequest{
		TeamId: team, OrderId: order,
		Revenue: 35000, Cogs: 18000, ShippingCost: 5000, CostKnown: true,
	}))
	if err != nil {
		t.Fatalf("record: %v", err)
	}

	// 35.000 − 18.000 − 5.000.
	if got := rec.Msg.GetRevenue().GetExpectedMargin(); got != 12000 {
		t.Fatalf("expected margin = %d, want 12000", got)
	}

	// Stored, not just echoed.
	lst, err := svc.RevenueList(ctx, connect.NewRequest(&revenuev1.RevenueListRequest{
		TeamId: team, Page: page1(),
	}))
	if err != nil {
		t.Fatalf("list: %v", err)
	}

	if len(lst.Msg.GetRevenues()) != 1 {
		t.Fatalf("list = %d rows, want 1", len(lst.Msg.GetRevenues()))
	}

	got := lst.Msg.GetRevenues()[0]
	if got.GetExpectedMargin() != 12000 || got.GetOrderId() != order || !got.GetCostKnown() {
		t.Fatalf("stored row wrong: %+v", got)
	}
}

// #75 — recording an order twice is refused. A duplicate would DOUBLE every total computed from this
// table, which is the kind of error that looks like good news.
func TestRevenueRecord_RefusesToRecordAnOrderTwice(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := context.Background()

	req := &revenuev1.RevenueRecordRequest{
		TeamId: 2, OrderId: 42, Revenue: 1000, Cogs: 400, ShippingCost: 100, CostKnown: true,
	}

	_, err := svc.RevenueRecord(ctx, connect.NewRequest(req))
	if err != nil {
		t.Fatalf("first record: %v", err)
	}

	// Counted BEFORE the duplicate is attempted, deliberately. san_testdb runs each test inside one
	// transaction, and a unique violation ABORTS it in Postgres — every later statement then fails with
	// 25P02 regardless of what the handler did. So a query after the violation would be testing the
	// harness, not the code. That no second row exists is what the unique index guarantees; what this
	// test can honestly prove is the CODE the caller sees.
	lst, err := svc.RevenueList(ctx, connect.NewRequest(&revenuev1.RevenueListRequest{
		TeamId: 2, Page: page1(),
	}))
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(lst.Msg.GetRevenues()) != 1 {
		t.Fatalf("list = %d rows, want 1 before the duplicate", len(lst.Msg.GetRevenues()))
	}

	_, err = svc.RevenueRecord(ctx, connect.NewRequest(req))
	if code := connect.CodeOf(err); code != connect.CodeAlreadyExists {
		t.Fatalf("second record = %v, want AlreadyExists", code)
	}
}

// #75/#74 — an UNKNOWN cost is recorded as such. 0 is a legitimate cost as well as the unknown marker,
// so without the flag a margin over an unknown cost would read as pure profit and nothing would say so.
func TestRevenueRecord_MarksAnUnknownCost(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := context.Background()

	rec, err := svc.RevenueRecord(ctx, connect.NewRequest(&revenuev1.RevenueRecordRequest{
		TeamId: 2, OrderId: 43,
		Revenue: 10000, Cogs: 0, ShippingCost: 0, CostKnown: false,
	}))
	if err != nil {
		t.Fatalf("record: %v", err)
	}

	got := rec.Msg.GetRevenue()
	if got.GetCostKnown() {
		t.Fatal("an unknown cost was recorded as known — the margin would read as pure profit")
	}
	// The margin is still computed and kept: refusing would leave the order with no revenue row at all,
	// which is a worse kind of missing than one flagged as untrustworthy.
	if got.GetExpectedMargin() != 10000 {
		t.Fatalf("margin = %d, want 10000 (kept, but flagged)", got.GetExpectedMargin())
	}
}

// #75 — this is the money: one team must never read another's margins.
func TestRevenueList_ScopedToItsTeam(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := context.Background()

	_, err := svc.RevenueRecord(ctx, connect.NewRequest(&revenuev1.RevenueRecordRequest{
		TeamId: 2, OrderId: 44, Revenue: 9000, Cogs: 3000, ShippingCost: 0, CostKnown: true,
	}))
	if err != nil {
		t.Fatalf("record: %v", err)
	}

	lst, err := svc.RevenueList(ctx, connect.NewRequest(&revenuev1.RevenueListRequest{
		TeamId: 3, Page: page1(),
	}))
	if err != nil {
		t.Fatalf("list: %v", err)
	}

	if len(lst.Msg.GetRevenues()) != 0 {
		t.Fatalf("another team's margins leaked: %+v", lst.Msg.GetRevenues())
	}
}

// #78 — the totals are over the WHOLE TEAM, not the loaded page.
//
// This is the assertion that matters for a report: a page total is a different number wearing the same
// label. It would change with the page size and be wrong in a way no reader could see, so the test asks
// for a page SMALLER than the data and insists the totals ignore it.
func TestRevenueList_TotalsCoverEveryOrderNotThePage(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := context.Background()

	const team uint64 = 2

	record := func(orderID uint64, revenue, cogs, shipping int64, costKnown bool) {
		t.Helper()

		_, err := svc.RevenueRecord(ctx, connect.NewRequest(&revenuev1.RevenueRecordRequest{
			TeamId: team, OrderId: orderID,
			Revenue: revenue, Cogs: cogs, ShippingCost: shipping, CostKnown: costKnown,
		}))
		if err != nil {
			t.Fatalf("record order %d: %v", orderID, err)
		}
	}

	record(1, 10000, 4000, 1000, true) // margin 5000
	record(2, 20000, 9000, 2000, true) // margin 9000
	record(3, 30000, 0, 3000, false)   // margin 27000, but the cost is UNKNOWN

	// Another team's money must not leak into these figures — the one leak that would matter most.
	_, err := svc.RevenueRecord(ctx, connect.NewRequest(&revenuev1.RevenueRecordRequest{
		TeamId: 3, OrderId: 99,
		Revenue: 999999, Cogs: 1, ShippingCost: 1, CostKnown: true,
	}))
	if err != nil {
		t.Fatalf("other team record: %v", err)
	}

	// ONE row per page — so a page-derived total could only ever be a third of the truth.
	lst, err := svc.RevenueList(ctx, connect.NewRequest(&revenuev1.RevenueListRequest{
		TeamId: team,
		Page:   &commonv1.PageFilter{Page: 1, Limit: 1},
	}))
	if err != nil {
		t.Fatalf("list: %v", err)
	}

	if len(lst.Msg.GetRevenues()) != 1 {
		t.Fatalf("the page holds %d rows, want 1 — the rest of this test assumes a partial page",
			len(lst.Msg.GetRevenues()))
	}

	totals := lst.Msg.GetTotals()

	if got := totals.GetRevenue(); got != 60000 {
		t.Fatalf("total revenue = %d, want 60000 (all three orders, not the one on this page)", got)
	}
	if got := totals.GetCogs(); got != 13000 {
		t.Fatalf("total cogs = %d, want 13000", got)
	}
	if got := totals.GetShippingCost(); got != 6000 {
		t.Fatalf("total shipping = %d, want 6000", got)
	}
	if got := totals.GetExpectedMargin(); got != 41000 {
		t.Fatalf("total margin = %d, want 41000", got)
	}

	// And the reader is told how much of that margin rests on an unknown cost — order 3's 27.000 of it.
	if got := totals.GetUnknownCostOrders(); got != 1 {
		t.Fatalf("unknown-cost orders = %d, want 1", got)
	}
}

// #78 — a team with no orders reads as zero, not as an error. SUM over no rows is NULL in SQL, which is
// exactly the shape that would otherwise fail to scan on a brand-new team's very first visit.
func TestRevenueList_ATeamWithNoOrdersTotalsZero(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	lst, err := svc.RevenueList(context.Background(), connect.NewRequest(&revenuev1.RevenueListRequest{
		TeamId: 4242, Page: page1(),
	}))
	if err != nil {
		t.Fatalf("a team with no orders must not error: %v", err)
	}

	totals := lst.Msg.GetTotals()
	if totals == nil {
		t.Fatal("totals is nil for an empty team — the screen would render blanks, not zeroes")
	}

	if totals.GetRevenue() != 0 || totals.GetExpectedMargin() != 0 || totals.GetUnknownCostOrders() != 0 {
		t.Fatalf("an empty team's totals are not zero: %+v", totals)
	}
}

// seedOn records a revenue row and back-dates it, because `created_at` is set by the database and the
// period filter reads exactly that column.
func seedOn(t *testing.T, db *gorm.DB, svc *revenue_v1.Service, orderID uint64, amount int64, at time.Time) {
	t.Helper()

	_, err := svc.RevenueRecord(context.Background(), connect.NewRequest(&revenuev1.RevenueRecordRequest{
		TeamId: 2, OrderId: orderID,
		Revenue: amount, Cogs: 0, ShippingCost: 0, CostKnown: true,
	}))
	if err != nil {
		t.Fatalf("record order %d: %v", orderID, err)
	}

	err = db.Exec(`UPDATE order_revenues SET created_at = ? WHERE order_id = ?`, at, orderID).Error
	if err != nil {
		t.Fatalf("backdate order %d: %v", orderID, err)
	}
}

// #171 — THE PERIOD FILTER, and the totals that respect it.
//
// Without this the profit screen (#172) would subtract one month of costs from ALL-TIME revenue and
// print a number that is not profit and never was. The page is deliberately smaller than the period,
// so a total computed from the loaded rows could only ever be a fraction of the truth.
func TestRevenueList_FiltersByPeriodAndTotalsTheWholeOfIt(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	utc := time.UTC

	seedOn(t, db, svc, 1, 10_000, time.Date(2026, 7, 3, 9, 0, 0, 0, utc))
	seedOn(t, db, svc, 2, 20_000, time.Date(2026, 7, 20, 9, 0, 0, 0, utc))
	// OUTSIDE the period — June must not count.
	seedOn(t, db, svc, 3, 99_000, time.Date(2026, 6, 30, 9, 0, 0, 0, utc))

	res, err := svc.RevenueList(context.Background(), connect.NewRequest(&revenuev1.RevenueListRequest{
		TeamId: 2,
		From:   "2026-07-01",
		To:     "2026-07-31",
		// ONE row per page.
		Page: &commonv1.PageFilter{Page: 1, Limit: 1},
	}))
	if err != nil {
		t.Fatalf("RevenueList: %v", err)
	}

	if n := len(res.Msg.GetRevenues()); n != 1 {
		t.Fatalf("the page holds %d rows, want 1 — the rest of this test assumes a partial page", n)
	}
	if n := res.Msg.GetPageInfo().GetTotalItems(); n != 2 {
		t.Fatalf("total items = %d, want 2 (July only)", n)
	}

	// 10.000 + 20.000. June's 99.000 leaking in would read 129.000.
	if got := res.Msg.GetTotals().GetRevenue(); got != 30_000 {
		t.Fatalf("period revenue = %d, want 30000 — June must not count", got)
	}
}

// #171 — THE LAST DAY OF THE PERIOD COUNTS IN FULL, and this is the trap the filter exists around.
//
// `created_at` is a TIMESTAMPTZ, not a DATE like expense_records.occurred_at. So `created_at <= to` means
// `<= midnight`, which silently drops almost the whole last day of every month — a filter that looks
// right and quietly under-reports. The handler uses a half-open `< to + 1 day` instead, and this is
// what proves it.
func TestRevenueList_TheLastDayOfThePeriodCountsInFull(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	// Late on the final day — the row a `<= to` bound would lose.
	seedOn(t, db, svc, 1, 50_000, time.Date(2026, 7, 31, 23, 30, 0, 0, time.UTC))
	// And the first moment of the next day, which must NOT count.
	seedOn(t, db, svc, 2, 7_000, time.Date(2026, 8, 1, 0, 5, 0, 0, time.UTC))

	res, err := svc.RevenueList(context.Background(), connect.NewRequest(&revenuev1.RevenueListRequest{
		TeamId: 2, From: "2026-07-01", To: "2026-07-31", Page: page1(),
	}))
	if err != nil {
		t.Fatalf("RevenueList: %v", err)
	}

	if got := res.Msg.GetTotals().GetRevenue(); got != 50_000 {
		t.Fatalf("period revenue = %d, want 50000 — an order at 23:30 on the last day belongs to the "+
			"period, and one at 00:05 the next day does not", got)
	}
}

// #171 — no period means every order ever. The filter must not become a requirement, or every existing
// caller breaks.
func TestRevenueList_NoPeriodMeansEverything(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	seedOn(t, db, svc, 1, 10_000, time.Date(2026, 7, 3, 9, 0, 0, 0, time.UTC))
	seedOn(t, db, svc, 2, 20_000, time.Date(2020, 1, 1, 9, 0, 0, 0, time.UTC))

	res, err := svc.RevenueList(context.Background(), connect.NewRequest(&revenuev1.RevenueListRequest{
		TeamId: 2, Page: page1(),
	}))
	if err != nil {
		t.Fatalf("RevenueList: %v", err)
	}

	if got := res.Msg.GetTotals().GetRevenue(); got != 30_000 {
		t.Fatalf("unfiltered revenue = %d, want 30000", got)
	}
}
