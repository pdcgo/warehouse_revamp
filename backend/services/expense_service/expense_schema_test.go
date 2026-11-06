package expense_service_test

import (
	"testing"
	"time"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	expense_service_models "github.com/pdcgo/warehouse_revamp/backend/services/expense_service/expense_service_models"
)

func aCost() expense_service_models.ExpenseRecord {
	return expense_service_models.ExpenseRecord{
		TeamID:     2,
		Kind:       2, // PAYROLL
		Amount:     12_000_000,
		OccurredAt: time.Date(2026, 6, 30, 0, 0, 0, 0, time.UTC),
		Note:       "June wages",
		CreatedBy:  1,
	}
}

// #167 — the record round-trips, and the fields that carry a decision keep their meaning.
func TestExpenseRecord_RoundTrips(t *testing.T) {
	db := san_testdb.DB(t)

	row := aCost()

	err := db.Create(&row).Error
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	var back expense_service_models.ExpenseRecord

	err = db.First(&back, row.ID).Error
	if err != nil {
		t.Fatalf("read back: %v", err)
	}

	if back.Amount != 12_000_000 || back.TeamID != 2 || back.CreatedBy != 1 {
		t.Fatalf("round-tripped as %+v", back)
	}

	// The DATE the cost belongs to, not the insert time — payroll paid on the 5th is last month's cost.
	if got := back.OccurredAt.Format("2006-01-02"); got != "2026-06-30" {
		t.Fatalf("occurred_at = %s, want the chosen 2026-06-30", got)
	}

	// An expense, not an adjustment: it corrects nothing.
	if back.AdjustsExpenseID != 0 {
		t.Fatalf("a new cost adjusts expense %d", back.AdjustsExpenseID)
	}

	// The shop is optional on every kind (owner) — this payroll row names none.
	if back.ShopID != 0 {
		t.Fatalf("shop_id = %d, want 0 for a cost not attributed to one shop", back.ShopID)
	}
}

// #167 — AN EXPENSE'S AMOUNT IS ALWAYS POSITIVE, enforced by the database.
//
// The kind already says the money is going out. A signed amount would let a negative cost silently
// become revenue, which is the one arithmetic mistake this table must not permit — so it is a CHECK
// rather than a rule in a handler somebody could route around.
func TestExpenseRecord_RefusesANonPositiveAmount(t *testing.T) {
	db := san_testdb.DB(t)

	for name, amount := range map[string]float64{"negative": -1, "zero": 0} {
		row := aCost()
		row.Amount = amount

		err := db.Create(&row).Error
		if err == nil {
			t.Fatalf("a %s amount was accepted — it would read as revenue", name)
		}
	}
}

// AN ADJUSTMENT IS SIGNED AND NEVER 0, enforced by the database (every-correction-is-a-signed-adjustment) — a
// correction of nothing is not one. That an expense and its adjustments never sum below 0 is the handler's: a CHECK
// cannot see the other rows.
func TestExpenseRecord_AnAdjustmentIsSignedAndNeverZero(t *testing.T) {
	db := san_testdb.DB(t)

	expense := aCost()

	err := db.Create(&expense).Error
	if err != nil {
		t.Fatalf("create the expense: %v", err)
	}

	for name, c := range map[string]struct {
		amount float64
		ok     bool
	}{"a reduction": {-2_000_000, true}, "an addition": {500_000, true}, "zero": {0, false}} {
		row := aCost()
		row.Amount = c.amount
		row.AdjustsExpenseID = expense.ID

		// A SAVEPOINT per case: the refused insert aborts the test's one transaction otherwise, and map order decides
		// whether the cases after it ever reach the database.
		err := db.Transaction(func(tx *gorm.DB) error {
			return tx.Create(&row).Error
		})
		if (err == nil) != c.ok {
			t.Fatalf("%s: err = %v, want accepted %v", name, err, c.ok)
		}
	}
}
