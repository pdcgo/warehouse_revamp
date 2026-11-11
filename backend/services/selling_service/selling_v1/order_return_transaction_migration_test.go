package selling_v1_test

import (
	"os"
	"strings"
	"testing"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// THE ORDER'S RETURN TRANSACTION (selling 00049), run for real inside this test's transaction: the Down drops the column,
// the Up adds it back nullable — an order not accepted back names none, and no developer's row needs a fill
// (revamp-has-no-real-orders-yet). All of it rolls back with the test.
func TestOrderReturnTransactionMigration_IsANullableColumn(t *testing.T) {
	db := san_testdb.DB(t)

	raw, err := os.ReadFile("../db_migrations/00049_order_return_transaction.sql")
	if err != nil {
		t.Fatalf("the migration: %v", err)
	}

	parts := strings.SplitN(string(raw), "-- +goose Down", 2)
	if len(parts) != 2 {
		t.Fatal("the migration has no Down")
	}

	column := func() (exists bool, nullable string) {
		var rows []struct{ IsNullable string }

		err := db.Raw(`SELECT is_nullable FROM information_schema.columns
			WHERE table_schema = current_schema() AND table_name = 'orders' AND column_name = 'return_transaction_id'`).
			Scan(&rows).Error
		if err != nil {
			t.Fatalf("read the column: %v", err)
		}

		if len(rows) == 0 {
			return false, ""
		}

		return true, rows[0].IsNullable
	}

	err = db.Exec(parts[1]).Error
	if err != nil {
		t.Fatalf("run the migration's Down: %v", err)
	}

	if exists, _ := column(); exists {
		t.Fatal("the Down left orders.return_transaction_id")
	}

	err = db.Exec(parts[0]).Error
	if err != nil {
		t.Fatalf("run the migration's Up: %v", err)
	}

	if exists, nullable := column(); !exists || nullable != "YES" {
		t.Fatalf("orders.return_transaction_id exists=%v nullable=%q, want a nullable column", exists, nullable)
	}
}
