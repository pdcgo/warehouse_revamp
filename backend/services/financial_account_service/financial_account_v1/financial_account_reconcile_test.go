package financial_account_v1_test

import (
	"strings"
	"testing"

	"connectrpc.com/connect"

	financial_accountv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	m "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_service_models"
	financial_account_v1 "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_v1"
)

func reconcile(svc *financial_account_v1.Service, team, id uint64, actual float64, note string) (*financial_accountv1.FinancialAccountReconcileResponse, error) {
	resp, err := svc.FinancialAccountReconcile(asAni(), connect.NewRequest(&financial_accountv1.FinancialAccountReconcileRequest{
		TeamId: team, AccountId: id, ActualBalance: actual, AsOf: day(0), Note: note,
	}))
	if err != nil {
		return nil, err
	}

	return resp.Msg, nil
}

// adjustment-is-for-reconciling-only: the bank's figure in, the difference posted — with the person's note.
func TestFinancialAccountReconcile_PostsTheDifferenceAsAnAdjustment(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	a := mustCreate(t, svc, bca(teamA, "BCA", "9200000001", 11_450_000))

	got, err := reconcile(svc, teamA, a.GetId(), 11_443_500, "bank fee")
	if err != nil {
		t.Fatalf("reconcile: %v", err)
	}

	if got.GetDifference() != -6_500 || got.GetLog().GetChangeType() != financial_accountv1.FinancialAccountChangeType_FINANCIAL_ACCOUNT_CHANGE_TYPE_ADJUSTMENT {
		t.Fatalf("reconcile = %+v", got)
	}

	if !strings.Contains(got.GetLog().GetDescription(), "Rp 11.443.500") || !strings.Contains(got.GetLog().GetDescription(), "bank fee") {
		t.Fatalf("description = %q", got.GetLog().GetDescription())
	}

	if balance(t, db, a.GetId()) != 11_443_500 || got.GetReconciledAt() == nil {
		t.Fatal("the balance or the stamp did not land")
	}
}

// A difference needs a note — the one row that can hide missing cash.
func TestFinancialAccountReconcile_ADifferenceNeedsANote(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	a := mustCreate(t, svc, cash(teamA, "Kas", 850_000))

	_, err := reconcile(svc, teamA, a.GetId(), 800_000, "  ")
	if code := connectCode(t, err); code != connect.CodeInvalidArgument {
		t.Fatalf("code = %v, want InvalidArgument", code)
	}

	if len(logs(t, db, a.GetId())) != 1 {
		t.Fatal("a refused reconcile posted a row")
	}
}

// A reconcile that agrees posts nothing — and still marks the account checked.
func TestFinancialAccountReconcile_AgreeingPostsNothingButStamps(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	a := mustCreate(t, svc, cash(teamA, "Kas", 850_000))

	got, err := reconcile(svc, teamA, a.GetId(), 850_000, "")
	if err != nil {
		t.Fatalf("reconcile: %v", err)
	}

	if got.GetDifference() != 0 || got.GetLog() != nil || len(logs(t, db, a.GetId())) != 1 {
		t.Fatalf("an agreeing reconcile posted: %+v", got)
	}

	var stored m.FinancialAccount
	if err := db.Where("id = ?", a.GetId()).Take(&stored).Error; err != nil || stored.ReconciledAt == nil {
		t.Fatalf("not stamped: %v", err)
	}

	// A cash box says it was COUNTED.
	got, err = reconcile(svc, teamA, a.GetId(), 840_000, "short")
	if err != nil || !strings.Contains(got.GetLog().GetDescription(), "the box counted") {
		t.Fatalf("cash reconcile = %+v, %v", got, err)
	}
}

func TestFinancialAccountReconcile_AnUnknownAccountHasNoStatement(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	unknown := m.FinancialAccount{TeamID: teamA, Type: m.TypeUnknown, Provider: m.ProviderUnknown, Status: m.StatusActive, Name: "Unknown — shop #501"}
	if err := db.Create(&unknown).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}

	_, err := reconcile(svc, teamA, unknown.ID, 0, "")
	if code := connectCode(t, err); code != connect.CodeFailedPrecondition {
		t.Fatalf("code = %v, want FailedPrecondition", code)
	}
}
