package financial_account_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	financial_accountv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	m "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_service_models"
	financial_account_v1 "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_v1"
)

func shopSet(svc *financial_account_v1.Service, team, shop, account uint64) (*financial_accountv1.FinancialAccountShopSetResponse, error) {
	resp, err := svc.FinancialAccountShopSet(asAni(), connect.NewRequest(&financial_accountv1.FinancialAccountShopSetRequest{
		TeamId: team, ShopId: shop, AccountId: account,
	}))
	if err != nil {
		return nil, err
	}

	return resp.Msg, nil
}

// a-shop-has-one-account: pointing a shop MOVES it, and the answer names where it was.
func TestFinancialAccountShopSet_MovesTheShop(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	ops := mustCreate(t, svc, bca(teamA, "BCA Ops", "9400000001", 0))
	gaji := mustCreate(t, svc, bca(teamA, "BCA Gaji", "9400000002", 0))

	first, err := shopSet(svc, teamA, 501, ops.GetId())
	if err != nil || first.GetPreviousAccountId() != 0 {
		t.Fatalf("first = %+v, %v", first, err)
	}

	moved, err := shopSet(svc, teamA, 501, gaji.GetId())
	if err != nil {
		t.Fatalf("move: %v", err)
	}

	if moved.GetPreviousAccountId() != ops.GetId() || moved.GetAccount().GetShopIds()[0] != 501 {
		t.Fatalf("moved = %+v", moved)
	}

	var count int64
	db.Model(&m.ShopAccount{}).Where("shop_id = ?", 501).Count(&count)

	if count != 1 {
		t.Fatalf("shop 501 has %d rows", count)
	}
}

// ⚠ The shop is asked of its own service: another team's shop is refused, so no admin can take another
// team's withdrawals.
func TestFinancialAccountShopSet_RefusesAnotherTeamsShop(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	ops := mustCreate(t, svc, bca(teamA, "BCA Ops", "9400000003", 0))

	_, err := shopSet(svc, teamA, 601, ops.GetId())
	if code := connectCode(t, err); code != connect.CodeNotFound {
		t.Fatalf("code = %v, want NotFound", code)
	}
}

func TestFinancialAccountShopSet_RefusesAnUnknownOrArchivedAccount(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	unknown := m.FinancialAccount{TeamID: teamA, Type: m.TypeUnknown, Provider: m.ProviderUnknown, Status: m.StatusActive, Name: "Unknown — shop #502"}
	if err := db.Create(&unknown).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}

	_, err := shopSet(svc, teamA, 501, unknown.ID)
	if code := connectCode(t, err); code != connect.CodeInvalidArgument {
		t.Fatalf("unknown: code = %v", code)
	}

	gone := mustCreate(t, svc, cash(teamA, "Gone", 0))
	if _, err := svc.FinancialAccountArchive(asAni(), connect.NewRequest(&financial_accountv1.FinancialAccountArchiveRequest{TeamId: teamA, AccountId: gone.GetId()})); err != nil {
		t.Fatalf("archive: %v", err)
	}

	_, err = shopSet(svc, teamA, 501, gone.GetId())
	if code := connectCode(t, err); code != connect.CodeFailedPrecondition {
		t.Fatalf("archived: code = %v", code)
	}
}
