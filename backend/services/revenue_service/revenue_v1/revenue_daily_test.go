package revenue_v1_test

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"

	revenuev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/revenue/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	revenue_v1 "github.com/pdcgo/warehouse_revamp/backend/services/revenue_service/revenue_v1"
)

func daily(
	t *testing.T,
	svc *revenue_v1.Service,
	from, to string,
) *revenuev1.RevenueDailyResponse {
	t.Helper()

	res, err := svc.RevenueDaily(context.Background(), connect.NewRequest(&revenuev1.RevenueDailyRequest{
		TeamId: 2,
		Filter: &revenuev1.RevenueDailyFilter{From: from, To: to},
	}))
	if err != nil {
		t.Fatalf("RevenueDaily(%s..%s): %v", from, to, err)
	}

	return res.Msg
}

// The daily statement's revenue half: one row per day that HAS orders, ascending, and a footer that is
// the sum of exactly those rows.
//
// The sparseness is asserted rather than assumed. A dense series would be a defensible design too, but
// the client builds the date spine (it has to, to merge these days with the expense service's), so a
// server that ALSO emitted empty days would be a second calendar free to disagree with it.
func TestRevenueDaily_GroupsByDayAscendingAndSkipsEmptyDays(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	utc := time.UTC

	// Two orders on the 3rd, one on the 5th. Nothing at all on the 4th.
	seedOn(t, db, svc, 1, 10_000, time.Date(2026, 7, 3, 9, 0, 0, 0, utc))
	seedOn(t, db, svc, 2, 25_000, time.Date(2026, 7, 3, 18, 30, 0, 0, utc))
	seedOn(t, db, svc, 3, 40_000, time.Date(2026, 7, 5, 11, 0, 0, 0, utc))
	// OUTSIDE the period — June must not appear at all.
	seedOn(t, db, svc, 4, 99_000, time.Date(2026, 6, 30, 9, 0, 0, 0, utc))

	got := daily(t, svc, "2026-07-01", "2026-07-31")

	days := got.GetDays()
	if len(days) != 2 {
		t.Fatalf("got %d day rows, want 2 — the 4th has no orders and must be ABSENT, not a zero row: %+v", len(days), days)
	}

	if days[0].GetDate() != "2026-07-03" || days[1].GetDate() != "2026-07-05" {
		t.Fatalf("days are %s, %s — want 2026-07-03 then 2026-07-05 (ascending)", days[0].GetDate(), days[1].GetDate())
	}

	// The 3rd holds BOTH of its orders, summed — not one row per order wearing a date.
	if n := days[0].GetOrders(); n != 2 {
		t.Fatalf("the 3rd holds %d orders, want 2", n)
	}
	if got := days[0].GetRevenue(); got != 35_000 {
		t.Fatalf("the 3rd's revenue = %d, want 35000 (10.000 + 25.000)", got)
	}
	if got := days[1].GetRevenue(); got != 40_000 {
		t.Fatalf("the 5th's revenue = %d, want 40000", got)
	}

	// THE FOOTER IS THE SUM OF THE ROWS. If these two ever disagree the screen shows a total that
	// contradicts the table directly above it, which is the one failure a statement cannot survive.
	var summed int64
	for _, d := range days {
		summed += d.GetRevenue()
	}

	if got := got.GetTotals().GetRevenue(); got != summed {
		t.Fatalf("totals.revenue = %d but the days sum to %d", got, summed)
	}
	if got := got.GetTotals().GetRevenue(); got != 75_000 {
		t.Fatalf("period revenue = %d, want 75000 — June must not count", got)
	}
}

// #164 — a cancelled order earned nothing, so it must not put a number on a day.
//
// The list screen still SHOWS a voided row; a daily series is only ever read as money, so it excludes
// them — exactly as the period totals already do. The interesting case is a day whose only order was
// voided: that day must vanish from the series rather than appear as a zero, or the statement would
// show a trading day that did not happen.
func TestRevenueDaily_VoidedOrdersLeaveNoTraceOnTheDay(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	utc := time.UTC

	seedOn(t, db, svc, 1, 10_000, time.Date(2026, 7, 3, 9, 0, 0, 0, utc))
	// The 4th's ONLY order, and it gets cancelled.
	seedOn(t, db, svc, 2, 80_000, time.Date(2026, 7, 4, 9, 0, 0, 0, utc))

	_, err := svc.RevenueVoid(context.Background(), connect.NewRequest(&revenuev1.RevenueVoidRequest{
		TeamId: 2, OrderId: 2,
	}))
	if err != nil {
		t.Fatalf("RevenueVoid: %v", err)
	}

	got := daily(t, svc, "2026-07-01", "2026-07-31")

	days := got.GetDays()
	if len(days) != 1 {
		t.Fatalf("got %d day rows, want 1 — the 4th's only order was voided, so the day is not a trading day: %+v", len(days), days)
	}

	if days[0].GetDate() != "2026-07-03" || days[0].GetRevenue() != 10_000 {
		t.Fatalf("surviving day is %s / %d, want 2026-07-03 / 10000", days[0].GetDate(), days[0].GetRevenue())
	}
}

// #74 — a day's UNKNOWN-COST orders are counted per day, not only per period.
//
// 0 cogs means the cost was unknown, not free, so those rows' margin reads as pure profit. A monthly
// count hides which day it happened on, and "which day did the margin jump" is the question this whole
// screen exists to answer.
func TestRevenueDaily_CountsUnknownCostOrdersPerDay(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	ctx := context.Background()

	_, err := svc.RevenueRecord(ctx, connect.NewRequest(&revenuev1.RevenueRecordRequest{
		TeamId: 2, OrderId: 1, Revenue: 30_000, Cogs: 0, ShippingCost: 0, CostKnown: false,
	}))
	if err != nil {
		t.Fatalf("record the unknown-cost order: %v", err)
	}

	_, err = svc.RevenueRecord(ctx, connect.NewRequest(&revenuev1.RevenueRecordRequest{
		TeamId: 2, OrderId: 2, Revenue: 30_000, Cogs: 12_000, ShippingCost: 0, CostKnown: true,
	}))
	if err != nil {
		t.Fatalf("record the known-cost order: %v", err)
	}

	// Both land on today, which is what RevenueRecord stamps.
	today := time.Now().UTC().Format("2006-01-02")

	got := daily(t, svc, today, today)

	days := got.GetDays()
	if len(days) != 1 {
		t.Fatalf("got %d day rows, want 1 (both orders are today): %+v", len(days), days)
	}

	if n := days[0].GetOrders(); n != 2 {
		t.Fatalf("today holds %d orders, want 2", n)
	}
	if n := days[0].GetUnknownCostOrders(); n != 1 {
		t.Fatalf("today's unknown-cost orders = %d, want 1 — one of the two had no recorded cost", n)
	}
}

// The last day of the period counts IN FULL, and the day after it does not.
//
// Same trap RevenueList's period filter exists around: `created_at` is a TIMESTAMPTZ, so a `<= to` bound
// would mean `<= midnight` and silently drop almost the whole final day. Worth re-proving here rather
// than trusting the list's test, because this handler writes its own bound (both ends are required, so
// there was nothing conditional left for `withPeriod` to do) — and a second copy of a subtle bound is
// exactly the kind of thing that gets the subtlety wrong.
func TestRevenueDaily_TheLastDayOfThePeriodCountsInFull(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	// Late on the final day — the row a `<= to` bound would lose.
	seedOn(t, db, svc, 1, 50_000, time.Date(2026, 7, 31, 23, 30, 0, 0, time.UTC))
	// And the first moment of the next day, which must NOT count.
	seedOn(t, db, svc, 2, 7_000, time.Date(2026, 8, 1, 0, 5, 0, 0, time.UTC))

	got := daily(t, svc, "2026-07-01", "2026-07-31")

	days := got.GetDays()
	if len(days) != 1 {
		t.Fatalf("got %d day rows, want 1 — only 31 July is in the period: %+v", len(days), days)
	}

	if days[0].GetDate() != "2026-07-31" || days[0].GetRevenue() != 50_000 {
		t.Fatalf("the last day reads %s / %d, want 2026-07-31 / 50000 — 23:30 must not be dropped", days[0].GetDate(), days[0].GetRevenue())
	}
}

// THE PERIOD IS THE PAGINATION (HARD RULE 9), so the bounds are required and the span is capped.
//
// Without the cap this RPC is an unbounded `repeated` wearing a date filter: "from 1970 to today" is a
// perfectly well-formed request for twenty thousand rows. The cap is what lets it have no page cursor.
func TestRevenueDaily_RefusesAnUnboundedOrOversizedPeriod(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	cases := []struct {
		name string
		from string
		to   string
	}{
		{"no bounds at all", "", ""},
		{"an open lower end", "", "2026-07-31"},
		{"an open upper end", "2026-07-01", ""},
		{"longer than a year", "2020-01-01", "2026-07-31"},
		{"the ends the wrong way round", "2026-07-31", "2026-07-01"},
		{"a date that is not a day", "2026-02-31", "2026-03-01"},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, err := svc.RevenueDaily(context.Background(), connect.NewRequest(&revenuev1.RevenueDailyRequest{
				TeamId: 2,
				Filter: &revenuev1.RevenueDailyFilter{From: tc.from, To: tc.to},
			}))
			if err == nil {
				t.Fatalf("RevenueDaily(%q..%q) succeeded — an unbounded series is the bug the cap exists to stop", tc.from, tc.to)
			}

			if code := connect.CodeOf(err); code != connect.CodeInvalidArgument {
				t.Fatalf("RevenueDaily(%q..%q) = %v, want InvalidArgument", tc.from, tc.to, code)
			}
		})
	}
}

// Exactly 366 days is ACCEPTED — the cap is inclusive, so a leap year is a whole year rather than a
// whole year minus a day. The off-by-one somebody hits once and never diagnoses.
func TestRevenueDaily_AcceptsAFullLeapYear(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	// 2028 is a leap year: 1 Jan to 31 Dec inclusive is 366 days.
	res, err := svc.RevenueDaily(context.Background(), connect.NewRequest(&revenuev1.RevenueDailyRequest{
		TeamId: 2,
		Filter: &revenuev1.RevenueDailyFilter{From: "2028-01-01", To: "2028-12-31"},
	}))
	if err != nil {
		t.Fatalf("a 366-day period was refused: %v", err)
	}

	// An empty team still gets a totals message, not nil — the screen renders zeroes, never blanks.
	if res.Msg.GetTotals() == nil {
		t.Fatal("totals is nil for a period with no orders")
	}
}
