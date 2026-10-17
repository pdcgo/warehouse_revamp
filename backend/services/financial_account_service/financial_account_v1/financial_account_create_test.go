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

// the-type-decides-the-provider: type Lainnya SETS provider Lainnya, so half the pair is refused — a bank at
// provider Lainnya was another-bank-is-provider-lainnya, which the later decision replaced.
func TestFinancialAccountCreate_RefusesHalfALainnyaPairOrTomorrow(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	lainnyaAtBCA := other(teamA, "Lainnya at BCA", "", 0)
	lainnyaAtBCA.provider = financial_accountv1.FinancialAccountProvider_FINANCIAL_ACCOUNT_PROVIDER_BCA

	bankAtLainnya := bca(teamA, "Mandiri", "1370000001", 0)
	bankAtLainnya.provider = financial_accountv1.FinancialAccountProvider_FINANCIAL_ACCOUNT_PROVIDER_UNKNOWN

	cases := map[string]accountSpec{
		"type Lainnya at a bank provider": lainnyaAtBCA,
		"a bank at provider Lainnya":      bankAtLainnya,
		"a bank with no number":           bca(teamA, "No number", "", 0),
		"a day after today":               func() accountSpec { s := cash(teamA, "Tomorrow", 0); s.on = day(-1); return s }(),
		"below zero":                      cash(teamA, "Negative", -1),
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

// the-type-decides-the-provider: a person opens a Lainnya account — type and provider unknown, no number asked —
// and it opens with its row like any other (an-account-opens-with-a-log-row).
func TestFinancialAccountCreate_TypeLainnyaOpensWithoutANumber(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	a := mustCreate(t, svc, other(teamA, "Mandiri Usaha", "", 250_000))

	if a.GetType() != financial_accountv1.FinancialAccountType_FINANCIAL_ACCOUNT_TYPE_UNKNOWN ||
		a.GetProvider() != financial_accountv1.FinancialAccountProvider_FINANCIAL_ACCOUNT_PROVIDER_UNKNOWN ||
		a.GetAccountNumber() != "" {
		t.Fatalf("account = %+v", a)
	}

	rows := logs(t, db, a.GetId())
	if len(rows) != 1 || rows[0].ChangeType != "opening_balance" || rows[0].Change != 250_000 {
		t.Fatalf("rows = %+v", rows)
	}

	// A number, when given, is still one real account, once — every Lainnya number shares provider Lainnya.
	mustCreate(t, svc, other(teamA, "BRI Gudang", "1370000002", 0))

	_, err := create(svc, other(teamB, "BRI elsewhere", "1370000002", 0))
	if code := connectCode(t, err); code != connect.CodeAlreadyExists {
		t.Fatalf("code = %v, want AlreadyExists", code)
	}
}

// A Lainnya account is allowed what any unknown one is (the-type-decides-the-provider): money does not go INTO it,
// it is not reconciled and it is never operational — Tentukan Rekening makes it a real one first.
func TestFinancialAccountCreate_ALainnyaIsAllowedWhatAnUnknownIs(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	lainnya := mustCreate(t, svc, other(teamA, "Mandiri Usaha", "", 100_000))
	kas := mustCreate(t, svc, cash(teamA, "Kas", 100_000))

	if err := transfer(svc, teamA, kas.GetId(), lainnya.GetId(), 1_000, day(0)); connectCode(t, err) != connect.CodeInvalidArgument {
		t.Fatalf("a transfer INTO a Lainnya account: %v", err)
	}

	if _, err := reconcile(svc, teamA, lainnya.GetId(), 90_000, "bank app"); err == nil {
		t.Fatal("a Lainnya account was reconciled")
	}

	_, err := svc.FinancialAccountOperationalSet(asAni(), connect.NewRequest(&financial_accountv1.FinancialAccountOperationalSetRequest{
		TeamId: teamA, AccountId: lainnya.GetId(), Operational: true,
	}))
	if err == nil {
		t.Fatal("a Lainnya account was marked operational")
	}

	// Out of it is how the money leaves it — as from the listener's.
	mustTransfer(t, svc, teamA, lainnya.GetId(), kas.GetId(), 100_000, day(0))
}
