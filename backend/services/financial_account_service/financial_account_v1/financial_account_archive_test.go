package financial_account_v1_test

import (
	"strings"
	"testing"

	"connectrpc.com/connect"

	financial_accountv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	m "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_service_models"
)

// an-account-is-archived-only-at-zero.
func TestFinancialAccountArchive_OnlyAtZero(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	gaji := mustCreate(t, svc, bca(teamA, "BCA Gaji", "9300000001", 600_000))
	ops := mustCreate(t, svc, bca(teamA, "BCA Ops", "9300000002", 0))

	archive := func() error {
		_, err := svc.FinancialAccountArchive(asAni(), connect.NewRequest(&financial_accountv1.FinancialAccountArchiveRequest{TeamId: teamA, AccountId: gaji.GetId()}))
		return err
	}

	err := archive()
	if code := connectCode(t, err); code != connect.CodeFailedPrecondition {
		t.Fatalf("code = %v, want FailedPrecondition", code)
	}

	if !strings.Contains(err.Error(), "Rp 600.000") {
		t.Fatalf("message = %q", err.Error())
	}

	mustTransfer(t, svc, teamA, gaji.GetId(), ops.GetId(), 600_000, day(0))

	err = archive()
	if err != nil {
		t.Fatalf("archive at zero: %v", err)
	}

	var stored m.FinancialAccount
	if err := db.Where("id = ?", gaji.GetId()).Take(&stored).Error; err != nil || stored.Status != m.StatusArchived {
		t.Fatalf("status = %q, %v", stored.Status, err)
	}
}

// An archived account pays for nothing — its operational mark goes with it.
func TestFinancialAccountArchive_DropsTheOperationalMark(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	a := mustCreate(t, svc, cash(teamA, "Kas", 0))

	_, err := svc.FinancialAccountOperationalSet(asAni(), connect.NewRequest(&financial_accountv1.FinancialAccountOperationalSetRequest{TeamId: teamA, AccountId: a.GetId(), Operational: true}))
	if err != nil {
		t.Fatalf("mark: %v", err)
	}

	resp, err := svc.FinancialAccountArchive(asAni(), connect.NewRequest(&financial_accountv1.FinancialAccountArchiveRequest{TeamId: teamA, AccountId: a.GetId()}))
	if err != nil {
		t.Fatalf("archive: %v", err)
	}

	if resp.Msg.GetAccount().GetOperational() {
		t.Fatal("an archived account is still operational")
	}
}
