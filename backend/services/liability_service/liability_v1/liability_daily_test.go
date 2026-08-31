package liability_v1_test

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

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
func handling(amount int64, sourceID uint64) liability_v1.Posting {
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
	svc := liability_v1.NewService(db)

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
		t.Fatalf("the 3rd's net = %d, want 35000 (20.000 handling + 15.000 COD), positive because the warehouse is OWED", net)
	}

	// ⚠ THE SPLIT IS THE POINT. A COD fee is a REIMBURSEMENT of cash the warehouse already paid a
	// courier, not money it earned — so the statement must be able to take handling alone. A response
	// that only carried `net` would force the screen to call all of it income.
	bySource := days[0].GetBySource()
	if got := bySource[handlingFeeSource]; got != 20_000 {
		t.Fatalf("the 3rd's handling fees = %d, want 20000", got)
	}
	if got := bySource[codFeeSource]; got != 15_000 {
		t.Fatalf("the 3rd's COD fees = %d, want 15000", got)
	}

	// A source with nothing that day is ABSENT rather than 0.
	productFee := int32(liabilityv1.LiabilitySourceType_LIABILITY_SOURCE_TYPE_PRODUCT_FEE)
	if _, present := bySource[productFee]; present {
		t.Fatalf("the 3rd carries a PRODUCT_FEE it never had: %+v", bySource)
	}

	// THE FOOTER IS THE SUM OF THE ROWS.
	var summed int64
	for _, d := range days {
		summed += d.GetNet()
	}

	if got := got.GetTotals().GetNet(); got != summed {
		t.Fatalf("totals.net = %d but the days sum to %d", got, summed)
	}
	if got := got.GetTotals().GetNet(); got != 65_000 {
		t.Fatalf("period net = %d, want 65000 — June must not count", got)
	}
	if got := got.GetTotals().GetBySource()[handlingFeeSource]; got != 50_000 {
		t.Fatalf("period handling fees = %d, want 50000", got)
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
	svc := liability_v1.NewService(db)

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
		t.Fatalf("the day's net = %d, want 0 — the fee was charged and given back", net)
	}
	if got := got.GetTotals().GetNet(); got != 0 {
		t.Fatalf("period net = %d, want 0", got)
	}
}

// THE SIGN SURVIVES THE AGGREGATE. The same movement is a receivable to the warehouse and a payable to
// the selling team, and the two series must be exact negatives — the sign convention is stated once
// (§4.11) and an aggregate that lost it would put a warehouse's earnings on the wrong side of somebody
// else's statement.
func TestLiabilityDaily_TheTwoSidesAreExactNegatives(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db)

	postOn(t, db, svc, handling(20_000, 1), time.Date(2026, 7, 3, 9, 0, 0, 0, time.UTC))

	creditor := daily(t, svc, warehouse, "2026-07-01", "2026-07-31")
	debtor := daily(t, svc, selling, "2026-07-01", "2026-07-31")

	if got := creditor.GetTotals().GetNet(); got != 20_000 {
		t.Fatalf("the warehouse's net = %d, want +20000 (it is OWED)", got)
	}
	if got := debtor.GetTotals().GetNet(); got != -20_000 {
		t.Fatalf("the selling team's net = %d, want -20000 (it OWES)", got)
	}
}

// The last day of the period counts IN FULL, and the day after it does not.
//
// `created_at` is a TIMESTAMPTZ, so a `<= to` bound would mean `<= midnight` and silently drop almost
// the whole final day. This handler writes its own bound (both ends are required here), and a second
// copy of a subtle bound is exactly the kind of thing that gets the subtlety wrong.
func TestLiabilityDaily_TheLastDayOfThePeriodCountsInFull(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db)

	// Late on the final day — the leg a `<= to` bound would lose.
	postOn(t, db, svc, handling(50_000, 1), time.Date(2026, 7, 31, 23, 30, 0, 0, time.UTC))
	// And the first moment of the next day, which must NOT count.
	postOn(t, db, svc, handling(7_000, 2), time.Date(2026, 8, 1, 0, 5, 0, 0, time.UTC))

	got := daily(t, svc, warehouse, "2026-07-01", "2026-07-31")

	days := got.GetDays()
	if len(days) != 1 {
		t.Fatalf("got %d day rows, want 1 — only 31 July is in the period: %+v", len(days), days)
	}

	if days[0].GetDate() != "2026-07-31" || days[0].GetNet() != 50_000 {
		t.Fatalf("the last day reads %s / %d, want 2026-07-31 / 50000 — 23:30 must not be dropped", days[0].GetDate(), days[0].GetNet())
	}
}

// THE PERIOD IS THE PAGINATION (HARD RULE 9) — the same cap the other two daily series enforce, because
// the statement reads all three side by side and a cap that differed would let it load part of a period
// and still look complete.
func TestLiabilityDaily_RefusesAnUnboundedOrOversizedPeriod(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db)

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
	svc := liability_v1.NewService(db)

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
		t.Fatalf("team %d sees a net of %d from somebody else's ledger", stranger, got)
	}
}

// An empty period still returns a TOTALS message, not nil — the screen renders zeroes, never blanks.
func TestLiabilityDaily_AnEmptyPeriodIsZeroNotNil(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db)

	// 2028 is a leap year: 1 Jan to 31 Dec inclusive is 366 days, the largest period allowed.
	got := daily(t, svc, warehouse, "2028-01-01", "2028-12-31")

	if got.GetTotals() == nil {
		t.Fatal("totals is nil for a period with no entries")
	}
	if len(got.GetDays()) != 0 {
		t.Fatalf("got %d day rows for a period with no entries", len(got.GetDays()))
	}
}
