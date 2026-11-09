package liability_v1_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	liabilityv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/liability/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	liability_v1 "github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_v1"
)

func history(
	t *testing.T,
	svc *liability_v1.Service,
	teamID, counterpartyID uint64,
) *liabilityv1.LiabilityLogListResponse {
	t.Helper()

	res, err := svc.LiabilityLogList(context.Background(),
		connect.NewRequest(&liabilityv1.LiabilityLogListRequest{
			TeamId: teamID,
			Filter: &liabilityv1.LiabilityLogListFilter{CounterpartyId: counterpartyID},
			Page:   &commonv1.CommonPagination{Page: 1, Limit: 50},
		}))
	if err != nil {
		t.Fatalf("LiabilityLogList(%d -> %d): %v", teamID, counterpartyID, err)
	}

	return res.Msg
}

// THE HISTORY SAYS WHY, BY ID. This is what `(source_type, source_id)` was for — a line reads "COD
// fee, restock #77", which is joinable and filterable, rather than a free-text note nobody can do
// anything with.
func TestEntryList_EachLineSaysWhatCausedIt(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, nil, nil)

	_, err := svc.PostEntry(context.Background(), db, codFee(15000, 77))
	if err != nil {
		t.Fatalf("fee: %v", err)
	}

	msg := history(t, svc, warehouse, selling)

	if len(entryRows(msg)) != 1 {
		t.Fatalf("%d entries, want 1", len(entryRows(msg)))
	}

	entry := entryRows(msg)[0]
	if entry.GetSourceType() != liabilityv1.LiabilitySourceType_LIABILITY_SOURCE_TYPE_INCIDENTAL_FEE {
		t.Fatalf("source_type = %v, want COD_FEE", entry.GetSourceType())
	}

	if entry.GetSourceId() != 77 {
		t.Fatalf("source_id = %d, want the restock request 77", entry.GetSourceId())
	}

	// The balance rides on the response, so the page header needs no second call.
	if msg.GetBalance() != 15000 {
		t.Fatalf("balance = %v, want 15000", msg.GetBalance())
	}
}

// A FEE AND ITS REVERSAL READ AS ONE STORY: both visible, netting to zero. That is exactly what a
// compensating entry buys over a delete — "the fee briefly existed" is what an audit needs to see.
func TestEntryList_AFeeAndItsReversalBothStay(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, nil, nil)

	_, err := svc.PostEntry(context.Background(), db, codFee(15000, 77))
	if err != nil {
		t.Fatalf("fee: %v", err)
	}

	reversal := codFee(15000, 77)
	reversal.Reversal = true

	_, err = svc.PostEntry(context.Background(), db, reversal)
	if err != nil {
		t.Fatalf("reversal: %v", err)
	}

	msg := history(t, svc, warehouse, selling)

	if len(entryRows(msg)) != 2 {
		t.Fatalf("%d entries, want both the fee and its reversal", len(entryRows(msg)))
	}

	// Newest first, so the reversal is what somebody sees at the top.
	if !entryRows(msg)[0].GetReversal() {
		t.Fatal("the newest entry is not the reversal — the history is not newest-first")
	}

	if msg.GetBalance() != 0 {
		t.Fatalf("balance = %v after a reversal, want 0", msg.GetBalance())
	}
}

// A pair that has never traded reads as ZERO, not as an error: "we have never traded" and "we are
// square" are the same answer to the question this screen asks.
func TestEntryList_AnUntradedPairIsSquareRatherThanMissing(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, nil, nil)

	msg := history(t, svc, selling, 12345)

	if len(entryRows(msg)) != 0 || msg.GetBalance() != 0 {
		t.Fatalf("entries=%v balance=%v, want an empty, square history",
			len(entryRows(msg)), msg.GetBalance())
	}
}

// ⚠ `counterparty_id` IS NOT THE SCOPE. Naming a pair the caller is not part of returns nothing —
// it can never reach two other teams' books.
func TestEntryList_CannotReadTwoOtherTeamsPair(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, nil, nil)

	const outsider uint64 = 7

	_, err := svc.PostEntry(context.Background(), db, liability_v1.Posting{
		DebtorTeamID: outsider, CreditorTeamID: warehouse, Amount: 99000,
		SourceType: liability_v1.SourceTypeIncidentalFee, SourceID: 1,
	})
	if err != nil {
		t.Fatalf("outsiders' debt: %v", err)
	}

	// The caller is `selling`, which has nothing to do with (outsider, warehouse).
	res, err := svc.LiabilityLogList(context.Background(),
		connect.NewRequest(&liabilityv1.LiabilityLogListRequest{
			TeamId: selling,
			Filter: &liabilityv1.LiabilityLogListFilter{CounterpartyId: outsider},
			Page:   &commonv1.CommonPagination{Page: 1, Limit: 50},
		}))
	if err != nil {
		t.Fatalf("list: %v", err)
	}

	if len(entryRows(res.Msg)) != 0 || res.Msg.GetBalance() != 0 {
		t.Fatalf("read %d entries of somebody else's pair", len(entryRows(res.Msg)))
	}
}

// ── the period and the direction run BEFORE THE PAGE (backlog #34) ──────────────────────────────────────────────

func historyFiltered(
	t *testing.T,
	svc *liability_v1.Service,
	filter *liabilityv1.LiabilityLogListFilter,
	page, limit uint32,
) *liabilityv1.LiabilityLogListResponse {
	t.Helper()

	filter.CounterpartyId = selling

	res, err := svc.LiabilityLogList(context.Background(),
		connect.NewRequest(&liabilityv1.LiabilityLogListRequest{
			TeamId: warehouse,
			Filter: filter,
			Page:   &commonv1.CommonPagination{Page: page, Limit: limit},
		}))
	if err != nil {
		t.Fatalf("LiabilityLogList: %v", err)
	}

	return res.Msg
}

// postAt posts one leg pair and moves BOTH legs to `at` — the test is one transaction, so NOW() would stamp every entry
// with the same instant.
func postAt(t *testing.T, svc *liability_v1.Service, db *gorm.DB, posting liability_v1.Posting, at time.Time) {
	t.Helper()

	_, err := svc.PostEntry(context.Background(), db, posting)
	if err != nil {
		t.Fatalf("post: %v", err)
	}

	// Every posting in these tests carries its own source id, so the id and the flag name both legs.
	err = db.Exec(`UPDATE liability_logs SET created_at = ? WHERE source_id = ? AND reversal = ?`,
		at, posting.SourceID, posting.Reversal).Error
	if err != nil {
		t.Fatalf("date the entry: %v", err)
	}
}

func jakartaAt(t *testing.T, value string) time.Time {
	t.Helper()

	at, err := time.ParseInLocation("2006-01-02 15:04:05", value, time.FixedZone("WIB", 7*60*60))
	if err != nil {
		t.Fatalf("parse %q: %v", value, err)
	}

	return at
}

// ⛔ THE BUG #34 RETIRES, on the pair page. The range narrowed the 50 rows the screen had loaded, newest first — so the
// three oldest entries, on page 2, never showed under a range that held only them. The server narrows first.
func TestEntryList_ADateRangeFindsEntriesOnPage2(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, nil, nil)

	// 60 fees, one a day from 1 Oct 2026 (WIB noon), the oldest first — newest-first paging puts 1–3 Oct on page 2.
	start := jakartaAt(t, "2026-10-01 12:00:00")
	for i := 0; i < 60; i++ {
		postAt(t, svc, db, codFee(float64(1000+i), uint64(500+i)), start.AddDate(0, 0, i))
	}

	got := historyFiltered(t, svc, &liabilityv1.LiabilityLogListFilter{From: "2026-10-01", To: "2026-10-03"}, 1, 50)

	if n := len(entryRows(got)); n != 3 {
		t.Fatalf("%d entries on page 1 of 1–3 Oct, want the 3 that sit on page 2 unfiltered", n)
	}

	if got.GetPageInfo().GetTotalItems() != 3 {
		t.Fatalf("total_items = %d, want 3", got.GetPageInfo().GetTotalItems())
	}

	for _, e := range entryRows(got) {
		if e.GetSourceId() > 502 {
			t.Fatalf("entry for restock %d is outside 1–3 Oct", e.GetSourceId())
		}
	}

	// The header's balance is the WHOLE pair's, whatever the range.
	if got.GetBalance() == 0 || got.GetBalance() != history(t, svc, warehouse, selling).GetBalance() {
		t.Fatalf("balance = %v under a range, want the pair's", got.GetBalance())
	}

	// Open ends: `from` alone runs to now, `to` alone from the start.
	if n := historyFiltered(t, svc, &liabilityv1.LiabilityLogListFilter{From: "2026-11-29"}, 1, 50).GetPageInfo().GetTotalItems(); n != 1 {
		t.Fatalf("from 29 Nov alone: %d entries, want 1 (the 60th)", n)
	}

	if n := historyFiltered(t, svc, &liabilityv1.LiabilityLogListFilter{To: "2026-10-02"}, 1, 50).GetPageInfo().GetTotalItems(); n != 2 {
		t.Fatalf("to 2 Oct alone: %d entries, want 2", n)
	}
}

// THE DAY IS THE JAKARTA DAY (the-liability-day-is-the-jakarta-day). 06:30 WIB on 5 Nov is 23:30 UTC on the 4th — it
// belongs to the 5th, and so does 00:30 WIB (17:30 UTC on the 4th). 23:59:59 WIB is still the 5th; 00:00 WIB on the
// 6th is not. The process clock is set to UTC for the test, as a cloud host's is: the day must not follow it.
func TestEntryList_ARangeReadsJakartaDays(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, nil, nil)

	hostZone := time.Local
	time.Local = time.UTC
	t.Cleanup(func() { time.Local = hostZone })

	postAt(t, svc, db, codFee(1000, 1), time.Date(2026, 11, 4, 23, 30, 0, 0, time.UTC)) // 5 Nov 06:30 WIB
	postAt(t, svc, db, codFee(2000, 2), jakartaAt(t, "2026-11-05 23:59:59"))
	postAt(t, svc, db, codFee(3000, 3), jakartaAt(t, "2026-11-06 00:00:00"))
	postAt(t, svc, db, codFee(4000, 4), jakartaAt(t, "2026-11-04 23:59:59"))
	postAt(t, svc, db, codFee(5000, 5), time.Date(2026, 11, 4, 17, 30, 0, 0, time.UTC)) // 5 Nov 00:30 WIB

	day := func(d string) []uint64 {
		got := historyFiltered(t, svc, &liabilityv1.LiabilityLogListFilter{From: d, To: d}, 1, 50)

		ids := []uint64{}
		for _, e := range entryRows(got) {
			ids = append(ids, e.GetSourceId())
		}

		return ids
	}

	if got := day("2026-11-05"); len(got) != 3 || got[0] != 5 || got[1] != 2 || got[2] != 1 {
		t.Fatalf("5 Nov = restocks %v, want [5 2 1] — 00:30, 23:59:59 and 06:30 WIB", got)
	}

	if got := day("2026-11-04"); len(got) != 1 || got[0] != 4 {
		t.Fatalf("4 Nov = restocks %v, want [4] — 17:30 and 23:30 UTC on the 4th are the 5th in Jakarta", got)
	}

	if got := day("2026-11-06"); len(got) != 1 || got[0] != 3 {
		t.Fatalf("6 Nov = restocks %v, want [3]", got)
	}
}

// ⚠ BALANCE AFTER IS THE WHOLE LEDGER'S, on any cut and any page of it. Movements +100, −30, +50, −20 run the balance
// 100, 70, 120, 100: the Payable cut is the two negatives, still reading 100 and 70 — never a sum of what the cut holds.
func TestEntryList_AFilteredPageCarriesTheTrueRunningBalance(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, nil, nil)

	steps := []struct {
		owedToWarehouse bool
		amount          float64
	}{{true, 100}, {false, 30}, {true, 50}, {false, 20}}

	for i, step := range steps {
		posting := liability_v1.Posting{
			DebtorTeamID: selling, CreditorTeamID: warehouse, Amount: step.amount,
			SourceType: liability_v1.SourceTypeIncidentalFee, SourceID: uint64(i + 1),
		}
		if !step.owedToWarehouse {
			posting = liability_v1.Posting{
				DebtorTeamID: warehouse, CreditorTeamID: selling, Amount: step.amount,
				SourceType: liability_v1.SourceTypeBrokenGood, SourceID: uint64(i + 1),
			}
		}

		_, err := svc.PostEntry(context.Background(), db, posting)
		if err != nil {
			t.Fatalf("step %d: %v", i, err)
		}
	}

	payable := historyFiltered(t, svc, &liabilityv1.LiabilityLogListFilter{
		Direction: liabilityv1.LiabilityLogDirection_LIABILITY_LOG_DIRECTION_PAYABLE,
	}, 1, 50)

	rows := entryRows(payable)
	if len(rows) != 2 || payable.GetPageInfo().GetTotalItems() != 2 {
		t.Fatalf("payable: %d rows (total %d), want the two negatives", len(rows), payable.GetPageInfo().GetTotalItems())
	}

	// Newest first: −20 left 100, −30 left 70.
	if rows[0].GetAmount() != -20 || rows[0].GetBalanceAfter() != 100 || rows[1].GetAmount() != -30 || rows[1].GetBalanceAfter() != 70 {
		t.Fatalf("payable rows = (%v → %v), (%v → %v), want (−20 → 100), (−30 → 70)",
			rows[0].GetAmount(), rows[0].GetBalanceAfter(), rows[1].GetAmount(), rows[1].GetBalanceAfter())
	}

	// Page 2 of a one-row Receivable cut is the older positive — +100, balance 100 — and the pager counts the cut.
	receivable := historyFiltered(t, svc, &liabilityv1.LiabilityLogListFilter{
		Direction: liabilityv1.LiabilityLogDirection_LIABILITY_LOG_DIRECTION_RECEIVABLE,
	}, 2, 1)

	rows = entryRows(receivable)
	if len(rows) != 1 || rows[0].GetAmount() != 100 || rows[0].GetBalanceAfter() != 100 {
		t.Fatalf("receivable page 2 = %v, want the +100 leaving 100", rows)
	}

	if receivable.GetPageInfo().GetTotalItems() != 2 || receivable.GetPageInfo().GetTotalPage() != 2 {
		t.Fatalf("receivable pager = %d items / %d pages, want 2 / 2",
			receivable.GetPageInfo().GetTotalItems(), receivable.GetPageInfo().GetTotalPage())
	}

	// All: every movement, and the balance is still the pair's now.
	all := historyFiltered(t, svc, &liabilityv1.LiabilityLogListFilter{}, 1, 50)
	if len(entryRows(all)) != 4 || all.GetBalance() != 100 {
		t.Fatalf("all = %d rows, balance %v — want 4 and 100", len(entryRows(all)), all.GetBalance())
	}
}

// A period is real days, in order. "2026-02-31" fits the pattern and is no day; a `to` before `from` is the caller's
// bug and is refused, never swapped into a confident answer.
func TestEntryList_ABadPeriodIsRefused(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, nil, nil)

	for _, filter := range []*liabilityv1.LiabilityLogListFilter{
		{CounterpartyId: selling, From: "2026-02-31"},
		{CounterpartyId: selling, To: "2026-13-01"},
		{CounterpartyId: selling, From: "2026-11-05", To: "2026-11-04"},
	} {
		_, err := svc.LiabilityLogList(context.Background(),
			connect.NewRequest(&liabilityv1.LiabilityLogListRequest{
				TeamId: warehouse,
				Filter: filter,
				Page:   &commonv1.CommonPagination{Page: 1, Limit: 50},
			}))

		var connectErr *connect.Error
		if !errors.As(err, &connectErr) || connectErr.Code() != connect.CodeInvalidArgument {
			t.Fatalf("from=%q to=%q: err = %v, want InvalidArgument", filter.GetFrom(), filter.GetTo(), err)
		}
	}

	// One day — from equal to to — is a period, not an inverted one.
	_, err := svc.LiabilityLogList(context.Background(),
		connect.NewRequest(&liabilityv1.LiabilityLogListRequest{
			TeamId: warehouse,
			Filter: &liabilityv1.LiabilityLogListFilter{CounterpartyId: selling, From: "2026-11-05", To: "2026-11-05"},
			Page:   &commonv1.CommonPagination{Page: 1, Limit: 50},
		}))
	if err != nil {
		t.Fatalf("a one-day period: %v", err)
	}
}
