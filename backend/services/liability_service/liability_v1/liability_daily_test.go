package liability_v1_test

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	analytic_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/analytic_base/v1"
	liabilityv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/liability/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	liability_v1 "github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_v1"
)

const (
	handlingFeeSource = int32(liabilityv1.LiabilitySourceType_LIABILITY_SOURCE_TYPE_ORDER_FEE)
	codFeeSource      = int32(liabilityv1.LiabilitySourceType_LIABILITY_SOURCE_TYPE_INCIDENTAL_FEE)
)

func daily(
	t *testing.T,
	svc *liability_v1.Service,
	teamID uint64,
	from, to string,
) *liabilityv1.LiabilityDailyResponse {
	t.Helper()

	res, err := svc.LiabilityDaily(context.Background(),
		connect.NewRequest(&liabilityv1.LiabilityDailyRequest{
			TeamId: teamID,
			Filter: &liabilityv1.LiabilityDailyFilter{From: from, To: to},
		}))
	if err != nil {
		t.Fatalf("LiabilityDaily(%d, %s..%s): %v", teamID, from, to, err)
	}

	return res.Msg
}

// handling posts a fee the SELLING team owes the WAREHOUSE — the warehouse's actual earnings.
func handling(amount float64, sourceID uint64) liability_v1.Posting {
	return liability_v1.Posting{
		DebtorTeamID:   selling,
		CreditorTeamID: warehouse,
		Amount:         amount,
		SourceType:     liability_v1.SourceTypeOrderFee,
		SourceID:       sourceID,
	}
}

// postOn writes a movement and back-dates BOTH ITS LEGS, because `created_at` is set by the database
// and the period filter reads exactly that column.
//
// Both legs, not one: a posting is two rows sharing a group, and back-dating only the creditor's would
// leave the pair straddling two days — which no real posting can do, so a test built that way would be
// proving something about data the system cannot produce.
func postOn(
	t *testing.T,
	db *gorm.DB,
	svc *liability_v1.Service,
	p liability_v1.Posting,
	at time.Time,
) {
	t.Helper()

	group, err := svc.PostEntry(context.Background(), db, p)
	if err != nil {
		t.Fatalf("post %v #%d: %v", p.SourceType, p.SourceID, err)
	}

	err = db.Exec(`UPDATE liability_logs SET created_at = ? WHERE group_id = ?`, at, group).Error
	if err != nil {
		t.Fatalf("backdate group %d: %v", group, err)
	}
}

// The warehouse's income half of the daily statement: one row per day the ledger moved, ascending, with
// the source split — and a footer that is the sum of exactly those rows.
//
// The sparseness is asserted rather than assumed. The client builds the date spine (it must, to merge
// three services' series), so a server that also emitted empty days would be a second calendar free to
// disagree with it.
func TestLiabilityDaily_GroupsByDayAscendingWithTheSourceSplit(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, nil, nil)

	utc := time.UTC

	// Two fees on the 3rd — one handling, one COD — and one on the 5th. Nothing on the 4th.
	postOn(t, db, svc, handling(20_000, 1), time.Date(2026, 7, 3, 9, 0, 0, 0, utc))
	postOn(t, db, svc, codFee(15_000, 77), time.Date(2026, 7, 3, 14, 0, 0, 0, utc))
	postOn(t, db, svc, handling(30_000, 2), time.Date(2026, 7, 5, 9, 0, 0, 0, utc))
	// OUTSIDE the period — June must not appear.
	postOn(t, db, svc, handling(99_000, 3), time.Date(2026, 6, 30, 9, 0, 0, 0, utc))

	got := daily(t, svc, warehouse, "2026-07-01", "2026-07-31")

	days := got.GetDays()
	if len(days) != 2 {
		t.Fatalf("got %d day rows, want 2 — the ledger did not move on the 4th, so it must be ABSENT: %+v", len(days), days)
	}

	if days[0].GetDate() != "2026-07-03" || days[1].GetDate() != "2026-07-05" {
		t.Fatalf("days are %s, %s — want 2026-07-03 then 2026-07-05 (ascending)", days[0].GetDate(), days[1].GetDate())
	}

	// The 3rd is ONE row holding both sources, not one row per source wearing a date.
	if n := days[0].GetEntries(); n != 2 {
		t.Fatalf("the 3rd holds %d entry legs, want 2", n)
	}

	// RECEIVABLE IS POSITIVE from the warehouse's point of view (§4.11) — it is owed both fees.
	if net := days[0].GetNet(); net != 35_000 {
		t.Fatalf("the 3rd's net = %v, want 35000 (20.000 handling + 15.000 COD), positive because the warehouse is OWED", net)
	}

	// ⚠ THE SPLIT IS THE POINT. A COD fee is a REIMBURSEMENT of cash the warehouse already paid a
	// courier, not money it earned — so the statement must be able to take handling alone. A response
	// that only carried `net` would force the screen to call all of it income.
	bySource := days[0].GetBySource()
	if got := bySource[handlingFeeSource]; got != 20_000 {
		t.Fatalf("the 3rd's handling fees = %v, want 20000", got)
	}
	if got := bySource[codFeeSource]; got != 15_000 {
		t.Fatalf("the 3rd's COD fees = %v, want 15000", got)
	}

	// A source with nothing that day is ABSENT rather than 0.
	productFee := int32(liabilityv1.LiabilitySourceType_LIABILITY_SOURCE_TYPE_PRODUCT_FEE)
	if _, present := bySource[productFee]; present {
		t.Fatalf("the 3rd carries a PRODUCT_FEE it never had: %+v", bySource)
	}

	// THE FOOTER IS THE SUM OF THE ROWS.
	var summed float64
	for _, d := range days {
		summed += d.GetNet()
	}

	if got := got.GetTotals().GetNet(); got != summed {
		t.Fatalf("totals.net = %v but the days sum to %v", got, summed)
	}
	if got := got.GetTotals().GetNet(); got != 65_000 {
		t.Fatalf("period net = %v, want 65000 — June must not count", got)
	}
	if got := got.GetTotals().GetBySource()[handlingFeeSource]; got != 50_000 {
		t.Fatalf("period handling fees = %v, want 50000", got)
	}
}

// A REVERSAL NETS THE DAY TO ZERO, and is not filtered out.
//
// A cancelled order's fee is undone by an equal-and-opposite leg, and both stay — a ledger you can edit
// is not evidence of anything. So the honest daily figure is the plain sum. Excluding reversals would
// report income the ledger has already taken back, which on a statement reads as a good day that never
// happened.
func TestLiabilityDaily_AReversedFeeNetsTheDayToZero(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, nil, nil)

	on := time.Date(2026, 7, 3, 9, 0, 0, 0, time.UTC)

	postOn(t, db, svc, handling(20_000, 1), on)

	reversal := handling(20_000, 1)
	reversal.Reversal = true
	postOn(t, db, svc, reversal, on)

	got := daily(t, svc, warehouse, "2026-07-01", "2026-07-31")

	days := got.GetDays()
	if len(days) != 1 {
		t.Fatalf("got %d day rows, want 1: %+v", len(days), days)
	}

	// The day is still THERE — two things happened — but it is worth nothing.
	if n := days[0].GetEntries(); n != 2 {
		t.Fatalf("the day holds %d entry legs, want 2 — the fee and its reversal both stay", n)
	}
	if net := days[0].GetNet(); net != 0 {
		t.Fatalf("the day's net = %v, want 0 — the fee was charged and given back", net)
	}
	if got := got.GetTotals().GetNet(); got != 0 {
		t.Fatalf("period net = %v, want 0", got)
	}
}

// THE SIGN SURVIVES THE AGGREGATE. The same movement is a receivable to the warehouse and a payable to
// the selling team, and the two series must be exact negatives — the sign convention is stated once
// (§4.11) and an aggregate that lost it would put a warehouse's earnings on the wrong side of somebody
// else's statement.
func TestLiabilityDaily_TheTwoSidesAreExactNegatives(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, nil, nil)

	postOn(t, db, svc, handling(20_000, 1), time.Date(2026, 7, 3, 9, 0, 0, 0, time.UTC))

	creditor := daily(t, svc, warehouse, "2026-07-01", "2026-07-31")
	debtor := daily(t, svc, selling, "2026-07-01", "2026-07-31")

	if got := creditor.GetTotals().GetNet(); got != 20_000 {
		t.Fatalf("the warehouse's net = %v, want +20000 (it is OWED)", got)
	}
	if got := debtor.GetTotals().GetNet(); got != -20_000 {
		t.Fatalf("the selling team's net = %v, want -20000 (it OWES)", got)
	}
}

// wib is the system's calendar (the-liability-day-is-the-jakarta-day) — every instant below is written in it, so the
// Jakarta day each one belongs to reads straight off the literal.
var wib = time.FixedZone("WIB", 7*60*60)

// The last day of the period counts IN FULL, and the day after it does not — both ends JAKARTA days.
//
// `created_at` is a TIMESTAMPTZ, so a `<= to` bound would mean `<= midnight` and silently drop almost
// the whole final day. This handler writes its own bound (both ends are required here), and a second
// copy of a subtle bound is exactly the kind of thing that gets the subtlety wrong.
func TestLiabilityDaily_TheLastDayOfThePeriodCountsInFull(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, nil, nil)

	// Late on the final day — the leg a `<= to` bound would lose. 23:30 WIB is 16:30 UTC.
	postOn(t, db, svc, handling(50_000, 1), time.Date(2026, 7, 31, 23, 30, 0, 0, wib))
	// And the first moment of the next Jakarta day, which must NOT count — still 31 July in UTC (17:05).
	postOn(t, db, svc, handling(7_000, 2), time.Date(2026, 8, 1, 0, 5, 0, 0, wib))

	got := daily(t, svc, warehouse, "2026-07-01", "2026-07-31")

	days := got.GetDays()
	if len(days) != 1 {
		t.Fatalf("got %d day rows, want 1 — only 31 July is in the period: %+v", len(days), days)
	}

	if days[0].GetDate() != "2026-07-31" || days[0].GetNet() != 50_000 {
		t.Fatalf("the last day reads %s / %v, want 2026-07-31 / 50000 — 23:30 must not be dropped", days[0].GetDate(), days[0].GetNet())
	}
}

// THE JAKARTA DAY (the-liability-day-is-the-jakarta-day): an amount owed between 00:00 and 07:00 WIB is the UTC day
// before, and lands on its WIB day — both in the row it is grouped into and in the period that admits it. The period's
// first day starts at Jakarta midnight: 23:59 WIB the evening before is outside it, though it is the same UTC day.
func TestLiabilityDaily_AnAmountOwedBefore0700WIBLandsOnItsJakartaDay(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, nil, nil)

	// 3 July, Jakarta: its first instant, and 06:00 — both still 2 July in UTC (17:00 and 23:00).
	postOn(t, db, svc, handling(11_000, 1), time.Date(2026, 7, 3, 0, 0, 0, 0, wib))
	postOn(t, db, svc, handling(22_000, 2), time.Date(2026, 7, 3, 6, 0, 0, 0, wib))
	// 2 July 23:59 WIB — the Jakarta day before, the same UTC day as the two above.
	postOn(t, db, svc, handling(44_000, 3), time.Date(2026, 7, 2, 23, 59, 0, 0, wib))

	got := daily(t, svc, warehouse, "2026-07-03", "2026-07-03")

	days := got.GetDays()
	if len(days) != 1 || days[0].GetDate() != "2026-07-03" || days[0].GetNet() != 33_000 || days[0].GetEntries() != 2 {
		t.Fatalf("3 July = %+v, want one row of 33.000 from the two legs at 00:00 and 06:00 WIB", days)
	}

	if net := got.GetTotals().GetNet(); net != 33_000 {
		t.Fatalf("period net = %v, want 33.000 — 2 July 23:59 WIB is the day before", net)
	}

	// Over both days, each amount sits on its own Jakarta day.
	both := daily(t, svc, warehouse, "2026-07-02", "2026-07-03").GetDays()
	if len(both) != 2 || both[0].GetDate() != "2026-07-02" || both[0].GetNet() != 44_000 ||
		both[1].GetDate() != "2026-07-03" || both[1].GetNet() != 33_000 {
		t.Fatalf("2–3 July = %+v, want 2 July 44.000 then 3 July 33.000", both)
	}
}

// THE PERIOD IS THE PAGINATION (HARD RULE 9) — the same cap the other two daily series enforce, because
// the statement reads all three side by side and a cap that differed would let it load part of a period
// and still look complete.
func TestLiabilityDaily_RefusesAnUnboundedOrOversizedPeriod(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, nil, nil)

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
			_, err := svc.LiabilityDaily(context.Background(),
				connect.NewRequest(&liabilityv1.LiabilityDailyRequest{
					TeamId: warehouse,
					Filter: &liabilityv1.LiabilityDailyFilter{From: tc.from, To: tc.to},
				}))
			if err == nil {
				t.Fatalf("LiabilityDaily(%q..%q) succeeded — an unbounded series is the bug the cap exists to stop", tc.from, tc.to)
			}

			if code := connect.CodeOf(err); code != connect.CodeInvalidArgument {
				t.Fatalf("LiabilityDaily(%q..%q) = %v, want InvalidArgument", tc.from, tc.to, code)
			}
		})
	}
}

// One team can never read another's earnings. The team_id clause IS the scope check.
func TestLiabilityDaily_NeverLeaksAnotherTeamsDays(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, nil, nil)

	postOn(t, db, svc, handling(20_000, 1), time.Date(2026, 7, 3, 9, 0, 0, 0, time.UTC))

	const stranger uint64 = 4242

	res, err := svc.LiabilityDaily(context.Background(),
		connect.NewRequest(&liabilityv1.LiabilityDailyRequest{
			TeamId: stranger,
			Filter: &liabilityv1.LiabilityDailyFilter{From: "2026-07-01", To: "2026-07-31"},
		}))
	if err != nil {
		t.Fatalf("LiabilityDaily for a stranger: %v", err)
	}

	if n := len(res.Msg.GetDays()); n != 0 {
		t.Fatalf("team %d sees %d of the warehouse's days", stranger, n)
	}
	if got := res.Msg.GetTotals().GetNet(); got != 0 {
		t.Fatalf("team %v sees a net of %v from somebody else's ledger", stranger, got)
	}
}

// An empty period still returns a TOTALS message, not nil — the screen renders zeroes, never blanks.
func TestLiabilityDaily_AnEmptyPeriodIsZeroNotNil(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, nil, nil)

	// 2028 is a leap year: 1 Jan to 31 Dec inclusive is 366 days, the largest period allowed.
	got := daily(t, svc, warehouse, "2028-01-01", "2028-12-31")

	if got.GetTotals() == nil {
		t.Fatal("totals is nil for a period with no entries")
	}
	if len(got.GetDays()) != 0 {
		t.Fatalf("got %d day rows for a period with no entries", len(got.GetDays()))
	}
}

func dailyAt(
	t *testing.T,
	svc *liability_v1.Service,
	from, to string,
	grain analytic_basev1.GroupType,
) *liabilityv1.LiabilityDailyResponse {
	t.Helper()

	res, err := svc.LiabilityDaily(context.Background(),
		connect.NewRequest(&liabilityv1.LiabilityDailyRequest{
			TeamId:  warehouse,
			Filter:  &liabilityv1.LiabilityDailyFilter{From: from, To: to},
			GroupBy: grain,
		}))
	if err != nil {
		t.Fatalf("LiabilityDaily(%s..%s, %s): %v", from, to, grain, err)
	}

	return res.Msg
}

// rollUpLedger sums DAY rows into the buckets `keyOf` names — the rollup the browser used to do, kept here only as the
// yardstick the server's grouping is measured against.
func rollUpLedger(days []*liabilityv1.LiabilityDayItem, keyOf func(date string) string) []*liabilityv1.LiabilityDayItem {
	out := []*liabilityv1.LiabilityDayItem{}

	for _, d := range days {
		key := keyOf(d.GetDate())

		if len(out) == 0 || out[len(out)-1].GetDate() != key {
			out = append(out, &liabilityv1.LiabilityDayItem{Date: key, BySource: map[int32]float64{}})
		}

		b := out[len(out)-1]
		b.Entries += d.GetEntries()
		b.Net += d.GetNet()

		for source, amount := range d.GetBySource() {
			b.BySource[source] += amount
		}
	}

	return out
}

func sameLedgerBuckets(t *testing.T, grain string, got, want []*liabilityv1.LiabilityDayItem) {
	t.Helper()

	if len(got) != len(want) {
		t.Fatalf("%s: %d rows, want %d — got %+v", grain, len(got), len(want), got)
	}

	for i := range want {
		g, w := got[i], want[i]

		// Exact: every amount here is a whole number of rupiah, so the database's sum and the sum of its days are the
		// same double.
		if g.GetDate() != w.GetDate() || g.GetEntries() != w.GetEntries() || g.GetNet() != w.GetNet() ||
			len(g.GetBySource()) != len(w.GetBySource()) {
			t.Fatalf("%s row %d = %s / %d legs / %v %v — the days sum to %s / %d / %v %v",
				grain, i, g.GetDate(), g.GetEntries(), g.GetNet(), g.GetBySource(),
				w.GetDate(), w.GetEntries(), w.GetNet(), w.GetBySource())
		}

		for source, amount := range w.GetBySource() {
			if g.GetBySource()[source] != amount {
				t.Fatalf("%s row %s source %d = %v, the days sum to %v", grain, g.GetDate(), source, g.GetBySource()[source], amount)
			}
		}
	}
}

// THE SERVER GROUPS (periods-are-grouped-on-the-server), ON THE JAKARTA CALENDAR: a month's row and a year's row are
// EXACTLY the sum of their day rows — legs, net and every source — over a period that starts late in December, crosses
// a month AND a year boundary and ends on the 1st of February. The legs sit on the Jakarta midnights the UTC calendar
// would put in the other bucket: 00:30 WIB on 1 January is 17:30 UTC on 31 December (January, 2026 — not December,
// 2025), and 06:00 WIB on 1 February is 23:00 UTC on 31 January (February — not January).
func TestLiabilityDaily_AMonthsAndAYearsRowAreTheSumOfTheirJakartaDays(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, nil, nil)

	// OUTSIDE the period, by a minute each side.
	postOn(t, db, svc, handling(70_000, 1), time.Date(2025, 12, 29, 23, 59, 0, 0, wib))
	postOn(t, db, svc, handling(80_000, 2), time.Date(2026, 2, 2, 0, 1, 0, 0, wib))

	postOn(t, db, svc, handling(10_000, 3), time.Date(2025, 12, 30, 9, 0, 0, 0, wib))
	postOn(t, db, svc, codFee(15_000, 4), time.Date(2025, 12, 31, 14, 0, 0, 0, wib))
	postOn(t, db, svc, handling(30_000, 5), time.Date(2025, 12, 31, 23, 59, 0, 0, wib)) // December, 2025
	postOn(t, db, svc, handling(40_000, 6), time.Date(2026, 1, 1, 0, 0, 0, 0, wib))     // January, 2026
	postOn(t, db, svc, handling(50_000, 7), time.Date(2026, 1, 1, 0, 30, 0, 0, wib))    // 17:30 UTC on the 31st
	// A fee charged and reversed in January — two legs, net zero, both counted.
	postOn(t, db, svc, handling(60_000, 8), time.Date(2026, 1, 15, 10, 0, 0, 0, wib))
	reversal := handling(60_000, 8)
	reversal.Reversal = true
	postOn(t, db, svc, reversal, time.Date(2026, 1, 16, 10, 0, 0, 0, wib))
	postOn(t, db, svc, handling(25_000, 9), time.Date(2026, 1, 31, 23, 30, 0, 0, wib))
	postOn(t, db, svc, handling(35_000, 10), time.Date(2026, 2, 1, 6, 0, 0, 0, wib)) // 23:00 UTC on 31 Jan

	days := dailyAt(t, svc, "2025-12-30", "2026-02-01", analytic_basev1.GroupType_GROUP_TYPE_DAILY)
	unset := daily(t, svc, warehouse, "2025-12-30", "2026-02-01")
	months := dailyAt(t, svc, "2025-12-30", "2026-02-01", analytic_basev1.GroupType_GROUP_TYPE_MONTHLY)
	years := dailyAt(t, svc, "2025-12-30", "2026-02-01", analytic_basev1.GroupType_GROUP_TYPE_YEARLY)

	// No grain is the daily grain — the callers that send none get what they always got.
	sameLedgerBuckets(t, "unset", unset.GetDays(), days.GetDays())

	monthOf := func(date string) string { return date[:7] + "-01" }
	yearOf := func(date string) string { return date[:4] + "-01-01" }

	sameLedgerBuckets(t, "monthly", months.GetDays(), rollUpLedger(days.GetDays(), monthOf))
	sameLedgerBuckets(t, "yearly", years.GetDays(), rollUpLedger(days.GetDays(), yearOf))

	// The midnights, in figures: December = 10.000 + 15.000 + 30.000; January = 40.000 + 50.000 + 0 + 25.000;
	// February = 35.000. Years: 2025 = December, 2026 = the rest.
	want := []struct {
		date string
		net  float64
	}{{"2025-12-01", 55_000}, {"2026-01-01", 115_000}, {"2026-02-01", 35_000}}

	for i, w := range want {
		g := months.GetDays()[i]
		if g.GetDate() != w.date || g.GetNet() != w.net {
			t.Fatalf("month %d = %s / %v, want %s / %v", i, g.GetDate(), g.GetNet(), w.date, w.net)
		}
	}

	if y := years.GetDays(); len(y) != 2 || y[0].GetDate() != "2025-01-01" || y[0].GetNet() != 55_000 ||
		y[1].GetDate() != "2026-01-01" || y[1].GetNet() != 150_000 {
		t.Fatalf("years = %+v, want 2025 = 55000 and 2026 = 150000", y)
	}

	// The reversal keeps its legs in January's count: 40, 50, 60, −60, 25 → 5 legs.
	if got := months.GetDays()[1].GetEntries(); got != 5 {
		t.Fatalf("January holds %d legs, want 5 (the reversal and its fee both count)", got)
	}

	// One footer whatever the grain.
	for name, res := range map[string]*liabilityv1.LiabilityDailyResponse{"monthly": months, "yearly": years} {
		if res.GetTotals().GetNet() != days.GetTotals().GetNet() || res.GetTotals().GetNet() != 205_000 ||
			res.GetTotals().GetBySource()[codFeeSource] != 15_000 {
			t.Fatalf("%s totals = %v %v, daily %v, want 205000", name,
				res.GetTotals().GetNet(), res.GetTotals().GetBySource(), days.GetTotals().GetNet())
		}
	}
}

// THE SPAN FOLLOWS THE GRAIN (periods-are-grouped-on-the-server) — ExpenseDaily's caps exactly, since the two are read
// side by side: three years yearly is answered, daily refused; 60 months and 20 years fit, one more does not; a week
// is refused, never read as days.
func TestLiabilityDaily_TheSpanFollowsTheGrain(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, nil, nil)

	postOn(t, db, svc, handling(20_000, 1), time.Date(2024, 3, 1, 9, 0, 0, 0, wib))
	postOn(t, db, svc, handling(30_000, 2), time.Date(2026, 11, 1, 9, 0, 0, 0, wib))

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
			res, err := svc.LiabilityDaily(context.Background(), connect.NewRequest(&liabilityv1.LiabilityDailyRequest{
				TeamId:  warehouse,
				Filter:  &liabilityv1.LiabilityDailyFilter{From: tc.from, To: tc.to},
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
				if len(y) != 2 || y[0].GetDate() != "2024-01-01" || y[1].GetDate() != "2026-01-01" || y[1].GetNet() != 30_000 {
					t.Fatalf("three years yearly = %+v, want 2024 and 2026 (2025 moved nothing, so it is absent)", y)
				}
			}
		})
	}
}
