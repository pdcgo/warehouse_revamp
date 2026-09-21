package liability_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

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
	svc := liability_v1.NewService(db)

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
		t.Fatalf("balance = %d, want 15000", msg.GetBalance())
	}
}

// A FEE AND ITS REVERSAL READ AS ONE STORY: both visible, netting to zero. That is exactly what a
// compensating entry buys over a delete — "the fee briefly existed" is what an audit needs to see.
func TestEntryList_AFeeAndItsReversalBothStay(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db)

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
		t.Fatalf("balance = %d after a reversal, want 0", msg.GetBalance())
	}
}

// A pair that has never traded reads as ZERO, not as an error: "we have never traded" and "we are
// square" are the same answer to the question this screen asks.
func TestEntryList_AnUntradedPairIsSquareRatherThanMissing(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db)

	msg := history(t, svc, selling, 12345)

	if len(entryRows(msg)) != 0 || msg.GetBalance() != 0 {
		t.Fatalf("entries=%d balance=%d, want an empty, square history",
			len(entryRows(msg)), msg.GetBalance())
	}
}

// ⚠ `counterparty_id` IS NOT THE SCOPE. Naming a pair the caller is not part of returns nothing —
// it can never reach two other teams' books.
func TestEntryList_CannotReadTwoOtherTeamsPair(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db)

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
