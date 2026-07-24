package settlement_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	settlementv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	settlement_v1 "github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_v1"
)

func positions(
	t *testing.T,
	svc *settlement_v1.Service,
	teamID uint64,
	unsettledOnly bool,
) *settlementv1.SettlementPositionListResponse {
	t.Helper()

	res, err := svc.SettlementPositionList(context.Background(),
		connect.NewRequest(&settlementv1.SettlementPositionListRequest{
			TeamId:        teamID,
			Page:          &commonv1.PageFilter{Page: 1, Limit: 50},
			UnsettledOnly: unsettledOnly,
		}))
	if err != nil {
		t.Fatalf("SettlementPositionList(team=%d): %v", teamID, err)
	}

	return res.Msg
}

// BOTH DIRECTIONS, ONE LIST, and the sign is what says which way round it is. A counterparty is one
// relationship — splitting "what they owe me" from "what I owe them" would make a manager visit two
// screens to answer one question.
func TestPositionList_ShowsBothDirectionsWithTheSignIntact(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db)

	const other uint64 = 7

	// The selling team owes the warehouse…
	_, err := svc.PostEntry(context.Background(), db, codFee(15000, 77))
	if err != nil {
		t.Fatalf("fee: %v", err)
	}

	// …and another team owes the selling team.
	_, err = svc.PostEntry(context.Background(), db, settlement_v1.Posting{
		DebtorTeamID: other, CreditorTeamID: selling, Amount: 4000,
		SourceType: settlement_v1.SourceTypeHandlingFee, SourceID: 1,
	})
	if err != nil {
		t.Fatalf("second fee: %v", err)
	}

	msg := positions(t, svc, selling, false)

	if len(msg.GetPositions()) != 2 {
		t.Fatalf("%d positions, want 2 — one relationship in each direction",
			len(msg.GetPositions()))
	}

	byCounterparty := map[uint64]int64{}
	for _, p := range msg.GetPositions() {
		byCounterparty[p.GetCounterpartyId()] = p.GetBalance()
	}

	if byCounterparty[warehouse] != -15000 {
		t.Fatalf("owed to the warehouse = %d, want -15000 (a payable is negative)",
			byCounterparty[warehouse])
	}

	if byCounterparty[other] != 4000 {
		t.Fatalf("owed by team %d = %d, want +4000 (a receivable is positive)",
			other, byCounterparty[other])
	}
}

// AGEING IS THE POINT OF THIS SCREEN, so the oldest debt comes first — a manager opened it to chase
// the old ones, and making them scroll for that answers a different question.
func TestPositionList_OrdersTheOldestDebtFirst(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db)

	const newer uint64 = 7

	_, err := svc.PostEntry(context.Background(), db, codFee(15000, 77))
	if err != nil {
		t.Fatalf("old debt: %v", err)
	}

	// Nudge the older pair's clock backwards, since both are created within the same millisecond.
	err = db.Exec(
		`UPDATE settlement_balances SET oldest_unsettled_at = NOW() - INTERVAL '47 days'
		 WHERE team_id = ? AND counterparty_id = ?`, selling, warehouse).Error
	if err != nil {
		t.Fatalf("age the debt: %v", err)
	}

	_, err = svc.PostEntry(context.Background(), db, settlement_v1.Posting{
		DebtorTeamID: selling, CreditorTeamID: newer, Amount: 4000,
		SourceType: settlement_v1.SourceTypeHandlingFee, SourceID: 1,
	})
	if err != nil {
		t.Fatalf("new debt: %v", err)
	}

	got := positions(t, svc, selling, false).GetPositions()

	if got[0].GetCounterpartyId() != warehouse {
		t.Fatalf("first row is counterparty %d, want the 47-day-old debt (%d)",
			got[0].GetCounterpartyId(), warehouse)
	}

	// A TIMESTAMP, not a server-computed day count: a rollup has to name its timezone, and the
	// reader's is the only one that means anything to them.
	if got[0].GetOldestUnsettledAtUnix() == 0 {
		t.Fatal("no ageing timestamp on an outstanding debt")
	}
}

// A settled pair keeps its row forever — the ledger never deletes anything — so the default view
// would fill with zeros and bury the rows somebody opened the screen for.
func TestPositionList_CanHideSettledPairs(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db)

	_, err := svc.PostEntry(context.Background(), db, codFee(15000, 77))
	if err != nil {
		t.Fatalf("fee: %v", err)
	}

	_, err = svc.PostEntry(context.Background(), db, settlement_v1.Posting{
		DebtorTeamID: warehouse, CreditorTeamID: selling, Amount: 15000,
		SourceType: settlement_v1.SourceTypePayment, SourceID: 1,
	})
	if err != nil {
		t.Fatalf("payment: %v", err)
	}

	if got := positions(t, svc, selling, false); len(got.GetPositions()) != 1 {
		t.Fatalf("%d positions unfiltered, want the settled row still present",
			len(got.GetPositions()))
	}

	got := positions(t, svc, selling, true)
	if len(got.GetPositions()) != 0 {
		t.Fatalf("%d positions with unsettled_only, want 0", len(got.GetPositions()))
	}

	// The count must follow the filter too, or the pager reports rows the screen will not show.
	if got.GetPageInfo().GetTotalItems() != 0 {
		t.Fatalf("total_items = %d with unsettled_only, want 0",
			got.GetPageInfo().GetTotalItems())
	}
}

// ⚠ THE SCOPE IS `team_id` AND ONLY `team_id`. Naming somebody else's counterparty narrows the
// caller's OWN rows — it can never reach a pair the caller is not part of.
func TestPositionList_ACounterpartyFilterIsNotAScope(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db)

	const outsider uint64 = 7

	// A debt between two teams the caller has nothing to do with.
	_, err := svc.PostEntry(context.Background(), db, settlement_v1.Posting{
		DebtorTeamID: outsider, CreditorTeamID: warehouse, Amount: 99000,
		SourceType: settlement_v1.SourceTypeCODFee, SourceID: 1,
	})
	if err != nil {
		t.Fatalf("outsiders' debt: %v", err)
	}

	res, err := svc.SettlementPositionList(context.Background(),
		connect.NewRequest(&settlementv1.SettlementPositionListRequest{
			TeamId:         selling,
			Page:           &commonv1.PageFilter{Page: 1, Limit: 50},
			CounterpartyId: warehouse,
		}))
	if err != nil {
		t.Fatalf("list: %v", err)
	}

	if len(res.Msg.GetPositions()) != 0 {
		t.Fatalf("%d positions — a filter reached a pair the caller is not part of",
			len(res.Msg.GetPositions()))
	}
}
