package expense_v1

import (
	"fmt"
	"sort"
	"strconv"
	"strings"

	expensev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/expense/v1"
)

// THE EXPENSE TYPES' FIXED TABLE (expense-types-sit-under-groups, prive-and-deposit-on-pengeluaran-are-the-accounts-capital,
// money-in-on-biaya-is-its-own-change-type, the-expense-types-prototype-is-accepted — docs/business/financial_account/
// context_decision.md; acceptance financial_account/expense.md givens 6–22). Each type's group, direction and capital
// flag are stated HERE, once — never a column a person sets, and never re-typed per handler: the create, the list's
// totals, the daily statement and the Analytic fold all read typeInfoOf.
//
//	group        type                                   direction  capital  names a shop
//	Iklan        ADS_MARKETPLACE, CONTENT_ENDORSE        out                  ADS_MARKETPLACE only
//	Gaji         BASIC_SALARY, BONUS, CONTRIBUTIONS      out
//	Operasional  ELECTRICITY … BANK_FEE, DISCREPANCY      out
//	Lainnya      OUTSIDE_DEBT_PAID, OTHER_OUT             out
//	             OUTSIDE_RECEIVABLE_RECEIVED, OTHER_IN    in
//	             PRIVE                                   out        ✓
//	             CAPITAL_DEPOSIT                         in         ✓

// typeInfo is one type's fixed facts.
type typeInfo struct {
	group expensev1.ExpenseKind
	// in: the money comes INTO the account (the account increases; the type's, group's and month's total decrease).
	in bool
	// capital: Prive / Setoran modal — the account's `capital` row, never an expense in the profit.
	capital bool
	// namesShop: the ONE type that names a shop, and must (an-expense-names-a-shop-only-for-ads, read per type).
	namesShop bool
}

var expenseTypes = map[expensev1.ExpenseType]typeInfo{
	expensev1.ExpenseType_EXPENSE_TYPE_ADS_MARKETPLACE: {group: expensev1.ExpenseKind_EXPENSE_KIND_ADS, namesShop: true},
	expensev1.ExpenseType_EXPENSE_TYPE_CONTENT_ENDORSE: {group: expensev1.ExpenseKind_EXPENSE_KIND_ADS},

	expensev1.ExpenseType_EXPENSE_TYPE_BASIC_SALARY:  {group: expensev1.ExpenseKind_EXPENSE_KIND_PAYROLL},
	expensev1.ExpenseType_EXPENSE_TYPE_BONUS:         {group: expensev1.ExpenseKind_EXPENSE_KIND_PAYROLL},
	expensev1.ExpenseType_EXPENSE_TYPE_CONTRIBUTIONS: {group: expensev1.ExpenseKind_EXPENSE_KIND_PAYROLL},

	expensev1.ExpenseType_EXPENSE_TYPE_ELECTRICITY: {group: expensev1.ExpenseKind_EXPENSE_KIND_OPERATIONAL},
	expensev1.ExpenseType_EXPENSE_TYPE_INTERNET:    {group: expensev1.ExpenseKind_EXPENSE_KIND_OPERATIONAL},
	expensev1.ExpenseType_EXPENSE_TYPE_KITCHEN:     {group: expensev1.ExpenseKind_EXPENSE_KIND_OPERATIONAL},
	expensev1.ExpenseType_EXPENSE_TYPE_TOOLS:       {group: expensev1.ExpenseKind_EXPENSE_KIND_OPERATIONAL},
	expensev1.ExpenseType_EXPENSE_TYPE_EQUIPMENT:   {group: expensev1.ExpenseKind_EXPENSE_KIND_OPERATIONAL},
	expensev1.ExpenseType_EXPENSE_TYPE_BANK_FEE:    {group: expensev1.ExpenseKind_EXPENSE_KIND_OPERATIONAL},
	expensev1.ExpenseType_EXPENSE_TYPE_DISCREPANCY: {group: expensev1.ExpenseKind_EXPENSE_KIND_OPERATIONAL},

	expensev1.ExpenseType_EXPENSE_TYPE_OUTSIDE_DEBT_PAID:           {group: expensev1.ExpenseKind_EXPENSE_KIND_OTHER},
	expensev1.ExpenseType_EXPENSE_TYPE_OUTSIDE_RECEIVABLE_RECEIVED: {group: expensev1.ExpenseKind_EXPENSE_KIND_OTHER, in: true},
	expensev1.ExpenseType_EXPENSE_TYPE_PRIVE:                       {group: expensev1.ExpenseKind_EXPENSE_KIND_OTHER, capital: true},
	expensev1.ExpenseType_EXPENSE_TYPE_CAPITAL_DEPOSIT:             {group: expensev1.ExpenseKind_EXPENSE_KIND_OTHER, in: true, capital: true},
	expensev1.ExpenseType_EXPENSE_TYPE_OTHER_OUT:                   {group: expensev1.ExpenseKind_EXPENSE_KIND_OTHER},
	expensev1.ExpenseType_EXPENSE_TYPE_OTHER_IN:                    {group: expensev1.ExpenseKind_EXPENSE_KIND_OTHER, in: true},
}

// typeInfoOf is a type's facts; found is false for UNSPECIFIED (a row from before the types, a stock loss) and for a
// number the table does not know.
func typeInfoOf(t expensev1.ExpenseType) (typeInfo, bool) {
	info, found := expenseTypes[t]

	return info, found
}

// The FLOW a row counts in — the month card's top line and the Analytic report's split. Stored as its number in
// `expense_metric_daily_reports.flow`.
const (
	flowSpending   int16 = 0 // Biaya — every money-out type but Prive; a row from before the types; a stock loss
	flowMoneyIn    int16 = 1 // Uang masuk — the money-in types but Setoran modal
	flowCapitalOut int16 = 2 // Modal keluar — Prive
	flowCapitalIn  int16 = 3 // Modal masuk — Setoran modal
)

// flowOf is the flow of a row of this type. A row with no type is spending: before the types every kind was money out.
func flowOf(t expensev1.ExpenseType) int16 {
	info, found := typeInfoOf(t)

	switch {
	case !found:
		return flowSpending
	case info.capital && info.in:
		return flowCapitalIn
	case info.capital:
		return flowCapitalOut
	case info.in:
		return flowMoneyIn
	default:
		return flowSpending
	}
}

// signOf is what a row of this type adds to its type's, its group's and the month's total per rupiah of its amount: +1
// for money out, −1 for money in (givens 19, 21, 22). A row with no type is money out.
func signOf(t expensev1.ExpenseType) float64 {
	info, found := typeInfoOf(t)
	if found && info.in {
		return -1
	}

	return 1
}

// inTypesSQL is the money-in types' numbers as a SQL literal list — "(14,16,18)" — read from the table above, never
// re-typed: the signed sums in SQL (signedAmountSQL) and the table agree by construction.
func inTypesSQL() string {
	nums := make([]int, 0, 3)
	for t, info := range expenseTypes {
		if info.in {
			nums = append(nums, int(t))
		}
	}

	sort.Ints(nums)

	parts := make([]string, 0, len(nums))
	for _, n := range nums {
		parts = append(parts, strconv.Itoa(n))
	}

	return "(" + strings.Join(parts, ",") + ")"
}

// signedAmountSQL is a row's amount signed by its type's direction (signOf, in SQL). Literals only — no user input.
func signedAmountSQL() string {
	return fmt.Sprintf("CASE WHEN type IN %s THEN -amount ELSE amount END", inTypesSQL())
}
