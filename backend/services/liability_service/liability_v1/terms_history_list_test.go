package liability_v1_test

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	liabilityv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/liability/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	liability_v1 "github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_v1"
)

func termsHistory(
	t *testing.T,
	svc *liability_v1.Service,
	teamID uint64,
	counterparty *uint64,
) []*liabilityv1.LiabilityTermsChange {
	t.Helper()

	res, err := svc.LiabilityTermsHistoryList(context.Background(),
		connect.NewRequest(&liabilityv1.LiabilityTermsHistoryListRequest{
			TeamId: teamID,
			Filter: &liabilityv1.LiabilityTermsHistoryListFilter{CounterpartyId: counterparty},
			Page:   &commonv1.CommonPagination{Page: 1, Limit: 50},
		}))
	if err != nil {
		t.Fatalf("LiabilityTermsHistoryList: %v", err)
	}

	// One data slice, keyed by the change's own id — the ids carry the ORDER.
	changes := make([]*liabilityv1.LiabilityTermsChange, 0, len(res.Msg.GetIds()))
	for _, item := range res.Msg.GetItems() {
		if m := item.GetChange().GetMapData(); m != nil {
			for _, id := range res.Msg.GetIds() {
				changes = append(changes, m[id])
			}
		}
	}

	return changes
}

func writeTerms(
	t *testing.T,
	svc *liability_v1.Service,
	teamID, counterparty uint64,
	limit *float64,
	reason string,
) {
	t.Helper()

	_, err := svc.LiabilityTermsSet(context.Background(),
		connect.NewRequest(&liabilityv1.LiabilityTermsSetRequest{
			TeamId:         teamID,
			CounterpartyId: counterparty,
			CreditLimit:    limit,
			Reason:         reason,
		}))
	if err != nil {
		t.Fatalf("LiabilityTermsSet: %v", err)
	}
}

func i64(v float64) *float64 { return &v }

// ⛔ THE WHOLE REASON THIS TABLE EXISTS. `absent`, `0` and a number are THREE acts — no limit at all,
// frozen entirely, and a real ceiling — and a NOT NULL column flattens the first into the second,
// recording "they removed the limit" as "they froze the team". Those are opposites, and the wrong one
// of the two is the one that stops a team trading.
func TestTermsHistory_TellsRemovedApartFromFrozen(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, nil, nil)

	const creditor, debtor uint64 = 11, 12

	writeTerms(t, svc, creditor, debtor, i64(5_000_000), "") // a real ceiling
	writeTerms(t, svc, creditor, debtor, nil, "")            // REMOVED — unlimited
	writeTerms(t, svc, creditor, debtor, i64(0), "")         // FROZEN — no credit at all

	changes := termsHistory(t, svc, creditor, &[]uint64{debtor}[0])

	if len(changes) != 3 {
		t.Fatalf("%d changes, want 3", len(changes))
	}

	// Newest first.
	froze, removed := changes[0], changes[1]

	// FROZEN: the new limit is present and zero.
	if froze.NewCreditLimit == nil || froze.GetNewCreditLimit() != 0 {
		t.Fatalf("the freeze recorded new_credit_limit = %v, want a present 0", froze.NewCreditLimit)
	}

	// REMOVED: the new limit is ABSENT. If this ever reads as a present 0, the log is saying the
	// creditor froze a team at the moment they un-restricted it.
	if removed.NewCreditLimit != nil {
		t.Fatalf("the removal recorded new_credit_limit = %v, want ABSENT — 0 means frozen, which is "+
			"the opposite of what happened", removed.GetNewCreditLimit())
	}

	// …and it remembers what it was before, which is what makes the entry readable on its own.
	if removed.OldCreditLimit == nil || removed.GetOldCreditLimit() != 5_000_000 {
		t.Fatalf("the removal recorded old_credit_limit = %v, want 5000000", removed.OldCreditLimit)
	}
}

// DELETING TERMS IS A LIMIT CHANGE TOO — arguably the biggest, since it lifts the ceiling entirely.
// It must not be the one act that leaves no trace.
func TestTermsHistory_ADeleteIsRecordedAsARemoval(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, nil, nil)

	const creditor, debtor uint64 = 11, 12

	writeTerms(t, svc, creditor, debtor, i64(5_000_000), "")

	_, err := svc.LiabilityTermsDelete(context.Background(),
		connect.NewRequest(&liabilityv1.LiabilityTermsDeleteRequest{
			TeamId:         creditor,
			CounterpartyId: debtor,
			Reason:         "they settled up and left",
		}))
	if err != nil {
		t.Fatalf("LiabilityTermsDelete: %v", err)
	}

	changes := termsHistory(t, svc, creditor, &[]uint64{debtor}[0])

	if len(changes) != 2 {
		t.Fatalf("%d changes, want 2 — the delete was not recorded", len(changes))
	}

	del := changes[0]

	if del.NewCreditLimit != nil {
		t.Fatalf("the delete recorded new_credit_limit = %v, want ABSENT", del.GetNewCreditLimit())
	}

	if del.GetReason() != "they settled up and left" {
		t.Fatalf("reason = %q", del.GetReason())
	}
}

// DELETING WHAT IS NOT THERE LOGS NOTHING. The RPC still succeeds — the caller asked for a state and
// that state holds — but nothing CHANGED, and a history full of no-ops is one nobody reads.
func TestTermsHistory_ANoOpDeleteRecordsNothing(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, nil, nil)

	const creditor, debtor uint64 = 11, 12

	_, err := svc.LiabilityTermsDelete(context.Background(),
		connect.NewRequest(&liabilityv1.LiabilityTermsDeleteRequest{
			TeamId: creditor, CounterpartyId: debtor,
		}))
	if err != nil {
		t.Fatalf("LiabilityTermsDelete: %v", err)
	}

	if changes := termsHistory(t, svc, creditor, &[]uint64{debtor}[0]); len(changes) != 0 {
		t.Fatalf("%d changes for a delete that changed nothing, want 0", len(changes))
	}
}

// ⚠ THE COUNTERPARTY FILTER MUST TELL "EVERY COUNTERPARTY" APART FROM "THE DEFAULT ROW", because 0 is
// a real counterparty id here. A plain uint64 could not, which is why the proto field is `optional`.
func TestTermsHistory_ZeroIsTheDefaultRowNotEveryone(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, nil, nil)

	const creditor uint64 = 11

	writeTerms(t, svc, creditor, 0, i64(1_000_000), "")  // the DEFAULT row
	writeTerms(t, svc, creditor, 12, i64(5_000_000), "") // one pair's override

	// Omitted → every counterparty.
	if all := termsHistory(t, svc, creditor, nil); len(all) != 2 {
		t.Fatalf("%d changes with no filter, want 2", len(all))
	}

	// 0 → the default row alone, NOT everything.
	def := termsHistory(t, svc, creditor, &[]uint64{0}[0])
	if len(def) != 1 {
		t.Fatalf("%d changes for counterparty 0, want 1 — 0 is the default row, not a wildcard",
			len(def))
	}

	if def[0].GetCounterpartyId() != 0 {
		t.Fatalf("counterparty = %d, want 0", def[0].GetCounterpartyId())
	}
}

// ⛔ A SECOND BUG THAT ONLY A RUNNING SERVER SHOWED. GORM fills timestamps by NAME, and this column
// is `changed_at` — so without an explicit tag it inserted Go's ZERO TIME, the column default never
// fired, and every entry came back stamped year 1. Worse than a cosmetic date: the list is ordered
// `changed_at DESC`, so a table of identical zero timestamps orders by nothing at all.
//
// ⚠ Five tests passed over it because none of them looked at the timestamp.
func TestTermsHistory_StampsWhenTheChangeHappened(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, nil, nil)

	const creditor uint64 = 11

	before := time.Now().Add(-time.Minute).Unix()

	writeTerms(t, svc, creditor, 12, i64(5_000_000), "")

	changes := termsHistory(t, svc, creditor, nil)
	if len(changes) != 1 {
		t.Fatalf("%d changes, want 1", len(changes))
	}

	if at := changes[0].GetChangedAtUnix(); at < before {
		t.Fatalf("changed_at = %d, want a time after %d — the zero time means GORM inserted it "+
			"explicitly and the column default never fired", at, before)
	}
}

// A HISTORY IS SCOPED TO THE CREDITOR. Another team's limit decisions are not readable by naming them.
func TestTermsHistory_IsScopedToTheCreditor(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, nil, nil)

	writeTerms(t, svc, 11, 12, i64(5_000_000), "")

	if changes := termsHistory(t, svc, 99, nil); len(changes) != 0 {
		t.Fatalf("%d changes visible to a team that made none", len(changes))
	}
}

// ⛔ THE REGRESSION TEST FOR A PANIC THAT REACHED A RUNNING SERVER. Every other test here passes a
// filter OBJECT with a nil field inside it; a caller asking for every counterparty omits the filter
// ENTIRELY, and `GetFilter()` then returns nil. The getter is nil-safe, the field access after it is
// not — so `req.Msg.GetFilter().CounterpartyId` panicked on the most ordinary call the RPC has.
//
// ⚠ It survived five tests, `go vet` and the whole e2e suite. It took calling the RPC for real.
func TestTermsHistory_AnOmittedFilterDoesNotPanic(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, nil, nil)

	const creditor uint64 = 11

	writeTerms(t, svc, creditor, 12, i64(5_000_000), "")

	// NO Filter field at all — not an empty one.
	res, err := svc.LiabilityTermsHistoryList(context.Background(),
		connect.NewRequest(&liabilityv1.LiabilityTermsHistoryListRequest{
			TeamId: creditor,
			Page:   &commonv1.CommonPagination{Page: 1, Limit: 50},
		}))
	if err != nil {
		t.Fatalf("LiabilityTermsHistoryList with no filter: %v", err)
	}

	if len(res.Msg.GetIds()) != 1 {
		t.Fatalf("%d changes, want 1 — an omitted filter means EVERY counterparty", len(res.Msg.GetIds()))
	}
}

// The pair page's date range narrows the LIMIT log too, before the page (backlog #34) — the day a limit CHANGED, a
// Jakarta day. Eleven changes on one pair, the oldest at 06:30 WIB on 5 Nov (23:30 UTC on the 4th): with a page of 10
// it is on page 2 unfiltered, and the 5 Nov range finds it alone.
func TestTermsHistory_ADateRangeNarrowsBeforeThePage(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, nil, nil)

	const debtor uint64 = 31

	for i := 0; i < 11; i++ {
		writeTerms(t, svc, warehouse, debtor, i64(float64(1000*(i+1))), "")
	}

	changes := termsHistory(t, svc, warehouse, nil)
	if len(changes) != 11 {
		t.Fatalf("%d changes, want 11", len(changes))
	}

	oldest := changes[len(changes)-1].GetId()
	wib := time.FixedZone("WIB", 7*60*60)

	err := db.Exec(`UPDATE liability_terms_logs SET changed_at = ? WHERE team_id = ? AND id <> ?`,
		time.Date(2026, 11, 6, 9, 0, 0, 0, wib), warehouse, oldest).Error
	if err != nil {
		t.Fatalf("date the changes: %v", err)
	}

	err = db.Exec(`UPDATE liability_terms_logs SET changed_at = ? WHERE id = ?`,
		time.Date(2026, 11, 4, 23, 30, 0, 0, time.UTC), oldest).Error
	if err != nil {
		t.Fatalf("date the oldest: %v", err)
	}

	page := func(from, to string) *liabilityv1.LiabilityTermsHistoryListResponse {
		res, err := svc.LiabilityTermsHistoryList(context.Background(),
			connect.NewRequest(&liabilityv1.LiabilityTermsHistoryListRequest{
				TeamId: warehouse,
				Filter: &liabilityv1.LiabilityTermsHistoryListFilter{CounterpartyId: &[]uint64{debtor}[0], From: from, To: to},
				Page:   &commonv1.CommonPagination{Page: 1, Limit: 10},
			}))
		if err != nil {
			t.Fatalf("LiabilityTermsHistoryList(%s..%s): %v", from, to, err)
		}

		return res.Msg
	}

	day := page("2026-11-05", "2026-11-05")
	if ids := day.GetIds(); len(ids) != 1 || ids[0] != oldest || day.GetPageInfo().GetTotalItems() != 1 {
		t.Fatalf("5 Nov = %v (total %d), want [%d]", ids, day.GetPageInfo().GetTotalItems(), oldest)
	}

	if n := page("", "2026-11-04").GetPageInfo().GetTotalItems(); n != 0 {
		t.Fatalf("to 4 Nov: %d changes, want 0 — 23:30 UTC on the 4th is the 5th in Jakarta", n)
	}

	if n := page("2026-11-06", "").GetPageInfo().GetTotalItems(); n != 10 {
		t.Fatalf("from 6 Nov: %d changes, want 10", n)
	}

	_, err = svc.LiabilityTermsHistoryList(context.Background(),
		connect.NewRequest(&liabilityv1.LiabilityTermsHistoryListRequest{
			TeamId: warehouse,
			Filter: &liabilityv1.LiabilityTermsHistoryListFilter{From: "2026-11-31"},
			Page:   &commonv1.CommonPagination{Page: 1, Limit: 10},
		}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("30 days hath November: err = %v, want InvalidArgument", err)
	}
}
