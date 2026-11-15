package expense_v1_test

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"

	analytic_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/analytic_base/v1"
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
		t.Fatalf("the 3rd's total = %v, want 14000000 (2m ads + 12m payroll)", got)
	}

	byKind := days[0].GetByKind()
	if got := byKind[int32(expensev1.ExpenseKind_EXPENSE_KIND_ADS)]; got != 2_000_000 {
		t.Fatalf("the 3rd's ads = %v, want 2000000", got)
	}
	if got := byKind[int32(expensev1.ExpenseKind_EXPENSE_KIND_PAYROLL)]; got != 12_000_000 {
		t.Fatalf("the 3rd's payroll = %v, want 12000000", got)
	}

	// A kind with nothing that day is ABSENT rather than 0 — the same choice ExpenseTotals makes.
	if _, present := byKind[int32(expensev1.ExpenseKind_EXPENSE_KIND_OPERATIONAL)]; present {
		t.Fatalf("the 3rd carries an OPERATIONAL entry it never had: %+v", byKind)
	}

	// THE FOOTER IS THE SUM OF THE ROWS. A statement whose total contradicts the table above it is
	// unreadable, so this is asserted rather than assumed to follow from both being "the same filter".
	var summed float64
	for _, d := range days {
		summed += d.GetTotal()
	}

	if got := got.GetTotals().GetTotal(); got != summed {
		t.Fatalf("totals.total = %v but the days sum to %v", got, summed)
	}
	if got := got.GetTotals().GetTotal(); got != 15_000_000 {
		t.Fatalf("period total = %v, want 15000000 — June must not count", got)
	}
}

// A CANCELLED expense's day reads 0, made of two rows — the mistake and its correction, both counted, neither hidden
// (every-correction-is-a-signed-adjustment). The day does not vanish: something WAS entered on it and taken back, and
// its two entries say so, which an absent day could not.
func TestExpenseDaily_ACancelledExpenseLeavesItsDayAtZero(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	record(t, svc, expensev1.ExpenseKind_EXPENSE_KIND_ADS, 2_000_000, "2026-07-03")
	// The 4th's ONLY entry, and it was a mistake — Batalkan writes minus the whole of it.
	mistake := record(t, svc, expensev1.ExpenseKind_EXPENSE_KIND_OTHER, 9_000_000, "2026-07-04")
	adjust(t, svc, mistake.GetId(), -9_000_000)

	got := daily(t, svc, period("2026-07-01", "2026-07-31"))

	days := got.GetDays()
	if len(days) != 2 {
		t.Fatalf("got %d day rows, want 2 — the 4th keeps its two entries: %+v", len(days), days)
	}

	if days[1].GetDate() != "2026-07-04" || days[1].GetTotal() != 0 || days[1].GetEntries() != 2 {
		t.Fatalf("the 4th is %s / %v / %v entries, want 2026-07-04 / 0 / 2",
			days[1].GetDate(), days[1].GetTotal(), days[1].GetEntries())
	}

	if total := got.GetTotals().GetTotal(); total != 2_000_000 {
		t.Fatalf("the month's total = %v, want 2.000.000 — the cancelled 9.000.000 counts for nothing", total)
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
		t.Fatalf("the ads-only day reads %s / %v, want 2026-07-03 / 2000000", days[0].GetDate(), days[0].GetTotal())
	}

	if got := got.GetTotals().GetTotal(); got != 2_000_000 {
		t.Fatalf("filtered total = %v, want 2000000 — payroll must not count in an ads-filtered footer", got)
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
		t.Fatalf("team %v sees a total of %v from team %v's money", otherTeam, got, teamA)
	}
}

func dailyAt(
	t *testing.T,
	svc *expense_v1.Service,
	filter *expensev1.ExpenseDailyFilter,
	grain analytic_basev1.GroupType,
) *expensev1.ExpenseDailyResponse {
	t.Helper()

	res, err := svc.ExpenseDaily(context.Background(), connect.NewRequest(&expensev1.ExpenseDailyRequest{
		TeamId:  teamA,
		Filter:  filter,
		GroupBy: grain,
	}))
	if err != nil {
		t.Fatalf("ExpenseDaily(%s..%s, %s): %v", filter.GetFrom(), filter.GetTo(), grain, err)
	}

	return res.Msg
}

// rollUp sums DAY rows into the buckets `keyOf` names — the rollup the browser used to do, kept here only as the
// yardstick the server's grouping is measured against.
func rollUp(days []*expensev1.ExpenseDayItem, keyOf func(date string) string) []*expensev1.ExpenseDayItem {
	out := []*expensev1.ExpenseDayItem{}

	for _, d := range days {
		key := keyOf(d.GetDate())

		if len(out) == 0 || out[len(out)-1].GetDate() != key {
			out = append(out, &expensev1.ExpenseDayItem{Date: key, ByKind: map[int32]float64{}})
		}

		b := out[len(out)-1]
		b.Entries += d.GetEntries()
		b.Total += d.GetTotal()

		for kind, amount := range d.GetByKind() {
			b.ByKind[kind] += amount
		}
	}

	return out
}

func monthOf(date string) string { return date[:7] + "-01" }
func yearOf(date string) string  { return date[:4] + "-01-01" }

func sameBuckets(t *testing.T, grain string, got, want []*expensev1.ExpenseDayItem) {
	t.Helper()

	if len(got) != len(want) {
		t.Fatalf("%s: %d rows, want %d — got %+v", grain, len(got), len(want), got)
	}

	for i := range want {
		g, w := got[i], want[i]

		// Exact: every figure here is a whole number of rupiah, so the database's sum and the sum of its days are the
		// same double.
		if g.GetDate() != w.GetDate() || g.GetEntries() != w.GetEntries() || g.GetTotal() != w.GetTotal() ||
			len(g.GetByKind()) != len(w.GetByKind()) {
			t.Fatalf("%s row %d = %s / %d entries / %v %v — the days sum to %s / %d / %v %v",
				grain, i, g.GetDate(), g.GetEntries(), g.GetTotal(), g.GetByKind(),
				w.GetDate(), w.GetEntries(), w.GetTotal(), w.GetByKind())
		}

		for kind, amount := range w.GetByKind() {
			if g.GetByKind()[kind] != amount {
				t.Fatalf("%s row %s kind %d = %v, the days sum to %v", grain, g.GetDate(), kind, g.GetByKind()[kind], amount)
			}
		}
	}
}

// THE SERVER GROUPS (periods-are-grouped-on-the-server): a month's row and a year's row are EXACTLY the sum of their
// day rows — entries, total and every kind — over a period that starts late in December, crosses a month AND a year
// boundary and ends on the 1st of February, so both edge buckets are partial. The Jakarta-midnight edge is the
// write-off's: a clock at 00:30 WIB on 1 January (17:30 UTC on the 31st) dates its expense 1 January, so it lands in
// January and in 2026; 23:59 WIB on the 31st stays in December and in 2025.
func TestExpenseDaily_AMonthsAndAYearsRowAreTheSumOfTheirDays(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	// OUTSIDE the period on both sides — neither partial bucket may take them.
	record(t, svc, expensev1.ExpenseKind_EXPENSE_KIND_PAYROLL, 7_000_000, "2025-12-29")
	record(t, svc, expensev1.ExpenseKind_EXPENSE_KIND_PAYROLL, 8_000_000, "2026-02-02")

	record(t, svc, expensev1.ExpenseKind_EXPENSE_KIND_ADS, 1_000_000, "2025-12-30")
	record(t, svc, expensev1.ExpenseKind_EXPENSE_KIND_PAYROLL, 12_000_000, "2025-12-31")
	// A mistake on the 31st and its correction — the correction counts on the mistake's day, with its sign.
	mistake := record(t, svc, expensev1.ExpenseKind_EXPENSE_KIND_OTHER, 900_000, "2025-12-31")
	adjust(t, svc, mistake.GetId(), -400_000)

	// The Jakarta-midnight edge, dated the way the stock-loss poster dates a clock.
	lastMinute := expense_v1.JakartaDay(time.Date(2025, 12, 31, 16, 59, 0, 0, time.UTC)) // 23:59 WIB, 31 Dec
	firstHalfHour := expense_v1.JakartaDay(time.Date(2025, 12, 31, 17, 30, 0, 0, time.UTC))
	if lastMinute != "2025-12-31" || firstHalfHour != "2026-01-01" {
		t.Fatalf("the Jakarta days are %s and %s", lastMinute, firstHalfHour)
	}
	record(t, svc, expensev1.ExpenseKind_EXPENSE_KIND_OPERATIONAL, 300_000, lastMinute)
	record(t, svc, expensev1.ExpenseKind_EXPENSE_KIND_OPERATIONAL, 500_000, firstHalfHour)

	record(t, svc, expensev1.ExpenseKind_EXPENSE_KIND_ADS, 2_000_000, "2026-01-15")
	record(t, svc, expensev1.ExpenseKind_EXPENSE_KIND_ADS, 250_000, "2026-01-31")
	record(t, svc, expensev1.ExpenseKind_EXPENSE_KIND_OTHER, 125_000, "2026-02-01")

	window := period("2025-12-30", "2026-02-01")

	days := dailyAt(t, svc, window, analytic_basev1.GroupType_GROUP_TYPE_DAILY)
	unset := daily(t, svc, window)
	months := dailyAt(t, svc, window, analytic_basev1.GroupType_GROUP_TYPE_MONTHLY)
	years := dailyAt(t, svc, window, analytic_basev1.GroupType_GROUP_TYPE_YEARLY)

	// No grain is the daily grain — the callers that send none get what they always got.
	sameBuckets(t, "unset", unset.GetDays(), days.GetDays())

	if n := len(days.GetDays()); n != 6 {
		t.Fatalf("%d day rows, want 6 (30 Dec, 31 Dec, 1 Jan, 15 Jan, 31 Jan, 1 Feb)", n)
	}

	sameBuckets(t, "monthly", months.GetDays(), rollUp(days.GetDays(), monthOf))
	sameBuckets(t, "yearly", years.GetDays(), rollUp(days.GetDays(), yearOf))

	// Each bucket is keyed by its FIRST calendar day, even where the period starts later in it.
	for i, want := range []string{"2025-12-01", "2026-01-01", "2026-02-01"} {
		if got := months.GetDays()[i].GetDate(); got != want {
			t.Fatalf("month %d is keyed %s, want %s", i, got, want)
		}
	}
	if y := years.GetDays(); y[0].GetDate() != "2025-01-01" || y[1].GetDate() != "2026-01-01" {
		t.Fatalf("years are keyed %s, %s", y[0].GetDate(), y[1].GetDate())
	}

	// The edge, in figures: December = 1.000.000 + 12.000.000 + 500.000 (900.000 − 400.000) + 300.000; January takes
	// the 00:30 WIB write-off.
	if got := months.GetDays()[0].GetTotal(); got != 13_800_000 {
		t.Fatalf("December = %v, want 13800000", got)
	}
	if got := months.GetDays()[1].GetTotal(); got != 2_750_000 {
		t.Fatalf("January = %v, want 2750000 (500.000 + 2.000.000 + 250.000)", got)
	}
	if got := years.GetDays()[1].GetTotal(); got != 2_875_000 {
		t.Fatalf("2026 = %v, want 2875000", got)
	}

	// One footer whatever the grain — the period's totals do not depend on how the rows are cut.
	for name, res := range map[string]*expensev1.ExpenseDailyResponse{"monthly": months, "yearly": years} {
		if res.GetTotals().GetTotal() != days.GetTotals().GetTotal() || res.GetTotals().GetTotal() != 16_675_000 {
			t.Fatalf("%s totals = %v, daily %v, want 16675000", name, res.GetTotals().GetTotal(), days.GetTotals().GetTotal())
		}
	}

	// The kind filter narrows the buckets exactly as it narrows the days.
	ads := period("2025-12-30", "2026-02-01")
	ads.Kind = expensev1.ExpenseKind_EXPENSE_KIND_ADS

	sameBuckets(t, "monthly ads",
		dailyAt(t, svc, ads, analytic_basev1.GroupType_GROUP_TYPE_MONTHLY).GetDays(),
		rollUp(dailyAt(t, svc, ads, analytic_basev1.GroupType_GROUP_TYPE_DAILY).GetDays(), monthOf))
}

// THE SPAN FOLLOWS THE GRAIN (periods-are-grouped-on-the-server): 366 days, 60 months, 20 years — three years read
// yearly is three rows and is answered, the same three years read daily are refused. A grain the statement has no
// rows for (a week) is refused, never read as days.
func TestExpenseDaily_TheSpanFollowsTheGrain(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	record(t, svc, expensev1.ExpenseKind_EXPENSE_KIND_ADS, 1_000_000, "2024-03-01")
	record(t, svc, expensev1.ExpenseKind_EXPENSE_KIND_ADS, 2_000_000, "2026-11-01")

	cases := []struct {
		name     string
		from, to string
		grain    analytic_basev1.GroupType
		refused  bool
	}{
		{"three years yearly", "2024-01-01", "2026-12-31", analytic_basev1.GroupType_GROUP_TYPE_YEARLY, false},
		{"three years daily", "2024-01-01", "2026-12-31", analytic_basev1.GroupType_GROUP_TYPE_DAILY, true},
		{"60 months", "2022-01-01", "2026-12-31", analytic_basev1.GroupType_GROUP_TYPE_MONTHLY, false},
		{"61 months", "2021-12-31", "2026-12-31", analytic_basev1.GroupType_GROUP_TYPE_MONTHLY, true},
		{"20 years", "2007-01-01", "2026-12-31", analytic_basev1.GroupType_GROUP_TYPE_YEARLY, false},
		{"21 years", "2006-12-31", "2026-12-31", analytic_basev1.GroupType_GROUP_TYPE_YEARLY, true},
		{"a week", "2026-11-01", "2026-11-30", analytic_basev1.GroupType_GROUP_TYPE_WEEKLY, true},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			res, err := svc.ExpenseDaily(context.Background(), connect.NewRequest(&expensev1.ExpenseDailyRequest{
				TeamId:  teamA,
				Filter:  period(tc.from, tc.to),
				GroupBy: tc.grain,
			}))

			if tc.refused {
				if connect.CodeOf(err) != connect.CodeInvalidArgument {
					t.Fatalf("%s..%s %s = %v, want InvalidArgument", tc.from, tc.to, tc.grain, err)
				}

				return
			}

			if err != nil {
				t.Fatalf("%s..%s %s: %v", tc.from, tc.to, tc.grain, err)
			}

			if tc.name == "three years yearly" {
				y := res.Msg.GetDays()
				if len(y) != 2 || y[0].GetDate() != "2024-01-01" || y[1].GetDate() != "2026-01-01" || y[1].GetTotal() != 2_000_000 {
					t.Fatalf("three years yearly = %+v, want 2024 and 2026 (2025 spent nothing, so it is absent)", y)
				}
			}
		})
	}
}
