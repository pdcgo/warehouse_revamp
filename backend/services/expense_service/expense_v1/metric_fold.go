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
//   - THE FLOW (expense-types-sit-under-groups): a row counts in its type's flow — spending, money in, capital out
//     (Prive) or capital in (Setoran modal) — part of the row's key, so `ads · payroll · operational · other` stay each
//     group's SPENDING and money in and capital are their own fields (ExpensesMetric). The amount is stored as typed
//     (positive; a correction signed): the flow says the direction, and `total` reads it (metricSums).
//   - THE TYPE (backlog #107; acceptance analytic/expense_metric.md givens 6–22): the row's ExpenseType is part of the key
//     too, so each type reads its own field. A row from before the types keeps type 0 — its group and the total only.
//
// THE RE-FOLD (metric_refold.go, `san report refold --report expense-daily`) rebuilds a team's day from
// `expense_records` through metricEntryOf, the very key and amount this fold writes — so a re-fold equals the fold.
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

// metricRowKey is one report row's key — what an expense row adds to.
type metricRowKey struct {
	Day         string
	TeamID      uint64
	SellerID    uint64
	WarehouseID uint64
	Kind        int32
	Flow        int16
	Type        int32
	ShopID      uint64
	UserID      uint64
}

// metricEntryOf is the report row an expense row counts in and the amount it adds — false for a row Analytic never
// counts (a stock loss). The fold and the re-fold both read it, so they cannot disagree. `side` is where its team sits
// (TeamSides).
func metricEntryOf(row *expense_service_models.ExpenseRecord, side TeamSide) (metricRowKey, float64, bool) {
	if !typedKind(expensev1.ExpenseKind(row.Kind)) {
		return metricRowKey{}, 0, false
	}

	key := metricRowKey{
		Day:    metricDay(row),
		TeamID: row.TeamID,
		Kind:   row.Kind,
		Flow:   flowOf(expensev1.ExpenseType(row.Type)),
		Type:   row.Type,
		ShopID: row.ShopID,
		UserID: row.CreatedBy,
	}

	switch side {
	case SideSeller:
		key.SellerID = row.TeamID
	case SideWarehouse:
		key.WarehouseID = row.TeamID
	case SideNeither:
	}

	return key, row.Amount, true
}

// foldMetric adds one just-written row to its report row. `side` is where its team sits (TeamSides).
func foldMetric(tx *gorm.DB, row *expense_service_models.ExpenseRecord, side TeamSide) error {
	key, amount, counted := metricEntryOf(row, side)
	if !counted {
		return nil
	}

	// The exact signed amount (the-backend-never-rounds-money) — no numeric cast, no rounding.
	err := tx.Exec(`
INSERT INTO expense_metric_daily_reports
    (day, team_id, seller_id, warehouse_id, kind, flow, type, shop_id, user_id, amount, last_updated)
VALUES (CAST(? AS date), ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS double precision), NOW())
ON CONFLICT (day, team_id, kind, flow, type, shop_id, user_id) DO UPDATE SET
    amount       = expense_metric_daily_reports.amount + EXCLUDED.amount,
    last_updated = NOW()`,
		key.Day, key.TeamID, key.SellerID, key.WarehouseID, key.Kind, key.Flow, key.Type, key.ShopID, key.UserID, amount,
	).Error
	if err != nil {
		return fmt.Errorf("expense metrics report: %w", err)
	}

	return nil
}
