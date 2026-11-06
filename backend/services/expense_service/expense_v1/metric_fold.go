package expense_v1

import (
	"fmt"
	"time"

	"gorm.io/gorm"

	expensev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/expense/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/expense_service/expense_service_models"
)

// THE EXPENSE-METRICS FOLD (expense-figures-are-read-from-its-own-records) — every typed `expense_records` row adds its
// signed amount to one `expense_metric_daily_reports` row, IN THE SAME TRANSACTION as the row itself. Both writers call
// it: ExpenseCreate (an expense) and ExpenseAdjust (a correction, and a cancel — the correction of the whole net).
//
//   - THE DAY. An expense counts on the day it BELONGS to (`occurred_at`); a correction on the Jakarta day it is MADE
//     (an-expense-correction-counts-on-the-day-it-is-made) — so a past day never changes. The Expenses page, the
//     statement and the paying account keep the expense's day; only Analytic moves it.
//   - THE PERSON. Whoever wrote the row — the typer of an expense, the corrector of a correction
//     (an-expense-correction-counts-for-who-made-it).
//   - NEVER A STOCK LOSS (stock-loss-stays-out-of-analytic-expenses): a STOCK_LOSS row, and a correction of one, adds
//     nothing. The table's CHECK refuses one anyway.
//
// Why in-process and not from ExpenseCreated / ExpenseAdjusted: those are never published for a STOCK_LOSS or an
// expense made before *Paid from*, and expense_service owns both tables — one transaction keeps them equal by
// construction, never behind.
//
// CONCURRENCY: one `INSERT … ON CONFLICT DO UPDATE` — the conflict takes the existing row's lock and adds, so two
// entries into one row queue and neither is lost. It is the LAST statement of its transaction, so the report row is the
// last lock taken (after ExpenseAdjust's expense-row lock): no two writers can hold them in opposite orders.

// wib is the business's clock (a-day-is-a-jakarta-date-string). A fixed offset: Indonesia keeps no daylight saving, and
// a stock Windows host has no IANA zone database.
var wib = time.FixedZone("WIB", 7*60*60)

// JakartaDay is the Jakarta day an instant falls on, as an expense date — the one conversion from a clock to an expense's
// day (the-system-runs-on-jakarta-time), whatever zone the host or the instant is in: 00:30 WIB is that day, though a UTC
// clock still reads the day before. A correction's Analytic day reads it, and so does the composition root's stock-loss
// poster, which has no date a person picked.
func JakartaDay(at time.Time) string {
	return at.In(wib).Format(dateLayout)
}

// typedKind is one of the kinds a person types — the only kinds Analytic's expenses carry.
func typedKind(kind expensev1.ExpenseKind) bool {
	switch kind {
	case expensev1.ExpenseKind_EXPENSE_KIND_ADS, expensev1.ExpenseKind_EXPENSE_KIND_PAYROLL,
		expensev1.ExpenseKind_EXPENSE_KIND_OPERATIONAL, expensev1.ExpenseKind_EXPENSE_KIND_OTHER:
		return true
	default:
		return false
	}
}

// metricDay is the Jakarta day a row counts on in Analytic: an expense's own day, a correction's making.
func metricDay(row *expense_service_models.ExpenseRecord) string {
	if row.AdjustsExpenseID == 0 {
		return row.OccurredAt.Format(dateLayout)
	}

	return JakartaDay(row.CreatedAt)
}

// foldMetric adds one just-written row to its report row. `side` is where its team sits (TeamSides).
func foldMetric(tx *gorm.DB, row *expense_service_models.ExpenseRecord, side TeamSide) error {
	if !typedKind(expensev1.ExpenseKind(row.Kind)) {
		return nil
	}

	var sellerID, warehouseID uint64

	switch side {
	case SideSeller:
		sellerID = row.TeamID
	case SideWarehouse:
		warehouseID = row.TeamID
	case SideNeither:
	}

	// The exact signed amount (the-backend-never-rounds-money) — no numeric cast, no rounding.
	err := tx.Exec(`
INSERT INTO expense_metric_daily_reports
    (day, team_id, seller_id, warehouse_id, kind, shop_id, user_id, amount, last_updated)
VALUES (CAST(? AS date), ?, ?, ?, ?, ?, ?, CAST(? AS double precision), NOW())
ON CONFLICT (day, team_id, kind, shop_id, user_id) DO UPDATE SET
    amount       = expense_metric_daily_reports.amount + EXCLUDED.amount,
    last_updated = NOW()`,
		metricDay(row), row.TeamID, sellerID, warehouseID, row.Kind, row.ShopID, row.CreatedBy, row.Amount,
	).Error
	if err != nil {
		return fmt.Errorf("expense metrics report: %w", err)
	}

	return nil
}
