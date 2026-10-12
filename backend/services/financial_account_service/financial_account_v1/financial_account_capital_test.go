package financial_account_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	financial_accountv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	m "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_service_models"
)

// capital-joins-the-types — a direction and a positive amount; the sign is the service's.
func TestFinancialAccountCapital_InAndOutAreSignedByDirection(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	a := mustCreate(t, svc, bca(teamA, "BCA", "9100000001", 1_000))

	for _, c := range []struct {
		direction financial_accountv1.CapitalDirection
		amount    float64
		want      float64
		label     string
	}{
		{financial_accountv1.CapitalDirection_CAPITAL_DIRECTION_IN, 500, 500, "Capital in — top-up"},
		{financial_accountv1.CapitalDirection_CAPITAL_DIRECTION_OUT, 200, -200, "Capital out — top-up"},
	} {
		resp, err := svc.FinancialAccountCapital(asAni(), connect.NewRequest(&financial_accountv1.FinancialAccountCapitalRequest{
			TeamId: teamA, AccountId: a.GetId(), Direction: c.direction, Amount: c.amount, OccurredOn: day(1), Note: "top-up",
		}))
		if err != nil {
			t.Fatalf("capital: %v", err)
		}

		if resp.Msg.GetLog().GetChange() != c.want || resp.Msg.GetLog().GetDescription() != c.label {
			t.Fatalf("row = %+v", resp.Msg.GetLog())
		}
	}

	if balance(t, db, a.GetId()) != 1_300 {
		t.Fatalf("balance = %v", balance(t, db, a.GetId()))
	}
}

func TestFinancialAccountCapital_RefusesNoDirectionAndAnUnknownAccount(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	a := mustCreate(t, svc, cash(teamA, "Kas", 0))

	_, err := svc.FinancialAccountCapital(asAni(), connect.NewRequest(&financial_accountv1.FinancialAccountCapitalRequest{
		TeamId: teamA, AccountId: a.GetId(), Amount: 10, OccurredOn: day(0),
	}))
	if code := connectCode(t, err); code != connect.CodeInvalidArgument {
		t.Fatalf("no direction: code = %v", code)
	}

	unknown := m.FinancialAccount{TeamID: teamA, Type: m.TypeUnknown, Provider: m.ProviderUnknown, Status: m.StatusActive, Name: "Unknown — shop #502"}
	if err := db.Create(&unknown).Error; err != nil {
		t.Fatalf("seed unknown: %v", err)
	}

	_, err = svc.FinancialAccountCapital(asAni(), connect.NewRequest(&financial_accountv1.FinancialAccountCapitalRequest{
		TeamId: teamA, AccountId: unknown.ID, Direction: financial_accountv1.CapitalDirection_CAPITAL_DIRECTION_IN, Amount: 10, OccurredOn: day(0),
	}))
	if code := connectCode(t, err); code != connect.CodeFailedPrecondition {
		t.Fatalf("unknown: code = %v", code)
	}
}
