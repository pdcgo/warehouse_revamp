package liability_v1_test

import (
	"context"
	"fmt"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	liabilityv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/liability/v1"
	teamv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/team/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_service_models"
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
	svc := liability_v1.NewService(db, nil, nil, nil)

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

	byCounterparty := map[uint64]float64{}
	for _, p := range positionRows(msg) {
		byCounterparty[p.GetCounterpartyId()] = p.GetBalance()
	}

	if byCounterparty[warehouse] != -15000 {
		t.Fatalf("owed to the warehouse = %v, want -15000 (a payable is negative)",
			byCounterparty[warehouse])
	}

	if byCounterparty[other] != 4000 {
		t.Fatalf("owed by team %v = %v, want +4000 (a receivable is positive)",
			other, byCounterparty[other])
	}
}

// AGEING IS THE POINT OF THIS SCREEN, so the oldest debt comes first — a manager opened it to chase
// the old ones, and making them scroll for that answers a different question.
func TestPositionList_OrdersTheOldestDebtFirst(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, nil, nil)

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
	svc := liability_v1.NewService(db, nil, nil, nil)

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
	svc := liability_v1.NewService(db, nil, nil, nil)

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
	svc := liability_v1.NewService(db, nil, nil, nil)

	// Three counterparties owe the selling team 1000, 2000 and 3000.
	for i, amount := range []float64{1000, 2000, 3000} {
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
			t.Fatalf("page %v: total_receivable = %v, want 6000 — the summary is reading the page",
				page, got)
		}

		// ⚠ A POSITIVE MAGNITUDE. Direction is words on this screen, never a sign, so the wire hands
		// the tile the number it renders rather than one it must remember to negate.
		if got := msg.GetTotalPayable(); got != 400 {
			t.Fatalf("page %v: total_payable = %v, want 400 (a magnitude, not -400)", page, got)
		}
	}
}

// The oldest tile names a TEAM, not just an age — so the id has to travel with the timestamp.
func TestPositionList_TheOldestTileKnowsWhoseDebtItIs(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, nil, nil)

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
	svc := liability_v1.NewService(db, nil, nil, nil)

	msg := summarizeOnePage(t, svc, 4242, 1, 50)

	if msg.GetTotalReceivable() != 0 || msg.GetTotalPayable() != 0 {
		t.Fatalf("receivable = %v, payable = %v, want 0/0",
			msg.GetTotalReceivable(), msg.GetTotalPayable())
	}

	if msg.GetOldestUnsettledCounterpartyId() != 0 || msg.GetOldestUnsettledAtUnix() != 0 {
		t.Fatalf("oldest = %d/%d, want 0/0 — nothing is outstanding",
			msg.GetOldestUnsettledCounterpartyId(), msg.GetOldestUnsettledAtUnix())
	}
}

// ── the row filters run BEFORE THE PAGE (backlog #34) ───────────────────────────────────────────────────────────

// pairsFilterSeed gives `selling` 25 debtors — more than the 20 a page holds — named by team_service as "Toko <id>",
// all selling teams, except the LAST one posted: "Gudang Kenanga", code GKN, a warehouse. Every debt is posted in the
// test's one transaction, so the ages tie and `id` orders them: Kenanga is row 25, on page 2 of the unfiltered list.
func pairsFilterSeed(t *testing.T, db *gorm.DB) (*liability_v1.Service, uint64) {
	t.Helper()

	names := &fakeNames{facts: map[uint64]liability_v1.TeamFact{}}
	svc := liability_v1.NewService(db, nil, nil, names)

	var kenanga uint64

	for i := 0; i < 25; i++ {
		debtor := uint64(1000 + i)

		_, err := svc.PostEntry(context.Background(), db, liability_v1.Posting{
			DebtorTeamID: debtor, CreditorTeamID: selling, Amount: float64(1000 + i),
			SourceType: liability_v1.SourceTypeOrderFee, SourceID: uint64(70000 + i),
		})
		if err != nil {
			t.Fatalf("seed %d: %v", i, err)
		}

		names.facts[debtor] = liability_v1.TeamFact{
			Name: fmt.Sprintf("Toko %d", debtor), Code: fmt.Sprintf("T%d", debtor), Type: teamv1.TeamType_TEAM_TYPE_SELLING,
		}
		kenanga = debtor
	}

	names.facts[kenanga] = liability_v1.TeamFact{Name: "Gudang Kenanga", Code: "GKN", Type: teamv1.TeamType_TEAM_TYPE_WAREHOUSE}

	return svc, kenanga
}

func pairsFiltered(
	t *testing.T,
	svc *liability_v1.Service,
	filter *liabilityv1.LiabilityPositionListFilter,
) *liabilityv1.LiabilityPositionListResponse {
	t.Helper()

	res, err := svc.LiabilityPositionList(context.Background(),
		connect.NewRequest(&liabilityv1.LiabilityPositionListRequest{
			TeamId: selling,
			Filter: filter,
			Page:   &commonv1.CommonPagination{Page: 1, Limit: 20},
		}))
	if err != nil {
		t.Fatalf("LiabilityPositionList: %v", err)
	}

	return res.Msg
}

// ⛔ THE BUG #34 RETIRES. The search narrowed the 20 rows the screen had loaded, so a counterparty on page 2 read as "no
// team found". The server searches the whole set first: Kenanga is row 25 and page 1 of the search finds it — by name,
// in any case, and by its code.
func TestPositionList_ASearchFindsAPairOnPage2(t *testing.T) {
	db := san_testdb.DB(t)
	svc, kenanga := pairsFilterSeed(t, db)

	// Unfiltered, page 1 is the first 20 — Kenanga is not on it.
	for _, p := range positionRows(pairsFiltered(t, svc, nil)) {
		if p.GetCounterpartyId() == kenanga {
			t.Fatal("the seed is wrong: Kenanga is already on page 1")
		}
	}

	for _, q := range []string{"kenanga", "  KENANGA ", "gkn"} {
		got := pairsFiltered(t, svc, &liabilityv1.LiabilityPositionListFilter{Q: q})

		rows := positionRows(got)
		if len(rows) != 1 || rows[0].GetCounterpartyId() != kenanga {
			t.Fatalf("q=%q found %d rows, want Kenanga (%d) alone", q, len(rows), kenanga)
		}

		// The pager counts what the search found, not the whole list.
		if got.GetPageInfo().GetTotalItems() != 1 {
			t.Fatalf("q=%q total_items = %d, want 1", q, got.GetPageInfo().GetTotalItems())
		}
	}

	none := pairsFiltered(t, svc, &liabilityv1.LiabilityPositionListFilter{Q: "melati"})
	if len(none.GetIds()) != 0 || none.GetPageInfo().GetTotalItems() != 0 {
		t.Fatalf("a search matching no team returned %d rows (total %d)", len(none.GetIds()), none.GetPageInfo().GetTotalItems())
	}
}

// The team type filters before the page too: the one warehouse is row 25 and the Warehouse pick finds it alone; Selling
// leaves 24 — the 20 of page 1 and a total of 24.
func TestPositionList_TheKindFilterNarrowsBeforeThePage(t *testing.T) {
	db := san_testdb.DB(t)
	svc, kenanga := pairsFilterSeed(t, db)

	warehouses := pairsFiltered(t, svc, &liabilityv1.LiabilityPositionListFilter{
		CounterpartyType: teamv1.TeamType_TEAM_TYPE_WAREHOUSE,
	})
	if ids := warehouses.GetIds(); len(ids) != 1 || ids[0] != kenanga {
		t.Fatalf("warehouses = %v, want [%d]", ids, kenanga)
	}

	sellers := pairsFiltered(t, svc, &liabilityv1.LiabilityPositionListFilter{
		CounterpartyType: teamv1.TeamType_TEAM_TYPE_SELLING,
	})
	if len(sellers.GetIds()) != 20 || sellers.GetPageInfo().GetTotalItems() != 24 {
		t.Fatalf("sellers: %d rows, total %d — want 20 of 24", len(sellers.GetIds()), sellers.GetPageInfo().GetTotalItems())
	}

	// Both at once: a selling team called Kenanga does not exist.
	both := pairsFiltered(t, svc, &liabilityv1.LiabilityPositionListFilter{
		Q: "kenanga", CounterpartyType: teamv1.TeamType_TEAM_TYPE_SELLING,
	})
	if len(both.GetIds()) != 0 {
		t.Fatalf("search + kind returned %v, want none", both.GetIds())
	}
}

// ⚠ THE TILES ARE ALL BALANCE, NOT THE SEARCH (the-summary-is-tiles-on-the-list: *"a search box is not a scope"*). A
// search that leaves one row still reports what every counterparty owes, and the oldest debt across all of them.
func TestPositionList_TheSummaryIgnoresTheSearch(t *testing.T) {
	db := san_testdb.DB(t)
	svc, _ := pairsFilterSeed(t, db)

	whole := pairsFiltered(t, svc, nil)
	searched := pairsFiltered(t, svc, &liabilityv1.LiabilityPositionListFilter{
		Q: "kenanga", CounterpartyType: teamv1.TeamType_TEAM_TYPE_WAREHOUSE, AwaitingOnly: true,
	})

	if searched.GetTotalReceivable() != whole.GetTotalReceivable() || whole.GetTotalReceivable() == 0 {
		t.Fatalf("total_receivable = %v under a search, %v without — the tiles followed the search",
			searched.GetTotalReceivable(), whole.GetTotalReceivable())
	}

	if searched.GetOldestUnsettledCounterpartyId() != whole.GetOldestUnsettledCounterpartyId() {
		t.Fatalf("the oldest tile moved with the search: %d vs %d",
			searched.GetOldestUnsettledCounterpartyId(), whole.GetOldestUnsettledCounterpartyId())
	}
}

// A counterparty team_service does not know (deleted) has no name to match and no kind to be: it never matches a search
// or a kind — and still lists when nothing is filtered, as it always did.
func TestPositionList_AnUnknownTeamNeverMatchesAFilter(t *testing.T) {
	db := san_testdb.DB(t)
	svc, _ := pairsFilterSeed(t, db)

	const gone uint64 = 5000

	_, err := svc.PostEntry(context.Background(), db, liability_v1.Posting{
		DebtorTeamID: gone, CreditorTeamID: selling, Amount: 700,
		SourceType: liability_v1.SourceTypeOrderFee, SourceID: 79999,
	})
	if err != nil {
		t.Fatalf("seed: %v", err)
	}

	if got := pairsFiltered(t, svc, nil).GetPageInfo().GetTotalItems(); got != 26 {
		t.Fatalf("unfiltered total = %d, want 26 with the unknown team", got)
	}

	for _, filter := range []*liabilityv1.LiabilityPositionListFilter{
		{Q: "5000"},
		{CounterpartyType: teamv1.TeamType_TEAM_TYPE_SELLING},
	} {
		for _, id := range pairsFiltered(t, svc, filter).GetIds() {
			if id == gone {
				t.Fatalf("filter %v matched a team team_service does not know", filter)
			}
		}
	}
}

// "Awaiting my confirmation" was a client-side cut too. The one pair with a payment waiting on `selling` is row 25 —
// page 2 — and the filter finds it alone; a payment `selling` itself recorded, or one already accepted, does not count.
func TestPositionList_AwaitingOnlyNarrowsBeforeThePage(t *testing.T) {
	db := san_testdb.DB(t)
	svc, kenanga := pairsFilterSeed(t, db)

	for _, payment := range []liability_service_models.LiabilityPayment{
		{PayerTeamID: kenanga, CreditorTeamID: selling, Amount: 500, Status: "recorded"},
		// Accepted already — nothing to do.
		{PayerTeamID: 1000, CreditorTeamID: selling, Amount: 500, Status: "confirmed"},
		// Recorded BY selling — it waits on the other side, never in selling's inbox.
		{PayerTeamID: selling, CreditorTeamID: 1001, Amount: 500, Status: "recorded"},
	} {
		err := db.Create(&payment).Error
		if err != nil {
			t.Fatalf("seed payment: %v", err)
		}
	}

	got := pairsFiltered(t, svc, &liabilityv1.LiabilityPositionListFilter{AwaitingOnly: true})
	if ids := got.GetIds(); len(ids) != 1 || ids[0] != kenanga {
		t.Fatalf("awaiting only = %v, want [%d]", ids, kenanga)
	}

	if got.GetPageInfo().GetTotalItems() != 1 {
		t.Fatalf("total_items = %d, want 1", got.GetPageInfo().GetTotalItems())
	}
}

// The search asks team_service ONCE per call for the team's own pairs, and not at all when nothing is searched — the
// common case, every load of the list, costs no outside question.
func TestPositionList_OnlyASearchAsksTeamService(t *testing.T) {
	db := san_testdb.DB(t)
	names := &fakeNames{facts: map[uint64]liability_v1.TeamFact{}}
	svc := liability_v1.NewService(db, nil, nil, names)

	_, err := svc.PostEntry(context.Background(), db, codFee(15000, 77))
	if err != nil {
		t.Fatalf("fee: %v", err)
	}

	pairsFiltered(t, svc, &liabilityv1.LiabilityPositionListFilter{UnsettledOnly: true})

	if names.calls != 0 {
		t.Fatalf("team_service asked %d times for an unfiltered list, want 0", names.calls)
	}

	pairsFiltered(t, svc, &liabilityv1.LiabilityPositionListFilter{Q: "gudang"})

	if names.calls != 1 {
		t.Fatalf("team_service asked %d times for one search, want 1", names.calls)
	}
}
