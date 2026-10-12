package expense_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	expensev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/expense/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	expense_v1 "github.com/pdcgo/warehouse_revamp/backend/services/expense_service/expense_v1"
)

func daily(
	t *testing.T,
	svc *expense_v1.Service,
	filter *expensev1.ExpenseDailyFilter,
) *expensev1.ExpenseDailyResponse {
	t.Helper()

	res, err := svc.ExpenseDaily(context.Background(), connect.NewRequest(&expensev1.ExpenseDailyRequest{
		TeamId: teamA,
		Filter: filter,
	}))
	if err != nil {
		t.Fatalf("ExpenseDaily(%s..%s): %v", filter.GetFrom(), filter.GetTo(), err)
	}

	return res.Msg
}

func period(from, to string) *expensev1.ExpenseDailyFilter {
	return &expensev1.ExpenseDailyFilter{From: from, To: to}
}

// The daily statement's expense half: one row per day that HAS spending, ascending, with the day's
// kinds split out — and a footer that is the sum of exactly those rows.
//
// The per-kind split is the reason the query groups by (day, kind) and folds in Go rather than asking
// the database twice. A day that jumped should be readable without opening the expense list.
func TestExpenseDaily_GroupsByDayAscendingWithTheKindSplit(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	// Two kinds on the 3rd, one on the 5th, nothing on the 4th.
	record(t, svc, expensev1.ExpenseKind_EXPENSE_KIND_ADS, 2_000_000, "2026-07-03")
	record(t, svc, expensev1.ExpenseKind_EXPENSE_KIND_PAYROLL, 12_000_000, "2026-07-03")
	record(t, svc, expensev1.ExpenseKind_EXPENSE_KIND_ADS, 1_000_000, "2026-07-05")
	// OUTSIDE the period — June must not appear.
	record(t, svc, expensev1.ExpenseKind_EXPENSE_KIND_PAYROLL, 11_000_000, "2026-06-05")

	got := daily(t, svc, period("2026-07-01", "2026-07-31"))

	days := got.GetDays()
	if len(days) != 2 {
		t.Fatalf("got %d day rows, want 2 — nothing was spent on the 4th, so it must be ABSENT: %+v", len(days), days)
	}

	if days[0].GetDate() != "2026-07-03" || days[1].GetDate() != "2026-07-05" {
		t.Fatalf("days are %s, %s — want 2026-07-03 then 2026-07-05 (ascending)", days[0].GetDate(), days[1].GetDate())
	}

	// The 3rd is ONE row holding both kinds, not one row per kind wearing a date.
	if n := days[0].GetEntries(); n != 2 {
		t.Fatalf("the 3rd holds %d entries, want 2", n)
	}
	if got := days[0].GetTotal(); got != 14_000_000 {
		t.Fatalf("the 3rd's total = %d, want 14000000 (2m ads + 12m payroll)", got)
	}

	byKind := days[0].GetByKind()
	if got := byKind[int32(expensev1.ExpenseKind_EXPENSE_KIND_ADS)]; got != 2_000_000 {
		t.Fatalf("the 3rd's ads = %d, want 2000000", got)
	}
	if got := byKind[int32(expensev1.ExpenseKind_EXPENSE_KIND_PAYROLL)]; got != 12_000_000 {
		t.Fatalf("the 3rd's payroll = %d, want 12000000", got)
	}

	// A kind with nothing that day is ABSENT rather than 0 — the same choice ExpenseTotals makes.
	if _, present := byKind[int32(expensev1.ExpenseKind_EXPENSE_KIND_OPERATIONAL)]; present {
		t.Fatalf("the 3rd carries an OPERATIONAL entry it never had: %+v", byKind)
	}

	// THE FOOTER IS THE SUM OF THE ROWS. A statement whose total contradicts the table above it is
	// unreadable, so this is asserted rather than assumed to follow from both being "the same filter".
	var summed int64
	for _, d := range days {
		summed += d.GetTotal()
	}

	if got := got.GetTotals().GetTotal(); got != summed {
		t.Fatalf("totals.total = %d but the days sum to %d", got, summed)
	}
	if got := got.GetTotals().GetTotal(); got != 15_000_000 {
		t.Fatalf("period total = %d, want 15000000 — June must not count", got)
	}
}

// A voided expense leaves no trace on its day, exactly as it leaves none in the period totals.
//
// The list screen still shows it, struck through, because an entry made and then withdrawn is what
// somebody looking at a changed total wants to see. A daily series is only ever read as money, so a day
// whose only entry was voided must VANISH rather than read as a zero — a zero would assert somebody
// looked at that day and found nothing, which is a different claim.
func TestExpenseDaily_VoidedEntriesLeaveNoTraceOnTheDay(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	record(t, svc, expensev1.ExpenseKind_EXPENSE_KIND_ADS, 2_000_000, "2026-07-03")
	// The 4th's ONLY entry, and it was a mistake.
	mistake := record(t, svc, expensev1.ExpenseKind_EXPENSE_KIND_OTHER, 9_000_000, "2026-07-04")

	_, err := svc.ExpenseVoid(context.Background(), connect.NewRequest(&expensev1.ExpenseVoidRequest{
		TeamId: teamA, ExpenseId: mistake.GetId(),
	}))
	if err != nil {
		t.Fatalf("ExpenseVoid: %v", err)
	}

	got := daily(t, svc, period("2026-07-01", "2026-07-31"))

	days := got.GetDays()
	if len(days) != 1 {
		t.Fatalf("got %d day rows, want 1 — the 4th's only entry was voided: %+v", len(days), days)
	}

	if days[0].GetDate() != "2026-07-03" || days[0].GetTotal() != 2_000_000 {
		t.Fatalf("surviving day is %s / %d, want 2026-07-03 / 2000000", days[0].GetDate(), days[0].GetTotal())
	}
}

// The kind and shop filters narrow the DAYS as well as the footer.
//
// This is the failure worth guarding: a series filtered to Ads beside a total that still counted payroll
// would put a table and a footer describing different things on one screen. Both come from `filtered`,
// and this proves they still do.
func TestExpenseDaily_KindFilterNarrowsBothTheDaysAndTheTotals(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	record(t, svc, expensev1.ExpenseKind_EXPENSE_KIND_ADS, 2_000_000, "2026-07-03")
	record(t, svc, expensev1.ExpenseKind_EXPENSE_KIND_PAYROLL, 12_000_000, "2026-07-03")
	// A payroll-only day. Filtering to Ads must remove the DAY, not just its payroll number.
	record(t, svc, expensev1.ExpenseKind_EXPENSE_KIND_PAYROLL, 5_000_000, "2026-07-09")

	filter := period("2026-07-01", "2026-07-31")
	filter.Kind = expensev1.ExpenseKind_EXPENSE_KIND_ADS

	got := daily(t, svc, filter)

	days := got.GetDays()
	if len(days) != 1 {
		t.Fatalf("got %d day rows, want 1 — only the 3rd has ads: %+v", len(days), days)
	}

	if days[0].GetDate() != "2026-07-03" || days[0].GetTotal() != 2_000_000 {
		t.Fatalf("the ads-only day reads %s / %d, want 2026-07-03 / 2000000", days[0].GetDate(), days[0].GetTotal())
	}

	if got := got.GetTotals().GetTotal(); got != 2_000_000 {
		t.Fatalf("filtered total = %d, want 2000000 — payroll must not count in an ads-filtered footer", got)
	}
}

// THE PERIOD IS THE PAGINATION (HARD RULE 9) — the same cap RevenueDaily enforces, because the two
// series are read side by side and a cap that differed would let the statement load half a period and
// still look complete.
func TestExpenseDaily_RefusesAnUnboundedOrOversizedPeriod(t *testing.T) {
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
			_, err := svc.ExpenseDaily(context.Background(), connect.NewRequest(&expensev1.ExpenseDailyRequest{
				TeamId: teamA,
				Filter: period(tc.from, tc.to),
			}))
			if err == nil {
				t.Fatalf("ExpenseDaily(%q..%q) succeeded — an unbounded series is the bug the cap exists to stop", tc.from, tc.to)
			}

			if code := connect.CodeOf(err); code != connect.CodeInvalidArgument {
				t.Fatalf("ExpenseDaily(%q..%q) = %v, want InvalidArgument", tc.from, tc.to, code)
			}
		})
	}
}

// Exactly 366 days is ACCEPTED — the cap is inclusive, so a leap year is a whole year.
func TestExpenseDaily_AcceptsAFullLeapYear(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	res, err := svc.ExpenseDaily(context.Background(), connect.NewRequest(&expensev1.ExpenseDailyRequest{
		TeamId: teamA,
		Filter: period("2028-01-01", "2028-12-31"),
	}))
	if err != nil {
		t.Fatalf("a 366-day period was refused: %v", err)
	}

	// An empty period still gets a totals message, not nil — the screen renders zeroes, never blanks.
	if res.Msg.GetTotals() == nil {
		t.Fatal("totals is nil for a period with no expenses")
	}
}

// One team can never read another's daily series. The team_id clause IS the scope check, and it is the
// same clause `filtered` applies to the list — this proves the new RPC did not slip out from under it.
func TestExpenseDaily_NeverLeaksAnotherTeamsDays(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	record(t, svc, expensev1.ExpenseKind_EXPENSE_KIND_ADS, 2_000_000, "2026-07-03")

	const otherTeam uint64 = 99

	res, err := svc.ExpenseDaily(context.Background(), connect.NewRequest(&expensev1.ExpenseDailyRequest{
		TeamId: otherTeam,
		Filter: period("2026-07-01", "2026-07-31"),
	}))
	if err != nil {
		t.Fatalf("ExpenseDaily for the other team: %v", err)
	}

	if n := len(res.Msg.GetDays()); n != 0 {
		t.Fatalf("team %d sees %d of team %d's days", otherTeam, n, teamA)
	}
	if got := res.Msg.GetTotals().GetTotal(); got != 0 {
		t.Fatalf("team %d sees a total of %d from team %d's money", otherTeam, got, teamA)
	}
}
