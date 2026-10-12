package liability_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	liabilityv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/liability/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	liability_v1 "github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_v1"
)

func deleteTerms(t *testing.T, svc *liability_v1.Service, teamID, counterpartyID uint64) {
	t.Helper()

	_, err := svc.LiabilityTermsDelete(context.Background(),
		connect.NewRequest(&liabilityv1.LiabilityTermsDeleteRequest{
			TeamId:         teamID,
			CounterpartyId: counterpartyID,
		}))
	if err != nil {
		t.Fatalf("LiabilityTermsDelete(%d -> %d): %v", teamID, counterpartyID, err)
	}
}

// DELETING AN OVERRIDE DROPS THE DEBTOR BACK TO THE DEFAULT ROW. That is the point of having a
// default at all — removing a team's special rate must not leave it uncharged.
func TestTermsDelete_FallsBackToTheDefaultRow(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db)

	putTerms(t, svc, warehouse, 0, 9000, 1000, nil)
	putTerms(t, svc, warehouse, selling, 12000, 2000, nil)

	deleteTerms(t, svc, warehouse, selling)

	rows := termsRows(termsList(t, svc, warehouse))

	if _, ok := rows[selling]; ok {
		t.Fatal("the override survived the delete")
	}

	if rows[0].GetHandlingFee() != 9000 {
		t.Fatalf("default handling_fee = %d, want 9000 — the default must survive", rows[0].GetHandlingFee())
	}
}

// ⚠ THIS IS THE ONLY WAY BACK TO "NO LIMIT AT ALL" once terms exist, because `0` already means the
// opposite (no credit whatsoever). Deleting restores the ABSENCE that means unlimited.
func TestTermsDelete_RestoresUnlimitedCredit(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db)

	putTerms(t, svc, warehouse, selling, 0, 0, rupiah(0))

	deleteTerms(t, svc, warehouse, selling)

	if _, ok := termsRows(termsList(t, svc, warehouse))[selling]; ok {
		t.Fatal("the frozen-credit row survived — the team is still frozen")
	}
}

// DELETING WHAT IS NOT THERE SUCCEEDS. The caller asked for a state — "this pair has no override" —
// and that state holds either way. A retry after a timeout must not fail because the first attempt
// worked.
func TestTermsDelete_IsIdempotent(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db)

	putTerms(t, svc, warehouse, selling, 12000, 2000, nil)

	deleteTerms(t, svc, warehouse, selling)
	deleteTerms(t, svc, warehouse, selling)
}

// ⚠ A RATE CHANGE NEVER REWRITES HISTORY. Terms decide what FUTURE postings charge; entries already
// written are immutable facts about money that moved. A delete that also unwound past fees would be
// editing the books to match a configuration change.
func TestTermsDelete_LeavesPostedEntriesAlone(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db)

	putTerms(t, svc, warehouse, selling, 12000, 2000, nil)

	_, err := svc.PostEntry(context.Background(), db, codFee(15000, 77))
	if err != nil {
		t.Fatalf("fee: %v", err)
	}

	deleteTerms(t, svc, warehouse, selling)

	if got := history(t, svc, warehouse, selling).GetBalance(); got != 15000 {
		t.Fatalf("balance = %d after deleting terms, want 15000 — the ledger was rewritten", got)
	}
}
