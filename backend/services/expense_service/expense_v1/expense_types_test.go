package expense_v1_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	analytic_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/analytic_base/v1"
	expensev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/expense/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/expense_service/expense_service_models"
	expense_v1 "github.com/pdcgo/warehouse_revamp/backend/services/expense_service/expense_v1"
)

// THE EXPENSE TYPES (expense-types-sit-under-groups, prive-and-deposit-on-pengeluaran-are-the-accounts-capital,
// money-in-on-biaya-is-its-own-change-type, the-expense-types-prototype-is-accepted; acceptance
// financial_account/expense.md givens 6–22, 27–29) — the fixed table (expense_types.go) seen from the RPCs.

type T = expensev1.ExpenseType

const (
	tMarketplace = expensev1.ExpenseType_EXPENSE_TYPE_ADS_MARKETPLACE
	tContent     = expensev1.ExpenseType_EXPENSE_TYPE_CONTENT_ENDORSE
	tSalary      = expensev1.ExpenseType_EXPENSE_TYPE_BASIC_SALARY
	tBonus       = expensev1.ExpenseType_EXPENSE_TYPE_BONUS
	tContrib     = expensev1.ExpenseType_EXPENSE_TYPE_CONTRIBUTIONS
	tElectricity = expensev1.ExpenseType_EXPENSE_TYPE_ELECTRICITY
	tInternet    = expensev1.ExpenseType_EXPENSE_TYPE_INTERNET
	tKitchen     = expensev1.ExpenseType_EXPENSE_TYPE_KITCHEN
	tTools       = expensev1.ExpenseType_EXPENSE_TYPE_TOOLS
	tEquipment   = expensev1.ExpenseType_EXPENSE_TYPE_EQUIPMENT
	tBankFee     = expensev1.ExpenseType_EXPENSE_TYPE_BANK_FEE
	tDiscrepancy = expensev1.ExpenseType_EXPENSE_TYPE_DISCREPANCY
	tDebtPaid    = expensev1.ExpenseType_EXPENSE_TYPE_OUTSIDE_DEBT_PAID
	tReceivable  = expensev1.ExpenseType_EXPENSE_TYPE_OUTSIDE_RECEIVABLE_RECEIVED
	tPrive       = expensev1.ExpenseType_EXPENSE_TYPE_PRIVE
	tDeposit     = expensev1.ExpenseType_EXPENSE_TYPE_CAPITAL_DEPOSIT
	tOtherOut    = expensev1.ExpenseType_EXPENSE_TYPE_OTHER_OUT
	tOtherIn     = expensev1.ExpenseType_EXPENSE_TYPE_OTHER_IN

	kAds   = expensev1.ExpenseKind_EXPENSE_KIND_ADS
	kPay   = expensev1.ExpenseKind_EXPENSE_KIND_PAYROLL
	kOps   = expensev1.ExpenseKind_EXPENSE_KIND_OPERATIONAL
	kOther = expensev1.ExpenseKind_EXPENSE_KIND_OTHER
)

// typed records one expense of a type — its group derived (kind left 0), the shop only on the marketplace's ads.
func typed(t *testing.T, svc *expense_v1.Service, team uint64, typ T, amount float64, on string, account uint64) *expensev1.ExpenseRecord {
	t.Helper()

	var shop uint64
	if typ == tMarketplace {
		shop = adsShop
	}

	res, err := svc.ExpenseCreate(context.Background(), connect.NewRequest(&expensev1.ExpenseCreateRequest{
		TeamId: team, Type: typ, Amount: amount, OccurredAt: on, ShopId: shop, FinanceAccountId: account,
	}))
	if err != nil {
		t.Fatalf("ExpenseCreate(%v, %v): %v", typ, amount, err)
	}

	return res.Msg.GetExpense()
}

func correct(t *testing.T, svc *expense_v1.Service, team, expenseID uint64, amount float64) *expensev1.ExpenseRecord {
	t.Helper()

	res, err := svc.ExpenseAdjust(context.Background(), connect.NewRequest(&expensev1.ExpenseAdjustRequest{
		TeamId: team, ExpenseId: expenseID, Amount: amount,
	}))
	if err != nil {
		t.Fatalf("ExpenseAdjust(%d, %v): %v", expenseID, amount, err)
	}

	return res.Msg.GetAdjustment()
}

func listOf(t *testing.T, svc *expense_v1.Service, filter *expensev1.ExpenseListFilter) *expensev1.ExpenseListResponse {
	t.Helper()

	res, err := svc.ExpenseList(context.Background(), connect.NewRequest(&expensev1.ExpenseListRequest{
		TeamId: teamA, Filter: filter, Page: page1(),
	}))
	if err != nil {
		t.Fatalf("ExpenseList: %v", err)
	}

	return res.Msg
}

func november() *expensev1.ExpenseListFilter {
	return &expensev1.ExpenseListFilter{From: "2026-11-01", To: "2026-11-30"}
}

// mustDay is a wire date as the column holds it.
func mustDay(raw string) time.Time {
	d, err := time.Parse("2006-01-02", raw)
	if err != nil {
		panic(err)
	}

	return d
}

func codeOf(err error) connect.Code {
	var ce *connect.Error
	if errors.As(err, &ce) {
		return ce.Code()
	}

	return connect.CodeUnknown
}

// EACH TYPE SITS UNDER ITS GROUP — the row's kind is the type's group, written from it; the type is stored and read back.
func TestExpenseTypes_EachTypeSitsUnderItsGroup(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	want := map[T]expensev1.ExpenseKind{
		tMarketplace: kAds, tContent: kAds,
		tSalary: kPay, tBonus: kPay, tContrib: kPay,
		tElectricity: kOps, tInternet: kOps, tKitchen: kOps, tTools: kOps, tEquipment: kOps, tBankFee: kOps, tDiscrepancy: kOps,
		tDebtPaid: kOther, tReceivable: kOther, tPrive: kOther, tDeposit: kOther, tOtherOut: kOther, tOtherIn: kOther,
	}

	if len(want) != 18 {
		t.Fatalf("the accepted table has 18 types, this test %d", len(want))
	}

	for typ, group := range want {
		got := typed(t, svc, teamA, typ, 1_000, "2026-11-05", payingAccount)
		if got.GetKind() != group || got.GetType() != typ {
			t.Fatalf("%v recorded as kind %v type %v, want kind %v", typ, got.GetKind(), got.GetType(), group)
		}
	}

	rows := expenseRows(listOf(t, svc, november()))
	if len(rows) != 18 {
		t.Fatalf("%d rows listed, want 18", len(rows))
	}

	for _, r := range rows {
		if want[r.GetType()] != r.GetKind() {
			t.Fatalf("row %d reads type %v under kind %v", r.GetId(), r.GetType(), r.GetKind())
		}
	}
}

// A TYPE IS REQUIRED, and a kind sent beside it must be its group. Only inventory's STOCK_LOSS has none.
func TestExpenseCreate_ATypeIsRequiredAndDecidesTheGroup(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	cases := []struct {
		name string
		kind expensev1.ExpenseKind
		typ  T
	}{
		{"no type", kOps, expensev1.ExpenseType_EXPENSE_TYPE_UNSPECIFIED},
		{"no type, no kind", expensev1.ExpenseKind_EXPENSE_KIND_UNSPECIFIED, expensev1.ExpenseType_EXPENSE_TYPE_UNSPECIFIED},
		{"a type under another group", kPay, tElectricity},
		{"an unknown type", kOps, T(99)},
	}

	for _, c := range cases {
		_, err := svc.ExpenseCreate(context.Background(), connect.NewRequest(&expensev1.ExpenseCreateRequest{
			TeamId: teamA, Kind: c.kind, Type: c.typ, Amount: 10_000, OccurredAt: "2026-11-05", FinanceAccountId: payingAccount,
		}))
		if codeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("%s: err = %v, want InvalidArgument", c.name, err)
		}
	}

	// The group sent with its own type is taken.
	res, err := svc.ExpenseCreate(context.Background(), connect.NewRequest(&expensev1.ExpenseCreateRequest{
		TeamId: teamA, Kind: kOps, Type: tElectricity, Amount: 10_000, OccurredAt: "2026-11-05", FinanceAccountId: payingAccount,
	}))
	if err != nil || res.Msg.GetExpense().GetKind() != kOps {
		t.Fatalf("electricity with its group: %v, %v", res, err)
	}

	var count int64

	err = db.Model(&expense_service_models.ExpenseRecord{}).Where("team_id = ?", teamA).Count(&count).Error
	if err != nil || count != 1 {
		t.Fatalf("%d rows stored (%v), want only the valid one", count, err)
	}
}

// ONLY IKLAN MARKETPLACE NAMES A SHOP (an-expense-names-a-shop-only-for-ads, read per type): it must; Konten · endorse,
// in the same group, names none.
func TestExpenseCreate_OnlyTheMarketplacesAdsNameAShop(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	refuse := func(name string, typ T, shop uint64) {
		t.Helper()

		_, err := svc.ExpenseCreate(context.Background(), connect.NewRequest(&expensev1.ExpenseCreateRequest{
			TeamId: teamA, Type: typ, Amount: 10_000, OccurredAt: "2026-11-05", ShopId: shop, FinanceAccountId: payingAccount,
		}))
		if codeOf(err) != connect.CodeInvalidArgument {
			t.Fatalf("%s: err = %v, want InvalidArgument", name, err)
		}
	}

	refuse("marketplace ads with no shop", tMarketplace, 0)
	refuse("content with a shop", tContent, adsShop)
	refuse("electricity with a shop", tElectricity, adsShop)

	ads := typed(t, svc, teamA, tMarketplace, 250_000, "2026-11-05", payingAccount)
	content := typed(t, svc, teamA, tContent, 300_000, "2026-11-05", payingAccount)

	if ads.GetShopId() != adsShop || content.GetShopId() != 0 {
		t.Fatalf("shops: marketplace %d, content %d", ads.GetShopId(), content.GetShopId())
	}
}

// THE PAYING ACCOUNT FOLLOWS THE TYPE (the-expense-types-prototype-is-accepted, an-expense-must-name-the-account-that-paid):
// Prive and Setoran modal on ANY active account of the team; every other type — money in included — on an ACTIVE
// OPERATIONAL one. Another team's or an archived account is refused for all.
func TestExpenseCreate_ThePayingAccountFollowsTheType(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	try := func(typ T, account uint64) error {
		_, err := svc.ExpenseCreate(context.Background(), connect.NewRequest(&expensev1.ExpenseCreateRequest{
			TeamId: teamA, Type: typ, Amount: 10_000, OccurredAt: "2026-11-05", FinanceAccountId: account,
		}))

		return err
	}

	for _, typ := range []T{tPrive, tDeposit} {
		for _, account := range []uint64{payingAccount, plainAccount} {
			err := try(typ, account)
			if err != nil {
				t.Fatalf("%v on active account %d: %v, want taken", typ, account, err)
			}
		}

		for _, account := range []uint64{archivedAccount, otherTeamsAccount} {
			err := try(typ, account)
			if codeOf(err) != connect.CodeFailedPrecondition {
				t.Fatalf("%v on account %d: %v, want FailedPrecondition", typ, account, err)
			}
		}
	}

	for _, typ := range []T{tElectricity, tSalary, tReceivable, tOtherIn, tDebtPaid, tOtherOut} {
		err := try(typ, payingAccount)
		if err != nil {
			t.Fatalf("%v on the operational account: %v", typ, err)
		}

		for _, account := range []uint64{plainAccount, archivedAccount, otherTeamsAccount} {
			err = try(typ, account)
			if codeOf(err) != connect.CodeFailedPrecondition {
				t.Fatalf("%v on account %d: %v, want FailedPrecondition — an operational account only", typ, account, err)
			}
		}
	}
}

// seedChecklistMonth is November for Toko Melati, the checklist's rows (givens 1, 3, 6–22, 27, 28): one of each type, the
// payroll Rp 500.000 reduced to Rp 400.000 (given 27), and an old row from before the types (no type) per group.
func seedChecklistMonth(t *testing.T, db *gorm.DB, svc *expense_v1.Service) map[T]uint64 {
	t.Helper()

	amounts := map[T]float64{
		tMarketplace: 250_000, tContent: 300_000,
		tSalary: 500_000, tBonus: 600_000, tContrib: 400_000,
		tElectricity: 255_000, tInternet: 128_000, tKitchen: 213_000, tTools: 1_150_000, tEquipment: 900_000,
		tBankFee: 6_500, tDiscrepancy: 24_000,
		tDebtPaid: 500_000, tReceivable: 350_000, tPrive: 2_000_000, tDeposit: 1_000_000, tOtherOut: 75_000, tOtherIn: 150_000,
	}

	ids := map[T]uint64{}
	for typ, amount := range amounts {
		ids[typ] = typed(t, svc, teamA, typ, amount, "2026-11-10", payingAccount).GetId()
	}

	// Given 27: payroll Rp 500.000 reduced to Rp 400.000.
	correct(t, svc, teamA, ids[tSalary], -100_000)

	// Old rows, typed before the types: their kind only (no backfill).
	for kind, amount := range map[expensev1.ExpenseKind]float64{kAds: 1_500_000, kOps: 800_000} {
		err := db.Create(&expense_service_models.ExpenseRecord{
			TeamID: teamA, Kind: int32(kind), Amount: amount, OccurredAt: mustDay("2026-11-02"), FinanceAccountID: payingAccount,
		}).Error
		if err != nil {
			t.Fatal(err)
		}
	}

	return ids
}

// THE MONTH'S TOTALS ARE THE CHECKLIST'S (givens 17–22, 27, 28): Biaya = every money-out row but Prive; Uang masuk the
// money in but Setoran (positive); Modal = Prive − Setoran; Total bulan ini = Biaya − Uang masuk + Modal = every group's
// net; each type's figure signed (money in minus); the rows from before the types each group's *Tanpa jenis*.
func TestExpenseList_TheMonthsTotalsAreTheChecklists(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	seedChecklistMonth(t, db, svc)

	totals := listOf(t, svc, november()).GetTotals()

	// Spending: every out type but Prive (salary after its correction 400.000) + the two old rows.
	spending := 250_000.0 + 300_000 + 400_000 + 600_000 + 400_000 + 255_000 + 128_000 + 213_000 + 1_150_000 + 900_000 +
		6_500 + 24_000 + 500_000 + 75_000 + 1_500_000 + 800_000
	moneyIn := 350_000.0 + 150_000
	capital := 2_000_000.0 - 1_000_000

	sameFigures(t, "the top line", map[string]float64{
		"spending": totals.GetSpending(), "money_in": totals.GetMoneyIn(), "capital": totals.GetCapital(), "total": totals.GetTotal(),
	}, map[string]float64{
		"spending": spending, "money_in": moneyIn, "capital": capital, "total": spending - moneyIn + capital,
	})

	sameFigures(t, "each group's net", totals.GetByKind(), map[int32]float64{
		int32(kAds):   250_000 + 300_000 + 1_500_000,
		int32(kPay):   400_000 + 600_000 + 400_000,
		int32(kOps):   255_000 + 128_000 + 213_000 + 1_150_000 + 900_000 + 6_500 + 24_000 + 800_000,
		int32(kOther): 500_000 - 350_000 + 2_000_000 - 1_000_000 + 75_000 - 150_000,
	})

	// Given 28: electricity and internet each their own figure; money in minus; the corrected payroll its net.
	byType := totals.GetByType()
	for typ, want := range map[T]float64{
		tElectricity: 255_000, tInternet: 128_000, tSalary: 400_000, tReceivable: -350_000, tDeposit: -1_000_000,
		tOtherIn: -150_000, tPrive: 2_000_000, tDebtPaid: 500_000,
	} {
		if byType[int32(typ)] != want {
			t.Fatalf("by_type[%v] = %v, want %v", typ, byType[int32(typ)], want)
		}
	}

	if len(byType) != 18 {
		t.Fatalf("%d types in by_type, want 18 — the untyped rows are by_kind_untyped's", len(byType))
	}

	sameFigures(t, "Tanpa jenis", totals.GetByKindUntyped(), map[int32]float64{int32(kAds): 1_500_000, int32(kOps): 800_000})
}

// EACH GIVEN 17–22 MOVES THE MONTH TOTAL THE CHECKLIST'S WAY — one row at a time, the total before and after.
func TestExpenseList_EachMoneyTypeMovesTheTotalItsWay(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	typed(t, svc, teamA, tElectricity, 1_000_000, "2026-11-03", payingAccount)

	for _, c := range []struct {
		typ   T
		delta float64 // what the month total moves by, per the checklist's then
	}{
		{tDebtPaid, 100_000},   // 17: outside debt paid — increases
		{tPrive, 200_000},      // 18: prive — increases
		{tDeposit, -300_000},   // 19: deposit — decreases
		{tOtherOut, 40_000},    // 20: other money out — increases
		{tOtherIn, -50_000},    // 21: other money in — decreases
		{tReceivable, -60_000}, // 22: outside receivable received — decreases
	} {
		before := listOf(t, svc, november()).GetTotals().GetTotal()

		amount := c.delta
		if amount < 0 {
			amount = -amount
		}

		typed(t, svc, teamA, c.typ, amount, "2026-11-04", plainAccountFor(c.typ))

		after := listOf(t, svc, november()).GetTotals().GetTotal()
		if after-before != c.delta {
			t.Fatalf("%v of %v moved the month total by %v, want %v", c.typ, amount, after-before, c.delta)
		}
	}
}

// plainAccountFor is the account a test pays a type from: capital from the non-operational account (any active one is
// taken), everything else from the operational one.
func plainAccountFor(typ T) uint64 {
	if typ == tPrive || typ == tDeposit {
		return plainAccount
	}

	return payingAccount
}

// THE FILTER TAKES A GROUP OR ONE TYPE (given 29, expense-types-sit-under-groups) — rows and totals alike; an adjustment
// follows its expense's type; an old untyped row is in its group, never in a type.
func TestExpenseList_FiltersByGroupAndByType(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ids := seedChecklistMonth(t, db, svc)

	// One type: electricity alone.
	f := november()
	f.Kind = kOps
	f.Type = tElectricity
	res := listOf(t, svc, f)

	rows := expenseRows(res)
	if len(rows) != 1 || rows[0].GetId() != ids[tElectricity] {
		t.Fatalf("electricity filter listed %d rows", len(rows))
	}

	if res.GetTotals().GetTotal() != 255_000 || res.GetTotals().GetByKind()[int32(kOps)] != 255_000 {
		t.Fatalf("electricity's totals = %+v", res.GetTotals())
	}

	// One type with its correction: basic salary and its −100.000.
	f = november()
	f.Type = tSalary
	res = listOf(t, svc, f)

	if len(expenseRows(res)) != 2 || res.GetTotals().GetTotal() != 400_000 {
		t.Fatalf("salary filter: %d rows, total %v — want the expense and its correction, 400.000",
			len(expenseRows(res)), res.GetTotals().GetTotal())
	}

	// The group: Operasional's seven types + its old row.
	f = november()
	f.Kind = kOps
	res = listOf(t, svc, f)

	if len(expenseRows(res)) != 8 {
		t.Fatalf("Operasional listed %d rows, want 8", len(expenseRows(res)))
	}

	// A money-in type alone reads minus.
	f = november()
	f.Type = tReceivable
	if got := listOf(t, svc, f).GetTotals(); got.GetTotal() != -350_000 || got.GetMoneyIn() != 350_000 {
		t.Fatalf("receivable alone: %+v", got)
	}
}

// OLD ROWS KEEP THEIR KIND (no guessed backfill): a row from before the types lists under its kind with no type, and
// its correction too.
func TestExpenseList_AnOldRowKeepsItsKindAndNoType(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	old := expense_service_models.ExpenseRecord{
		TeamID: teamA, Kind: int32(kPay), Amount: 500_000, OccurredAt: mustDay("2026-11-02"), FinanceAccountID: payingAccount,
	}

	err := db.Create(&old).Error
	if err != nil {
		t.Fatal(err)
	}

	correction := correct(t, svc, teamA, old.ID, -100_000)
	if correction.GetType() != expensev1.ExpenseType_EXPENSE_TYPE_UNSPECIFIED || correction.GetKind() != kPay {
		t.Fatalf("the old row's correction: kind %v type %v", correction.GetKind(), correction.GetType())
	}

	res := listOf(t, svc, november())
	for _, r := range expenseRows(res) {
		if r.GetKind() != kPay || r.GetType() != expensev1.ExpenseType_EXPENSE_TYPE_UNSPECIFIED {
			t.Fatalf("row %d: kind %v type %v", r.GetId(), r.GetKind(), r.GetType())
		}
	}

	if got := res.GetTotals(); got.GetTotal() != 400_000 || got.GetSpending() != 400_000 || got.GetByKindUntyped()[int32(kPay)] != 400_000 {
		t.Fatalf("totals = %+v", got)
	}
}

// A CORRECTION OF A TYPED ROW KEEPS ITS TYPE — Adjust and Batalkan of a money-in and a capital row: the adjustment
// carries the expense's type (and so its event), and the type's figure nets to what is left.
func TestExpenseAdjust_ATypedRowsCorrectionKeepsItsType(t *testing.T) {
	db := san_testdb.DB(t)
	sent := &sentEvents{}
	svc := newServiceSending(t, db, sent)

	in := typed(t, svc, teamA, tReceivable, 350_000, "2026-11-10", payingAccount)
	prive := typed(t, svc, teamA, tPrive, 2_000_000, "2026-11-10", plainAccount)

	down := correct(t, svc, teamA, in.GetId(), -50_000)
	cancel := correct(t, svc, teamA, prive.GetId(), -2_000_000)

	if down.GetType() != tReceivable || cancel.GetType() != tPrive {
		t.Fatalf("corrections typed %v, %v", down.GetType(), cancel.GetType())
	}

	types := []T{}
	for _, e := range sent.events {
		switch {
		case e.GetExpenseCreated() != nil:
			types = append(types, e.GetExpenseCreated().GetType())
		case e.GetExpenseAdjusted() != nil:
			types = append(types, e.GetExpenseAdjusted().GetType())
		}
	}

	wantTypes := []T{tReceivable, tPrive, tReceivable, tPrive}
	if len(types) != len(wantTypes) {
		t.Fatalf("events carried types %v, want %v", types, wantTypes)
	}

	for i := range types {
		if types[i] != wantTypes[i] {
			t.Fatalf("events carried types %v, want %v", types, wantTypes)
		}
	}

	totals := listOf(t, svc, november()).GetTotals()
	if totals.GetByType()[int32(tReceivable)] != -300_000 || totals.GetMoneyIn() != 300_000 {
		t.Fatalf("receivable after its correction: %+v", totals)
	}

	if totals.GetCapital() != 0 || totals.GetTotal() != -300_000 {
		t.Fatalf("a cancelled prive leaves capital %v, total %v", totals.GetCapital(), totals.GetTotal())
	}
}

// THE METRIC'S FIELDS (ExpensesMetric): ads · payroll · operational · other are each group's SPENDING — never capital,
// never money in; money_in, capital_out and capital_in their own figures; and since backlog #107 `total` is Biaya's month
// total — spending − money in + capital out − capital in (acceptance analytic/expense_metric.md givens 18, 19, 21, 22:
// prive up, deposit and money in down). Every given's *recorded in expense analytic metric*.
func TestMetricData_MoneyInAndCapitalAreTheirOwnFields(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	typed(t, svc, teamA, tContent, 300_000, "2026-11-10", payingAccount)
	typed(t, svc, teamA, tBonus, 600_000, "2026-11-10", payingAccount)
	typed(t, svc, teamA, tDiscrepancy, 24_000, "2026-11-10", payingAccount)
	typed(t, svc, teamA, tDebtPaid, 500_000, "2026-11-10", payingAccount)
	typed(t, svc, teamA, tOtherOut, 75_000, "2026-11-10", payingAccount)
	in := typed(t, svc, teamA, tReceivable, 350_000, "2026-11-10", payingAccount)
	typed(t, svc, teamA, tOtherIn, 150_000, "2026-11-10", payingAccount)
	typed(t, svc, teamA, tPrive, 2_000_000, "2026-11-10", plainAccount)
	typed(t, svc, teamA, tDeposit, 1_000_000, "2026-11-10", plainAccount)
	correct(t, svc, teamA, in.GetId(), -50_000)

	res, err := svc.MetricData(context.Background(), connect.NewRequest(&expensev1.MetricDataRequest{
		TeamId:    teamA,
		GroupBy:   analytic_basev1.GroupType_GROUP_TYPE_SUMMARY,
		Filters:   []*analytic_basev1.FilterItem{dateWindow("2026-11-01", "2026-11-30")},
		MetricIds: []string{"metrics/expenses", "metrics/ads"},
	}))
	if err != nil {
		t.Fatalf("MetricData: %v", err)
	}

	e := res.Msg.GetMetricDatas()[0].GetExpensesSummary()

	sameFigures(t, "Expenses", map[string]float64{
		"ads": e.GetAds(), "payroll": e.GetPayroll(), "operational": e.GetOperational(), "other": e.GetOther(),
		"total": e.GetTotal(), "money_in": e.GetMoneyIn(), "capital_out": e.GetCapitalOut(), "capital_in": e.GetCapitalIn(),
	}, map[string]float64{
		"ads": 300_000, "payroll": 600_000, "operational": 24_000, "other": 575_000,
		"total": 1_499_000 - 450_000 + 2_000_000 - 1_000_000, "money_in": 450_000, "capital_out": 2_000_000, "capital_in": 1_000_000,
	})

	if ads := res.Msg.GetMetricDatas()[1].GetAdsSummary().GetAmount(); ads != 300_000 {
		t.Fatalf("Ads expense = %v — the whole Iklan group, Konten included", ads)
	}
}

// A WAREHOUSE TEAM NEVER READS BIAYA — ExpenseList and the writes take no warehouse role (scopes).
func TestExpenseTypes_AWarehouseTeamNeverReadsBiaya(t *testing.T) {
	for _, name := range []string{
		"warehouse.expense.v1.ExpenseListRequest",
		"warehouse.expense.v1.ExpenseCreateRequest",
		"warehouse.expense.v1.ExpenseAdjustRequest",
	} {
		roles := policyRoles(t, name)
		for _, r := range []role_basev1.Role{
			role_basev1.Role_ROLE_WAREHOUSE_OWNER, role_basev1.Role_ROLE_WAREHOUSE_ADMIN, role_basev1.Role_ROLE_WAREHOUSE_STAFF,
		} {
			if roles[r] {
				t.Fatalf("%s admits %v — Biaya is the selling team's", name, r)
			}
		}

		if !roles[role_basev1.Role_ROLE_SELLING_OWNER] || !roles[role_basev1.Role_ROLE_SELLING_ADMIN] {
			t.Fatalf("%s must admit the selling owner and admin", name)
		}
	}
}

// THE DAILY STATEMENT READS THE SAME SIGNED FIGURES — a money-in row counts minus on its day, so the statement's footer
// and the list's headline stay one number.
func TestExpenseDaily_AMoneyInRowCountsMinusOnItsDay(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	typed(t, svc, teamA, tElectricity, 255_000, "2026-11-10", payingAccount)
	typed(t, svc, teamA, tOtherIn, 150_000, "2026-11-10", payingAccount)

	res, err := svc.ExpenseDaily(context.Background(), connect.NewRequest(&expensev1.ExpenseDailyRequest{
		TeamId: teamA, Filter: &expensev1.ExpenseDailyFilter{From: "2026-11-01", To: "2026-11-30"},
	}))
	if err != nil {
		t.Fatalf("ExpenseDaily: %v", err)
	}

	days := res.Msg.GetDays()
	if len(days) != 1 || days[0].GetTotal() != 105_000 || days[0].GetByKind()[int32(kOther)] != -150_000 {
		t.Fatalf("days = %v, want 10 Nov at 105000 with Lainnya −150000", days)
	}

	if res.Msg.GetTotals().GetTotal() != days[0].GetTotal() {
		t.Fatalf("footer %v ≠ the day %v", res.Msg.GetTotals().GetTotal(), days[0].GetTotal())
	}
}
