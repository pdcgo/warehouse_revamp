package settlement_v1_test

import (
	"context"
	"fmt"
	"testing"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	settlementv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	settlement_v1 "github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_v1"
)

func list(
	t *testing.T,
	svc *settlement_v1.Service,
	req *settlementv1.OrderSettlementListRequest,
) *settlementv1.OrderSettlementListResponse {
	t.Helper()

	if req.GetTeamId() == 0 {
		req.TeamId = team
	}

	if req.GetFilter() == nil {
		req.Filter = &settlementv1.OrderSettlementListFilter{}
	}

	if req.GetPage() == nil {
		req.Page = &commonv1.CommonPagination{Page: 1, Limit: 50}
	}

	res, err := svc.OrderSettlementList(context.Background(), connect.NewRequest(req))
	if err != nil {
		t.Fatalf("OrderSettlementList: %v", err)
	}

	return res.Msg
}

// settleOrder opens an account on `orderID` and moves it to `balance`.
//
// ⚠ The keys are per-order. `unique_id` is unique across the WHOLE log (#00002), not scoped to the
// order, so a fixture reusing one literal for every order collides on the second one — which is the
// same mistake a real caller makes when its recipe does not identify what it is recording.
func settleOrder(t *testing.T, svc *settlement_v1.Service, orderID uint64, shopID uint64, balance int64) {
	t.Helper()

	_, err := post(t, svc, settlement_v1.PostInput{
		OrderID:        orderID,
		ShopID:         shopID,
		UniqueID:       fmt.Sprintf("open-%d", orderID),
		SettlementType: settlementv1.SettlementType_SETTLEMENT_TYPE_INITIAL_TOTAL,
		SourceType:     settlementv1.SourceType_SOURCE_TYPE_ORDER,
		Change:         -sale,
	})
	if err != nil {
		t.Fatalf("open %d: %v", orderID, err)
	}

	_, err = post(t, svc, settlement_v1.PostInput{
		OrderID:        orderID,
		ShopID:         shopID,
		UniqueID:       fmt.Sprintf("fund-%d", orderID),
		SettlementType: settlementv1.SettlementType_SETTLEMENT_TYPE_FUND,
		SourceType:     settlementv1.SourceType_SOURCE_TYPE_EXPORTER,
		Change:         sale + balance,
	})
	if err != nil {
		t.Fatalf("fund %d: %v", orderID, err)
	}
}

// ⚠ WORST FIRST, AND THAT IS THE DEFAULT. The screen exists to answer "which orders lost the most",
// so an unspecified sort must land on that question rather than on insertion order.
//
// Ascending looks wrong until the sign convention is remembered: a loss is a NEGATIVE balance, so the
// worst order is the smallest number.
func TestOrderSettlementList_RanksWorstLossFirstByDefault(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db)

	settleOrder(t, svc, 1, shop, -5_000)
	settleOrder(t, svc, 2, shop, -40_000)
	settleOrder(t, svc, 3, shop, -12_000)

	got := list(t, svc, &settlementv1.OrderSettlementListRequest{})

	want := []uint64{2, 3, 1}
	if len(got.GetIds()) != len(want) {
		t.Fatalf("%d ids, want %d", len(got.GetIds()), len(want))
	}

	for i, id := range want {
		if got.GetIds()[i] != id {
			t.Fatalf("ids = %v, want %v — the biggest loss must be first", got.GetIds(), want)
		}
	}
}

// ⚠ THE TOTALS ARE THE WHOLE FILTERED SET, NOT THE PAGE. A take-rate card that changed as you turned
// pages would be reporting the page, which nobody asked about.
func TestOrderSettlementList_TotalsCoverEveryPage(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db)

	settleOrder(t, svc, 1, shop, -5_000)
	settleOrder(t, svc, 2, shop, -40_000)
	settleOrder(t, svc, 3, shop, -12_000)

	firstPage := list(t, svc, &settlementv1.OrderSettlementListRequest{
		Page: &commonv1.CommonPagination{Page: 1, Limit: 1},
	})

	if len(firstPage.GetIds()) != 1 {
		t.Fatalf("%d ids on a limit-1 page, want 1", len(firstPage.GetIds()))
	}

	if firstPage.GetTotalLastBalance() != -57_000 {
		t.Errorf("total_last_balance = %d, want -57000 — the card must sum every row, not this page", firstPage.GetTotalLastBalance())
	}

	if firstPage.GetTotalInitialTotal() != 3*sale {
		t.Errorf("total_initial_total = %d, want %d", firstPage.GetTotalInitialTotal(), 3*sale)
	}

	if firstPage.GetPageInfo().GetTotalItems() != 3 {
		t.Errorf("total_items = %d, want 3", firstPage.GetPageInfo().GetTotalItems())
	}
}

// One team must never see another's accounts, and the list is where a scope bug would leak the most
// at once.
func TestOrderSettlementList_ScopesToTheTeam(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db)

	settleOrder(t, svc, 1, shop, -5_000)

	_, err := post(t, svc, settlement_v1.PostInput{
		TeamID:         team + 1,
		OrderID:        77,
		ShopID:         shop,
		UniqueID:       "other-team",
		SettlementType: settlementv1.SettlementType_SETTLEMENT_TYPE_INITIAL_TOTAL,
		SourceType:     settlementv1.SourceType_SOURCE_TYPE_ORDER,
		Change:         -sale,
	})
	if err != nil {
		t.Fatalf("other team's account: %v", err)
	}

	got := list(t, svc, &settlementv1.OrderSettlementListRequest{})

	for _, id := range got.GetIds() {
		if id == 77 {
			t.Fatal("another team's account appeared in this team's list")
		}
	}

	if got.GetPageInfo().GetTotalItems() != 1 {
		t.Errorf("total_items = %d, want 1", got.GetPageInfo().GetTotalItems())
	}
}

// The shop filter is not the scope — `team_id` is — but it is what every real read uses.
func TestOrderSettlementList_FiltersByShop(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db)

	settleOrder(t, svc, 1, shop, -5_000)
	settleOrder(t, svc, 2, shop+1, -40_000)

	got := list(t, svc, &settlementv1.OrderSettlementListRequest{
		Filter: &settlementv1.OrderSettlementListFilter{ShopId: shop + 1},
	})

	if len(got.GetIds()) != 1 || got.GetIds()[0] != 2 {
		t.Fatalf("ids = %v, want [2]", got.GetIds())
	}
}

// A caller that asked for no slice still gets the accounts — the alternative is an empty screen
// whenever a client forgets the enum, which reads as "this team has never settled anything".
func TestOrderSettlementList_ReturnsAccountsWithoutADataRequest(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db)

	settleOrder(t, svc, 1, shop, -5_000)

	got := list(t, svc, &settlementv1.OrderSettlementListRequest{})

	if len(got.GetItems()) == 0 {
		t.Fatal("no slices returned")
	}

	settlements := got.GetItems()[0].GetSettlement().GetMapData()
	if settlements[1].GetLastBalance() != -5_000 {
		t.Errorf("account 1 balance = %d, want -5000", settlements[1].GetLastBalance())
	}
}
