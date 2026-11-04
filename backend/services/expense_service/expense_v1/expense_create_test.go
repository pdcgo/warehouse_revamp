package expense_v1_test

import (
	"context"
	"strings"
	"testing"

	"connectrpc.com/connect"

	expensev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/expense/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/expense_service/expense_service_models"
	expense_v1 "github.com/pdcgo/warehouse_revamp/backend/services/expense_service/expense_v1"
)

// #168 — a cost is recorded, and it keeps the date the person CHOSE.
//
// That date is the point: payroll is paid on the 5th for the month before, so filing it under the day
// it was typed would put it in the wrong month for every report that matters.
func TestCostCreate_RecordsTheChosenDate(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	got := record(t, svc, expensev1.ExpenseKind_EXPENSE_KIND_PAYROLL, 12_000_000, "2026-06-30")

	if got.GetAmount() != 12_000_000 {
		t.Fatalf("amount = %d, want 12000000", got.GetAmount())
	}
	if got.GetOccurredAt() != "2026-06-30" {
		t.Fatalf("occurred_at = %q, want the chosen 2026-06-30", got.GetOccurredAt())
	}
	if got.GetKind() != expensev1.ExpenseKind_EXPENSE_KIND_PAYROLL {
		t.Fatalf("kind = %v, want PAYROLL", got.GetKind())
	}
	// A new cost is an expense, not an adjustment, and counts for its own amount until somebody corrects it.
	if got.GetAdjustsExpenseId() != 0 || got.GetNetAmount() != got.GetAmount() {
		t.Fatalf("adjusts %d, net %d — want an expense counting for its own %d",
			got.GetAdjustsExpenseId(), got.GetNetAmount(), got.GetAmount())
	}
}

// #168 — a date that MATCHES THE PATTERN but is not a day is refused.
//
// Proto validation checks the shape; "2026-02-31" has the right shape and does not exist. The handler
// re-checks because shape is not validity — and because unit tests bypass the validation interceptor,
// so a handler that trusted the pattern would be untested against exactly this.
func TestCostCreate_RefusesADateThatIsNotADay(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	for _, bad := range []string{"2026-02-31", "2026-13-01", "not-a-date"} {
		_, err := svc.ExpenseCreate(context.Background(), connect.NewRequest(&expensev1.ExpenseCreateRequest{
			TeamId: teamA, Kind: expensev1.ExpenseKind_EXPENSE_KIND_ADS, Amount: 1000, OccurredAt: bad,
			ShopId: adsShop, FinanceAccountId: payingAccount,
		}))
		if code := connect.CodeOf(err); code != connect.CodeInvalidArgument {
			t.Fatalf("ExpenseCreate(%q) = %v, want InvalidArgument", bad, code)
		}
	}
}

// an-expense-names-a-shop-only-for-ads — an ADS expense names the shop the ads ran for, and must; every other kind names
// none. InvalidArgument either way, with the screen's own words. (It reverses the 2026-07-21 "optional on every kind".)
func TestExpenseCreate_OnlyAdsNamesAShop(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := context.Background()

	create := func(kind expensev1.ExpenseKind, shop uint64) (*expensev1.ExpenseRecord, error) {
		res, err := svc.ExpenseCreate(ctx, connect.NewRequest(&expensev1.ExpenseCreateRequest{
			TeamId: teamA, Kind: kind, Amount: 800_000, OccurredAt: "2026-07-05", ShopId: shop,
			FinanceAccountId: payingAccount,
		}))
		if err != nil {
			return nil, err
		}

		return res.Msg.GetExpense(), nil
	}

	_, err := create(expensev1.ExpenseKind_EXPENSE_KIND_ADS, 0)
	if connect.CodeOf(err) != connect.CodeInvalidArgument || !strings.Contains(err.Error(), "an ads expense names its shop") {
		t.Fatalf("ads with no shop = %v, want InvalidArgument \"an ads expense names its shop\"", err)
	}

	for _, kind := range []expensev1.ExpenseKind{
		expensev1.ExpenseKind_EXPENSE_KIND_PAYROLL,
		expensev1.ExpenseKind_EXPENSE_KIND_OPERATIONAL,
		expensev1.ExpenseKind_EXPENSE_KIND_OTHER,
	} {
		_, err = create(kind, adsShop)
		if connect.CodeOf(err) != connect.CodeInvalidArgument || !strings.Contains(err.Error(), "only an ads expense names a shop") {
			t.Fatalf("%v naming a shop = %v, want InvalidArgument \"only an ads expense names a shop\"", kind, err)
		}

		got, err := create(kind, 0)
		if err != nil || got.GetShopId() != 0 {
			t.Fatalf("%v with no shop = %v, %v — want recorded with shop 0", kind, got, err)
		}
	}

	got, err := create(expensev1.ExpenseKind_EXPENSE_KIND_ADS, adsShop)
	if err != nil || got.GetShopId() != adsShop {
		t.Fatalf("ads naming shop %d = %v, %v — want recorded with it", adsShop, got, err)
	}
}

// an-expense-must-name-the-account-that-paid — the account is required, and is stored on the row; the list returns it.
func TestExpenseCreate_StoresTheAccountThatPaid(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	got := record(t, svc, expensev1.ExpenseKind_EXPENSE_KIND_OPERATIONAL, 450_000, "2026-07-05")
	if got.GetFinanceAccountId() != payingAccount {
		t.Fatalf("finance_account_id = %d, want %d", got.GetFinanceAccountId(), payingAccount)
	}

	rows := expenseRows(list(t, svc, &expensev1.ExpenseListRequest{TeamId: teamA, Page: page1()}))
	if len(rows) != 1 || rows[0].GetFinanceAccountId() != payingAccount {
		t.Fatalf("the list = %v, want the one row naming account %d", rows, payingAccount)
	}

	// No account: the handler does not trust a caller that skipped the validation interceptor.
	_, err := svc.ExpenseCreate(context.Background(), connect.NewRequest(&expensev1.ExpenseCreateRequest{
		TeamId: teamA, Kind: expensev1.ExpenseKind_EXPENSE_KIND_PAYROLL, Amount: 1000, OccurredAt: "2026-07-05",
	}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("no account = %v, want InvalidArgument", err)
	}
}

// The account must be one of the TEAM'S ACTIVE OPERATIONAL accounts — another team's, an archived one, one not marked
// operational and one that never existed are FailedPrecondition, naming it so the person knows which pick to change.
// Nothing is stored.
func TestExpenseCreate_RefusesAnAccountThatMayNotPay(t *testing.T) {
	db := san_testdb.DB(t)
	sent := &sentEvents{}
	svc := newServiceSending(t, db, sent)

	cases := []struct {
		name    string
		account uint64
		says    string
	}{
		{"another team's", otherTeamsAccount, "account #10"},
		{"archived", archivedAccount, "Mandiri Lama is archived"},
		{"not operational", plainAccount, "Tabungan Pemilik is not one of the team's active operational accounts"},
		{"unknown", 999, "account #999"},
	}

	for _, tc := range cases {
		_, err := svc.ExpenseCreate(context.Background(), connect.NewRequest(&expensev1.ExpenseCreateRequest{
			TeamId: teamA, Kind: expensev1.ExpenseKind_EXPENSE_KIND_PAYROLL, Amount: 1000, OccurredAt: "2026-07-05",
			FinanceAccountId: tc.account,
		}))
		if connect.CodeOf(err) != connect.CodeFailedPrecondition || !strings.Contains(err.Error(), tc.says) {
			t.Fatalf("%s account = %v, want FailedPrecondition saying %q", tc.name, err, tc.says)
		}
	}

	var n int64

	err := db.Model(&expense_service_models.ExpenseRecord{}).Where("team_id = ?", teamA).Count(&n).Error
	if err != nil {
		t.Fatalf("count: %v", err)
	}

	if n != 0 || len(sent.events) != 0 {
		t.Fatalf("%d rows stored and %d events sent after refusals, want none", n, len(sent.events))
	}
}

// STOCK_LOSS is outside the rule: inventory records it by an internal call with no validation interceptor, it moves no
// cash, and it is stored with NO account — whatever was sent — and never asks financial_account.
func TestExpenseCreate_StockLossNamesNoAccount(t *testing.T) {
	db := san_testdb.DB(t)
	// No account service at all: every account would be refused, so the write proves it never asked.
	svc := expense_v1.NewService(db, nil, nil)

	for _, sentAccount := range []uint64{0, payingAccount} {
		res, err := svc.ExpenseCreate(context.Background(), connect.NewRequest(&expensev1.ExpenseCreateRequest{
			TeamId: teamA, Kind: expensev1.ExpenseKind_EXPENSE_KIND_STOCK_LOSS, Amount: 30_000, OccurredAt: "2026-07-05",
			FinanceAccountId: sentAccount,
		}))
		if err != nil {
			t.Fatalf("stock loss (account %d sent): %v", sentAccount, err)
		}

		if got := res.Msg.GetExpense().GetFinanceAccountId(); got != 0 {
			t.Fatalf("stock loss stored account %d, want 0", got)
		}
	}
}
