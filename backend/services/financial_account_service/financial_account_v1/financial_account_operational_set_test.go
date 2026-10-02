package financial_account_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	financial_accountv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	m "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_service_models"
)

// operational-accounts-pay-for-operations — marked once, however often it is asked; unmarked as easily.
func TestFinancialAccountOperationalSet_MarksIdempotentlyAndUnmarks(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	a := mustCreate(t, svc, cash(teamA, "Kas", 0))

	set := func(operational bool) *financial_accountv1.FinancialAccount {
		resp, err := svc.FinancialAccountOperationalSet(asAni(), connect.NewRequest(&financial_accountv1.FinancialAccountOperationalSetRequest{
			TeamId: teamA, AccountId: a.GetId(), Operational: operational,
		}))
		if err != nil {
			t.Fatalf("set %v: %v", operational, err)
		}

		return resp.Msg.GetAccount()
	}

	if !set(true).GetOperational() || !set(true).GetOperational() {
		t.Fatal("not marked")
	}

	var count int64
	db.Model(&m.OperationalAccount{}).Where("account_id = ?", a.GetId()).Count(&count)

	if count != 1 {
		t.Fatalf("marked %d times", count)
	}

	if set(false).GetOperational() {
		t.Fatal("still marked")
	}
}

func TestFinancialAccountOperationalSet_AnUnknownAccountCannotPay(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	unknown := m.FinancialAccount{TeamID: teamA, Type: m.TypeUnknown, Provider: m.ProviderUnknown, Status: m.StatusActive, Name: "Unknown — shop #501"}
	if err := db.Create(&unknown).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}

	_, err := svc.FinancialAccountOperationalSet(asAni(), connect.NewRequest(&financial_accountv1.FinancialAccountOperationalSetRequest{
		TeamId: teamA, AccountId: unknown.ID, Operational: true,
	}))
	if code := connectCode(t, err); code != connect.CodeInvalidArgument {
		t.Fatalf("code = %v, want InvalidArgument", code)
	}
}
