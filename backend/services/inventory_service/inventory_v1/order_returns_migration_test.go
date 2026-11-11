package inventory_v1_test

import (
	"os"
	"strings"
	"testing"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// THE RETURN'S TWO TABLES (inventory 00040, return_decision.md), run for real: inside this test's transaction the
// migration's Down drops them and its Up makes them again, and the rules they carry hold — one return per take, a door
// row only `broken` or `missing`, of a positive count, once per kind and product. All of it rolls back with the test.
func TestOrderReturnsMigration_OneReturnPerTakeAndDoorRowsByKind(t *testing.T) {
	db := san_testdb.DB(t)

	raw, err := os.ReadFile("../db_migrations/00040_order_returns.sql")
	if err != nil {
		t.Fatalf("the migration: %v", err)
	}

	parts := strings.SplitN(string(raw), "-- +goose Down", 2)
	if len(parts) != 2 {
		t.Fatal("the migration has no Down")
	}

	for _, sql := range []string{parts[1], parts[0]} {
		err = db.Exec(sql).Error
		if err != nil {
			t.Fatalf("run the migration: %v", err)
		}
	}

	transaction := func(kind string) uint64 {
		var id uint64

		err := db.Raw(`INSERT INTO inventory_transactions (warehouse_id, team_id, tx_type) VALUES (6, 2, ?) RETURNING id`,
			kind).Scan(&id).Error
		if err != nil {
			t.Fatalf("seed a %s transaction: %v", kind, err)
		}

		return id
	}

	take, first, second := transaction("order"), transaction("return"), transaction("return")

	// refused runs one statement in a savepoint and says whether the database refused it.
	refused := func(sql string, args ...any) bool {
		return db.Transaction(func(tx *gorm.DB) error {
			return tx.Exec(sql, args...).Error
		}) != nil
	}

	claim := `INSERT INTO order_return_checks (take_transaction_id, transaction_id) VALUES (?, ?)`

	if refused(claim, take, first) {
		t.Fatal("the first return of a take was refused")
	}

	if !refused(claim, take, second) {
		t.Fatal("a second return of the same take was let in — a parcel stocked twice")
	}

	if !refused(claim, second, second) {
		t.Fatal("a return claiming itself as its take was let in")
	}

	door := `INSERT INTO order_return_problem_items (transaction_id, product_id, problem_type, count, price_unit, total)
		VALUES (?, 701, ?, ?, 10000, 10000)`

	if refused(door, first, "broken", 1) || refused(door, first, "missing", 1) {
		t.Fatal("a broken and a missing row of one product were refused")
	}

	for name, args := range map[string][]any{
		"a third kind":                    {first, "lost", 1},
		"no units":                        {first, "broken", 0},
		"the same kind twice":             {first, "broken", 1},
		"a transaction that is not there": {first + second + 1000, "broken", 1},
	} {
		if !refused(door, args...) {
			t.Fatalf("%s was let into the door table", name)
		}
	}
}
