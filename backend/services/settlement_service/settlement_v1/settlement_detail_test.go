package settlement_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	settlementv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	settlement_v1 "github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_v1"
)

func detail(
	t *testing.T,
	svc *settlement_v1.Service,
	teamID, orderID uint64,
) (*settlementv1.OrderSettlementDetailResponse, error) {
	t.Helper()

	res, err := svc.OrderSettlementDetail(
		context.Background(),
		connect.NewRequest(&settlementv1.OrderSettlementDetailRequest{
			TeamId:  teamID,
			OrderId: orderID,
		}),
	)
	if err != nil {
		return nil, err
	}

	return res.Msg, nil
}

// THE PANEL DRAWS A RUNNING BALANCE DOWNWARD, so the log must come back oldest first. Newest first
// would show a running total that appears to count backwards, which reads as corrupted data.
func TestOrderSettlementDetail_ReturnsTheLogOldestFirst(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db)

	_, err := post(t, svc, initialTotal("order-5001-initial"))
	if err != nil {
		t.Fatalf("initial_total: %v", err)
	}

	_, err = post(t, svc, settlement_v1.PostInput{
		UniqueID:       "stmt-aug-fund",
		SettlementType: settlementv1.SettlementType_SETTLEMENT_TYPE_FUND,
		SourceType:     settlementv1.SourceType_SOURCE_TYPE_EXPORTER,
		Change:         arrived,
	})
	if err != nil {
		t.Fatalf("fund: %v", err)
	}

	got, err := detail(t, svc, team, order)
	if err != nil {
		t.Fatalf("OrderSettlementDetail: %v", err)
	}

	if len(got.GetEntries()) != 2 {
		t.Fatalf("%d entries, want 2", len(got.GetEntries()))
	}

	first := got.GetEntries()[0]
	if first.GetSettlementType() != settlementv1.SettlementType_SETTLEMENT_TYPE_INITIAL_TOTAL {
		t.Errorf("first entry is %v, want the opening sale — the log must read oldest first", first.GetSettlementType())
	}

	// The running balance must climb the way it was built: −120.000 then −10.000.
	if first.GetBalance() != -sale {
		t.Errorf("first balance = %d, want %d", first.GetBalance(), -sale)
	}

	if got.GetEntries()[1].GetBalance() != -sale+arrived {
		t.Errorf("second balance = %d, want %d", got.GetEntries()[1].GetBalance(), -sale+arrived)
	}

	if got.GetSettlement().GetInitialTotal() != sale {
		t.Errorf("initial_total = %d, want the POSITIVE sale %d", got.GetSettlement().GetInitialTotal(), sale)
	}
}

// ⚠ ABSENT IS NOT EMPTY. An order never settled is a different statement from one settled to zero, and
// returning a zeroed row would render as a completed settlement that nobody performed.
func TestOrderSettlementDetail_DistinguishesNeverSettledFromZero(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db)

	_, err := detail(t, svc, team, 999_999)
	if err == nil {
		t.Fatal("an order with no account returned a settlement — that reads as settled to zero")
	}

	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Errorf("code = %v, want NotFound", connect.CodeOf(err))
	}
}

// The scope proves the caller's team; this proves the ACCOUNT's. Without it an order id is enough to
// read another team's ledger.
func TestOrderSettlementDetail_RefusesAnotherTeamsAccount(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db)

	_, err := post(t, svc, initialTotal("order-5001-initial"))
	if err != nil {
		t.Fatalf("initial_total: %v", err)
	}

	_, err = detail(t, svc, team+1, order)
	if err == nil {
		t.Fatal("another team read this account")
	}

	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Errorf("code = %v, want PermissionDenied", connect.CodeOf(err))
	}
}
