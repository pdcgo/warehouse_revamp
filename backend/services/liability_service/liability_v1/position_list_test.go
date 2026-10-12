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

func positions(
	t *testing.T,
	svc *liability_v1.Service,
	teamID uint64,
	unsettledOnly bool,
) *liabilityv1.LiabilityPositionListResponse {
	t.Helper()

	res, err := svc.LiabilityPositionList(context.Background(),
		connect.NewRequest(&liabilityv1.LiabilityPositionListRequest{
			TeamId: teamID,
			Filter: &liabilityv1.LiabilityPositionListFilter{UnsettledOnly: unsettledOnly},
			Page:   &commonv1.CommonPagination{Page: 1, Limit: 50},
		}))
	if err != nil {
		t.Fatalf("LiabilityPositionList(team=%d): %v", teamID, err)
	}

	return res.Msg
}

// BOTH DIRECTIONS, ONE LIST, and the sign is what says which way round it is. A counterparty is one
// relationship — splitting "what they owe me" from "what I owe them" would make a manager visit two
// screens to answer one question.
func TestPositionList_ShowsBothDirectionsWithTheSignIntact(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db)

	const other uint64 = 7

	// The selling team owes the warehouse…
	_, err := svc.PostEntry(context.Background(), db, codFee(15000, 77))
	if err != nil {
		t.Fatalf("fee: %v", err)
	}

	// …and another team owes the selling team.
	_, err = svc.PostEntry(context.Background(), db, liability_v1.Posting{
		DebtorTeamID: other, CreditorTeamID: selling, Amount: 4000,
		SourceType: liability_v1.SourceTypeOrderFee, SourceID: 1,
	})
	if err != nil {
		t.Fatalf("second fee: %v", err)
	}

	msg := positions(t, svc, selling, false)

	if len(positionRows(msg)) != 2 {
		t.Fatalf("%d positions, want 2 — one relationship in each direction",
			len(positionRows(msg)))
	}

	byCounterparty := map[uint64]int64{}
	for _, p := range positionRows(msg) {
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
	svc := liability_v1.NewService(db)

	const newer uint64 = 7

	_, err := svc.PostEntry(context.Background(), db, codFee(15000, 77))
	if err != nil {
		t.Fatalf("old debt: %v", err)
	}

	// Nudge the older pair's clock backwards, since both are created within the same millisecond.
	err = db.Exec(
		`UPDATE liability_balances SET oldest_unsettled_at = NOW() - INTERVAL '47 days'
		 WHERE team_id = ? AND counterparty_id = ?`, selling, warehouse).Error
	if err != nil {
		t.Fatalf("age the debt: %v", err)
	}

	_, err = svc.PostEntry(context.Background(), db, liability_v1.Posting{
		DebtorTeamID: selling, CreditorTeamID: newer, Amount: 4000,
		SourceType: liability_v1.SourceTypeOrderFee, SourceID: 1,
	})
	if err != nil {
		t.Fatalf("new debt: %v", err)
	}

	got := positionRows(positions(t, svc, selling, false))

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
	svc := liability_v1.NewService(db)

	_, err := svc.PostEntry(context.Background(), db, codFee(15000, 77))
	if err != nil {
		t.Fatalf("fee: %v", err)
	}

	_, err = svc.PostEntry(context.Background(), db, liability_v1.Posting{
		DebtorTeamID: warehouse, CreditorTeamID: selling, Amount: 15000,
		SourceType: liability_v1.SourceTypePayment, SourceID: 1,
	})
	if err != nil {
		t.Fatalf("payment: %v", err)
	}

	if got := positions(t, svc, selling, false); len(positionRows(got)) != 1 {
		t.Fatalf("%d positions unfiltered, want the settled row still present",
			len(positionRows(got)))
	}

	got := positions(t, svc, selling, true)
	if len(positionRows(got)) != 0 {
		t.Fatalf("%d positions with unsettled_only, want 0", len(positionRows(got)))
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
	svc := liability_v1.NewService(db)

	const outsider uint64 = 7

	// A debt between two teams the caller has nothing to do with.
	_, err := svc.PostEntry(context.Background(), db, liability_v1.Posting{
		DebtorTeamID: outsider, CreditorTeamID: warehouse, Amount: 99000,
		SourceType: liability_v1.SourceTypeIncidentalFee, SourceID: 1,
	})
	if err != nil {
		t.Fatalf("outsiders' debt: %v", err)
	}

	res, err := svc.LiabilityPositionList(context.Background(),
		connect.NewRequest(&liabilityv1.LiabilityPositionListRequest{
			TeamId: selling,
			Filter: &liabilityv1.LiabilityPositionListFilter{CounterpartyId: warehouse},
			Page:   &commonv1.CommonPagination{Page: 1, Limit: 50},
		}))
	if err != nil {
		t.Fatalf("list: %v", err)
	}

	if len(positionRows(res.Msg)) != 0 {
		t.Fatalf("%d positions — a filter reached a pair the caller is not part of",
			len(positionRows(res.Msg)))
	}
}

// summarizeOnePage asks for a deliberately SMALL page, which is the whole point: the tiles must
// report the set, not the window.
func summarizeOnePage(
	t *testing.T,
	svc *liability_v1.Service,
	teamID uint64,
	page, limit uint32,
) *liabilityv1.LiabilityPositionListResponse {
	t.Helper()

	res, err := svc.LiabilityPositionList(context.Background(),
		connect.NewRequest(&liabilityv1.LiabilityPositionListRequest{
			TeamId: teamID,
			Page:   &commonv1.CommonPagination{Page: page, Limit: limit},
		}))
	if err != nil {
		t.Fatalf("LiabilityPositionList(team=%d, page=%d): %v", teamID, page, err)
	}

	return res.Msg
}

// ⛔ THE BUG THIS EXISTS TO PREVENT. The screen used to reduce the rows it had loaded, so a creditor
// with more counterparties than fit on a page read a headline that silently omitted the rest — and
// turning to page 2 changed the "total". the-summary-is-tiles-on-the-list fixes the summary on a
// PAGINATED list, so it can never compute its own scope and the server has to hand it the whole set.
func TestPositionList_TheSummaryIsTheWHOLESetNotThePage(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db)

	// Three counterparties owe the selling team 1000, 2000 and 3000.
	for i, amount := range []int64{1000, 2000, 3000} {
		_, err := svc.PostEntry(context.Background(), db, liability_v1.Posting{
			DebtorTeamID: uint64(100 + i), CreditorTeamID: selling, Amount: amount,
			SourceType: liability_v1.SourceTypeOrderFee, SourceID: uint64(500 + i),
		})
		if err != nil {
			t.Fatalf("fee %d: %v", i, err)
		}
	}

	// …and the selling team owes the warehouse 400.
	_, err := svc.PostEntry(context.Background(), db, codFee(400, 901))
	if err != nil {
		t.Fatalf("payable: %v", err)
	}

	// ONE ROW PER PAGE. Every page must report the same totals.
	for page := uint32(1); page <= 4; page++ {
		msg := summarizeOnePage(t, svc, selling, page, 1)

		if got := msg.GetTotalReceivable(); got != 6000 {
			t.Fatalf("page %d: total_receivable = %d, want 6000 — the summary is reading the page",
				page, got)
		}

		// ⚠ A POSITIVE MAGNITUDE. Direction is words on this screen, never a sign, so the wire hands
		// the tile the number it renders rather than one it must remember to negate.
		if got := msg.GetTotalPayable(); got != 400 {
			t.Fatalf("page %d: total_payable = %d, want 400 (a magnitude, not -400)", page, got)
		}
	}
}

// The oldest tile names a TEAM, not just an age — so the id has to travel with the timestamp.
func TestPositionList_TheOldestTileKnowsWhoseDebtItIs(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db)

	_, err := svc.PostEntry(context.Background(), db, liability_v1.Posting{
		DebtorTeamID: 101, CreditorTeamID: selling, Amount: 1000,
		SourceType: liability_v1.SourceTypeOrderFee, SourceID: 601,
	})
	if err != nil {
		t.Fatalf("fee: %v", err)
	}

	msg := summarizeOnePage(t, svc, selling, 1, 50)

	if got := msg.GetOldestUnsettledCounterpartyId(); got != 101 {
		t.Fatalf("oldest counterparty = %d, want 101", got)
	}

	if msg.GetOldestUnsettledAtUnix() == 0 {
		t.Fatal("oldest_unsettled_at = 0 with an outstanding debt")
	}
}

// A team that owes nobody reports zeros rather than failing. `SUM` over no rows is NULL, and the
// oldest lookup finds nothing — both are ordinary, and neither is an error.
func TestPositionList_AnEmptySetSummarizesToZero(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db)

	msg := summarizeOnePage(t, svc, 4242, 1, 50)

	if msg.GetTotalReceivable() != 0 || msg.GetTotalPayable() != 0 {
		t.Fatalf("receivable = %d, payable = %d, want 0/0",
			msg.GetTotalReceivable(), msg.GetTotalPayable())
	}

	if msg.GetOldestUnsettledCounterpartyId() != 0 || msg.GetOldestUnsettledAtUnix() != 0 {
		t.Fatalf("oldest = %d/%d, want 0/0 — nothing is outstanding",
			msg.GetOldestUnsettledCounterpartyId(), msg.GetOldestUnsettledAtUnix())
	}
}
