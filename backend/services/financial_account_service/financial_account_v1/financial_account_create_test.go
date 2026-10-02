package financial_account_v1_test

import (
	"strings"
	"testing"

	"connectrpc.com/connect"

	financial_accountv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/financial_account/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	m "github.com/pdcgo/warehouse_revamp/backend/services/financial_account_service/financial_account_service_models"
)

// an-account-opens-with-a-log-row: the opening balance is the first row, posted with the account.
func TestFinancialAccountCreate_OpensWithItsBalanceAsARow(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	a := mustCreate(t, svc, bca(teamA, "BCA Operasional", "1111000001", 2_500_000))

	if a.GetStatus() != financial_accountv1.FinancialAccountStatus_FINANCIAL_ACCOUNT_STATUS_ACTIVE || a.GetName() != "BCA Operasional" {
		t.Fatalf("created = %+v", a)
	}

	if got := balance(t, db, a.GetId()); got != 2_500_000 {
		t.Fatalf("balance = %v, want 2.500.000", got)
	}

	rows := logs(t, db, a.GetId())
	if len(rows) != 1 || rows[0].ChangeType != m.ChangeOpeningBalance || rows[0].BalanceAfter != 2_500_000 || rows[0].ActorID != ani {
		t.Fatalf("logs = %+v", rows)
	}

	// the-daily-row-is-written-with-the-log-row — on the picked day, in Jakarta.
	reports := daily(t, db, a.GetId())
	if len(reports) != 1 || reports[0].Day.Format("2006-01-02") != day(10) || reports[0].CloseBalance != 2_500_000 || reports[0].OpeningBalance != 2_500_000 {
		t.Fatalf("daily = %+v", reports)
	}
}

// Even at 0 — every statement starts with a row (my spec, accepted).
func TestFinancialAccountCreate_AZeroOpeningIsStillARow(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	a := mustCreate(t, svc, cash(teamA, "Kas Toko", 0))

	if rows := logs(t, db, a.GetId()); len(rows) != 1 || rows[0].Change != 0 {
		t.Fatalf("logs = %+v", rows)
	}

	// A cash box has no number.
	if a.GetAccountNumber() != "" {
		t.Fatalf("number = %q", a.GetAccountNumber())
	}
}

// a-real-account-is-recorded-once — across ALL teams.
func TestFinancialAccountCreate_RefusesANumberRecordedInAnotherTeam(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	mustCreate(t, svc, bca(teamB, "BCA B", "2222000002", 0))

	_, err := create(svc, bca(teamA, "BCA A", "2222000002", 0))
	if code := connectCode(t, err); code != connect.CodeAlreadyExists {
		t.Fatalf("code = %v, want AlreadyExists", code)
	}

	if !strings.Contains(err.Error(), "already recorded") {
		t.Fatalf("message = %q", err.Error())
	}
}

// Another provider with the same digits is another account.
func TestFinancialAccountCreate_TheSameDigitsAtAnotherProviderAreAnotherAccount(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	mustCreate(t, svc, bca(teamA, "BCA", "3333000003", 0))

	bni := bca(teamA, "BNI", "3333000003", 0)
	bni.provider = financial_accountv1.FinancialAccountProvider_FINANCIAL_ACCOUNT_PROVIDER_BNI
	mustCreate(t, svc, bni)
}

func TestFinancialAccountCreate_ANameIsUniqueInTheTeamOnly(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	mustCreate(t, svc, cash(teamA, "Kas", 0))

	_, err := create(svc, cash(teamA, "  kas ", 0))
	if code := connectCode(t, err); code != connect.CodeAlreadyExists {
		t.Fatalf("code = %v, want AlreadyExists", code)
	}

	mustCreate(t, svc, cash(teamB, "Kas", 0))
}

func TestFinancialAccountCreate_RefusesWhatOnlyAWithdrawalOrTomorrowCouldMake(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	unknown := bca(teamA, "Unknown", "", 0)
	unknown.typ = financial_accountv1.FinancialAccountType_FINANCIAL_ACCOUNT_TYPE_UNKNOWN
	unknown.provider = financial_accountv1.FinancialAccountProvider_FINANCIAL_ACCOUNT_PROVIDER_UNKNOWN

	cases := map[string]accountSpec{
		"an unknown account":    unknown,
		"a bank with no number": bca(teamA, "No number", "", 0),
		"a day after today":     func() accountSpec { s := cash(teamA, "Tomorrow", 0); s.on = day(-1); return s }(),
		"below zero":            cash(teamA, "Negative", -1),
	}

	for name, spec := range cases {
		_, err := create(svc, spec)
		if code := connectCode(t, err); code != connect.CodeInvalidArgument {
			t.Errorf("%s: code = %v, want InvalidArgument", name, code)
		}
	}
}

// type-and-provider-are-picked-apart — a mismatched pair saves.
func TestFinancialAccountCreate_TypeAndProviderArePickedApart(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	odd := bca(teamA, "ShopeePay as a bank", "081200000001", 0)
	odd.provider = financial_accountv1.FinancialAccountProvider_FINANCIAL_ACCOUNT_PROVIDER_SHOPEEPAY

	a := mustCreate(t, svc, odd)
	if a.GetType() != financial_accountv1.FinancialAccountType_FINANCIAL_ACCOUNT_TYPE_BANK_ACCOUNT {
		t.Fatalf("type = %v", a.GetType())
	}
}
