package expense_service_test

import (
	"testing"
	"time"

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

	// A live row: voided is an absence, not a false.
	if back.VoidedAt != nil {
		t.Fatalf("a new cost is already voided: %v", back.VoidedAt)
	}

	// The shop is optional on every kind (owner) — this payroll row names none.
	if back.ShopID != 0 {
		t.Fatalf("shop_id = %d, want 0 for a cost not attributed to one shop", back.ShopID)
	}
}

// #167 — AMOUNT IS ALWAYS POSITIVE, enforced by the database.
//
// The kind already says the money is going out. A signed amount would let a negative cost silently
// become revenue, which is the one arithmetic mistake this table must not permit — so it is a CHECK
// rather than a rule in a handler somebody could route around.
func TestExpenseRecord_RefusesANonPositiveAmount(t *testing.T) {
	db := san_testdb.DB(t)

	for name, amount := range map[string]int64{"negative": -1, "zero": 0} {
		row := aCost()
		row.Amount = amount

		err := db.Create(&row).Error
		if err == nil {
			t.Fatalf("a %s amount was accepted — it would read as revenue", name)
		}
	}
}
