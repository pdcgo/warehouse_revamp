package expense_v1_test

import (
	"context"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/reflect/protoreflect"
	"gorm.io/gorm"

	analytic_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/analytic_base/v1"
	expensev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/expense/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/expense_service/expense_service_models"
	expense_v1 "github.com/pdcgo/warehouse_revamp/backend/services/expense_service/expense_v1"
)

// ANALYTIC'S EXPENSES BY TYPE (backlog #107) — the owner's checklist docs/acceptances/analytic/expense_metric.md givens
// 6–22: *group daily · expenses · <type> Rp N today* → *<type> shown* and *total up / down by Rp N* — the total moving
// as Biaya's month total does (the-expense-types-prototype-is-accepted; financial_account/expense.md givens 17–22):
// prive raises it, setoran modal and money in lower it.

// allTypes is every ExpenseType but UNSPECIFIED, in the enum's order.
func allTypes() []T {
	out := []T{}

	values := expensev1.ExpenseType(0).Descriptor().Values()
	for i := range values.Len() {
		n := T(values.Get(i).Number())
		if n != expensev1.ExpenseType_EXPENSE_TYPE_UNSPECIFIED {
			out = append(out, n)
		}
	}

	return out
}

// typeFieldOf is a type's field of ExpensesMetric, by the proto contract: its enum name without the prefix, lower case,
// numbered 8 + the type's number.
func typeFieldOf(t *testing.T, typ T) protoreflect.FieldDescriptor {
	t.Helper()

	name := strings.ToLower(strings.TrimPrefix(typ.String(), "EXPENSE_TYPE_"))

	field := (&expensev1.ExpensesMetric{}).ProtoReflect().Descriptor().Fields().ByName(protoreflect.Name(name))
	if field == nil {
		t.Fatalf("ExpensesMetric has no field %q for %v", name, typ)
	}

	if field.Number() != protoreflect.FieldNumber(8+int32(typ)) {
		t.Fatalf("%s is field %d, want 8 + %d", name, field.Number(), int32(typ))
	}

	return field
}

// typeFigures is every type field of one answer, by type.
func typeFigures(t *testing.T, m *expensev1.ExpensesMetric) map[T]float64 {
	t.Helper()

	out := map[T]float64{}
	for _, typ := range allTypes() {
		out[typ] = m.ProtoReflect().Get(typeFieldOf(t, typ)).Float()
	}

	return out
}

// expensesOnDay reads Expenses grouped daily for one day, as the composer asks it (`group daily · expenses`).
func expensesOnDay(t *testing.T, svc *expense_v1.Service, team uint64, day string) *expensev1.ExpensesMetric {
	t.Helper()

	res, err := svc.MetricData(context.Background(), connect.NewRequest(&expensev1.MetricDataRequest{
		TeamId:    team,
		GroupBy:   analytic_basev1.GroupType_GROUP_TYPE_DAILY,
		Filters:   []*analytic_basev1.FilterItem{dateWindow(day, day)},
		Keys:      dayKeys(day),
		MetricIds: []string{metricExpenses},
	}))
	if err != nil {
		t.Fatalf("MetricData daily %s: %v", day, err)
	}

	return res.Msg.GetMetricDatas()[0].GetExpensesByDay().GetItems()[day]
}

// expensesSummary reads the Expenses headline over a window.
func expensesSummary(t *testing.T, svc *expense_v1.Service, team uint64, from, to string) *expensev1.ExpensesMetric {
	t.Helper()

	res, err := svc.MetricData(context.Background(), connect.NewRequest(&expensev1.MetricDataRequest{
		TeamId:    team,
		GroupBy:   analytic_basev1.GroupType_GROUP_TYPE_SUMMARY,
		Filters:   []*analytic_basev1.FilterItem{dateWindow(from, to)},
		MetricIds: []string{metricExpenses},
	}))
	if err != nil {
		t.Fatalf("MetricData summary: %v", err)
	}

	return res.Msg.GetMetricDatas()[0].GetExpensesSummary()
}

// EVERY TYPE HAS ITS FIELD — eighteen, appended after capital_in in ExpenseType's order, each a sortable CURRENCY.
func TestExpensesMetric_EveryTypeHasItsOwnField(t *testing.T) {
	types := allTypes()
	if len(types) != 18 {
		t.Fatalf("%d expense types, want the 18 of expense_types.go", len(types))
	}

	fields := (&expensev1.ExpensesMetric{}).ProtoReflect().Descriptor().Fields()
	if fields.Len() != 8+len(types) {
		t.Fatalf("ExpensesMetric has %d fields, want the 8 before the types + %d", fields.Len(), len(types))
	}

	for _, typ := range types {
		typeFieldOf(t, typ)
	}
}

// GIVENS 6–22, ONE AT A TIME: each type recorded today shows in its OWN field of today's row (signed as Biaya's month
// card shows it — money in minus), every other type field stays where it was, and the day's total moves by the given's
// then: up for every money-out type and Prive, down for Setoran modal and money in.
func TestMetricData_EachTypeShowsAndMovesTheTotalItsWay(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	const today = "2026-11-20"

	for _, c := range []struct {
		given  int
		typ    T
		amount float64
		delta  float64 // the then: total up (+) or down (−) by the amount
	}{
		{6, tDiscrepancy, 50_000, 50_000},       // adjustment shown · total up
		{7, tBankFee, 6_500, 6_500},             // bank fee shown · total up
		{8, tContent, 500_000, 500_000},         // content shown · total up
		{9, tTools, 2_000_000, 2_000_000},       // tools shown · total up
		{10, tEquipment, 1_500_000, 1_500_000},  // equipment shown · total up
		{11, tElectricity, 300_000, 300_000},    // electricity shown · total up
		{12, tKitchen, 200_000, 200_000},        // kitchen shown · total up
		{13, tInternet, 350_000, 350_000},       // internet shown · total up
		{14, tSalary, 4_000_000, 4_000_000},     // basic salary shown · total up
		{15, tBonus, 1_000_000, 1_000_000},      // bonus shown · total up
		{16, tContrib, 150_000, 150_000},        // contributions shown · total up
		{17, tDebtPaid, 1_000_000, 1_000_000},   // outside debt shown · total up
		{18, tPrive, 2_000_000, 2_000_000},      // prive shown · total up
		{19, tDeposit, 1_000_000, -1_000_000},   // deposit shown · total down
		{20, tOtherOut, 100_000, 100_000},       // other (money out) shown · total up
		{21, tOtherIn, 100_000, -100_000},       // other (money in) shown · total down
		{22, tReceivable, 500_000, -500_000},    // outside receivable shown · total down
		{1, tMarketplace, 2_000_000, 2_000_000}, // given 1's ads — the eighteenth type, its own field too
	} {
		before := expensesOnDay(t, svc, teamA, today)
		beforeTypes := typeFigures(t, before)

		typed(t, svc, teamA, c.typ, c.amount, today, plainAccountFor(c.typ))

		after := expensesOnDay(t, svc, teamA, today)
		afterTypes := typeFigures(t, after)

		for _, typ := range allTypes() {
			moved := afterTypes[typ] - beforeTypes[typ]

			want := 0.0
			if typ == c.typ {
				want = c.delta // the type's own figure, signed by its direction
			}

			if !san_money.Equal(moved, want) {
				t.Fatalf("given %d (%v %v): %v moved by %v, want %v", c.given, c.typ, c.amount, typ, moved, want)
			}
		}

		if moved := after.GetTotal() - before.GetTotal(); !san_money.Equal(moved, c.delta) {
			t.Fatalf("given %d (%v %v): total moved by %v, want %v", c.given, c.typ, c.amount, moved, c.delta)
		}
	}

	// The day's type fields add up to its total — nothing from before the types that day.
	day := expensesOnDay(t, svc, teamA, today)

	sum := 0.0
	for _, v := range typeFigures(t, day) {
		sum += v
	}

	if !san_money.Equal(sum, day.GetTotal()) {
		t.Fatalf("the type fields sum to %v, the total reads %v", sum, day.GetTotal())
	}
}

// THE TOTAL IS BIAYA'S MONTH TOTAL (givens 17–22): over the checklist's month — every type, a payroll correction and the
// rows from before the types — Analytic's Expenses total for November equals ExpenseList's *Total bulan ini*, and each
// type field equals Biaya's figure for the type. The four group fields, money in and capital keep their meaning.
func TestMetricData_TheTotalIsBiayasMonthTotal(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	// The payroll correction is made inside November (its Analytic day).
	expense_v1.SetClock(svc, func() time.Time { return wibAt("2026-11-12", 10) })
	seedChecklistMonth(t, db, svc)

	// The two old rows (no type) as expense 00009 leaves the report: type 0, their kind, spending.
	oldReportRows(t, db, teamA, "2026-11-02", map[expensev1.ExpenseKind]float64{kAds: 1_500_000, kOps: 800_000})

	biaya := listOf(t, svc, november()).GetTotals()
	e := expensesSummary(t, svc, teamA, "2026-11-01", "2026-11-30")

	if !san_money.Equal(e.GetTotal(), biaya.GetTotal()) {
		t.Fatalf("Analytic's total %v ≠ Biaya's month total %v", e.GetTotal(), biaya.GetTotal())
	}

	for typ, got := range typeFigures(t, e) {
		if !san_money.Equal(got, biaya.GetByType()[int32(typ)]) {
			t.Fatalf("%v: Analytic %v ≠ Biaya %v", typ, got, biaya.GetByType()[int32(typ)])
		}
	}

	// Unchanged meanings: each group's spending, money in and capital positive.
	sameFigures(t, "the fields kept", map[string]float64{
		"ads": e.GetAds(), "payroll": e.GetPayroll(), "operational": e.GetOperational(), "other": e.GetOther(),
		"money_in": e.GetMoneyIn(), "capital_out": e.GetCapitalOut(), "capital_in": e.GetCapitalIn(),
	}, map[string]float64{
		"ads":         250_000 + 300_000 + 1_500_000,
		"payroll":     400_000 + 600_000 + 400_000,
		"operational": 255_000 + 128_000 + 213_000 + 1_150_000 + 900_000 + 6_500 + 24_000 + 800_000,
		"other":       500_000 + 75_000,
		"money_in":    350_000 + 150_000, "capital_out": 2_000_000, "capital_in": 1_000_000,
	})
}

// A CORRECTION COUNTS ON ITS DAY, UNDER ITS TYPE (an-expense-correction-counts-on-the-day-it-is-made): a receivable of
// 500.000 received on 3 Nov, reduced by 200.000 on 5 Nov — 3 Nov reads −500.000 under the type, 5 Nov +200.000 (less
// money in), and each day's total moves the same way; 3 Nov never changes.
func TestMetricData_ACorrectionCountsOnItsDayUnderItsType(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	in := typed(t, svc, teamA, tReceivable, 500_000, "2026-11-03", payingAccount)
	prive := typed(t, svc, teamA, tPrive, 1_000_000, "2026-11-03", plainAccount)

	expense_v1.SetClock(svc, func() time.Time { return wibAt("2026-11-05", 9) })
	correct(t, svc, teamA, in.GetId(), -200_000)
	correct(t, svc, teamA, prive.GetId(), -1_000_000) // a cancel: the whole prive back

	third := expensesOnDay(t, svc, teamA, "2026-11-03")
	fifth := expensesOnDay(t, svc, teamA, "2026-11-05")

	for _, c := range []struct {
		day   string
		m     *expensev1.ExpensesMetric
		in    float64
		prive float64
		total float64
	}{
		{"3 Nov", third, -500_000, 1_000_000, 500_000},
		{"5 Nov", fifth, 200_000, -1_000_000, -800_000},
	} {
		figures := typeFigures(t, c.m)
		if !san_money.Equal(figures[tReceivable], c.in) || !san_money.Equal(figures[tPrive], c.prive) ||
			!san_money.Equal(c.m.GetTotal(), c.total) {
			t.Fatalf("%s: receivable %v, prive %v, total %v — want %v, %v, %v", c.day, figures[tReceivable],
				figures[tPrive], c.m.GetTotal(), c.in, c.prive, c.total)
		}
	}
}

// oldReportRows writes report rows as expense 00009 leaves those written before it: type 0, flow 0 (spending), a
// selling team's under Seller, one per kind.
func oldReportRows(t *testing.T, db *gorm.DB, team uint64, day string, amounts map[expensev1.ExpenseKind]float64) {
	t.Helper()

	for kind, amount := range amounts {
		err := db.Create(&expense_service_models.ExpenseMetricDailyReport{
			Day: mustDay(day), TeamID: team, SellerID: team, Kind: int32(kind), UserID: userAni, Amount: amount,
		}).Error
		if err != nil {
			t.Fatalf("old report row: %v", err)
		}
	}
}

// A ROW FROM BEFORE THE TYPES counts in its group and the total, in NO type field: an old payroll of 400.000 beside a
// typed bonus of 600.000 — payroll 1.000.000, total 1.000.000, basic salary 0, bonus 600.000.
func TestMetricData_AnUntypedOldRowCountsInItsGroupOnly(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	oldReportRows(t, db, teamA, "2026-11-04", map[expensev1.ExpenseKind]float64{kPay: 400_000})
	typed(t, svc, teamA, tBonus, 600_000, "2026-11-04", payingAccount)

	e := expensesOnDay(t, svc, teamA, "2026-11-04")
	figures := typeFigures(t, e)

	if !san_money.Equal(e.GetPayroll(), 1_000_000) || !san_money.Equal(e.GetTotal(), 1_000_000) {
		t.Fatalf("payroll %v, total %v — want both 1.000.000", e.GetPayroll(), e.GetTotal())
	}

	for typ, v := range figures {
		want := 0.0
		if typ == tBonus {
			want = 600_000
		}

		if !san_money.Equal(v, want) {
			t.Fatalf("%v reads %v, want %v — the old row is in no type", typ, v, want)
		}
	}
}

// typedAs records one expense of a type as `user`, an owner of `team` — Created by's person.
func typedAs(t *testing.T, svc *expense_v1.Service, user, team uint64, typ T, amount float64, on string) {
	t.Helper()

	_, err := svc.ExpenseCreate(asCaller(user, team, role_basev1.Role_ROLE_SELLING_OWNER), connect.NewRequest(&expensev1.ExpenseCreateRequest{
		TeamId: team, Type: typ, Amount: amount, OccurredAt: on, FinanceAccountId: plainAccountFor(typ),
	}))
	if err != nil {
		t.Fatalf("ExpenseCreate(%v %v by %d): %v", typ, amount, user, err)
	}
}

// A TYPE FIELD SORTS: Created by ranked by bank fee — the people who paid the most bank fee first.
func TestMetricSearch_RanksByATypeField(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	typedAs(t, svc, userAni, teamA, tBankFee, 6_500, "2026-11-06")
	typedAs(t, svc, userBudi, teamA, tBankFee, 13_000, "2026-11-06")
	typedAs(t, svc, userDewi, teamA, tTools, 900_000, "2026-11-06")

	res, err := svc.MetricSearch(context.Background(), connect.NewRequest(&expensev1.MetricSearchRequest{
		TeamId:  teamA,
		GroupBy: analytic_basev1.GroupType_GROUP_TYPE_USER,
		Filters: []*analytic_basev1.FilterItem{dateWindow("2026-11-01", "2026-11-30")},
		Sort:    &analytic_basev1.MetricSort{MetricId: metricExpenses, Field: "bank_fee"},
		Page:    &analytic_basev1.PaginationFilter{Limit: 2},
	}))
	if err != nil {
		t.Fatalf("MetricSearch by bank_fee: %v", err)
	}

	got := res.Msg.GetKeys().GetIds().GetIds()
	if len(got) != 2 || got[0] != userBudi || got[1] != userAni || !res.Msg.GetHasNext() {
		t.Fatalf("by bank fee: %v (next %v) — want Budi, Ani, then Dewi on the next page", got, res.Msg.GetHasNext())
	}
}
