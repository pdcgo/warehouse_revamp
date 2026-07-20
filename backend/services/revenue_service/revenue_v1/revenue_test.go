package revenue_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	revenuev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/revenue/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
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
