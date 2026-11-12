package inventory_ledgers_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_ledgers"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// THE STOCK REPORT (stock_report.go — ready-stock-is-folded-in-the-stock-changes-own-step).

func reportTx(t *testing.T, db *gorm.DB) models.InventoryTransaction {
	t.Helper()

	tx, err := inventory_ledgers.CreateTransaction(db, inventory_ledgers.NewTransaction{
		WarehouseID: gudangBarat, TeamID: melati, TxType: models.TxRestock, ActorID: ani,
	})
	if err != nil {
		t.Fatalf("transaction: %v", err)
	}

	return tx
}

// A ledger write outside a stock transaction is refused before anything is written — a writer that forgot it fails its
// first test instead of missing the report.
func TestStockReport_AWriteOutsideAStockTransactionIsRefused(t *testing.T) {
	db := san_testdb.DB(t)

	_, err := inventory_ledgers.MintBatch(db, inventory_ledgers.Mint{
		Transaction: reportTx(t, db), TeamID: melati, ProductID: kaosHitam, Count: 3, PriceUnit: 1000, ChangeType: "restock",
	})
	if !errors.Is(err, inventory_ledgers.ErrNoStockReport) {
		t.Fatalf("a mint outside a stock transaction: %v — want ErrNoStockReport", err)
	}

	var batches int64
	db.Model(&models.Batch{}).Where("product_id = ?", kaosHitam).Count(&batches)

	if batches != 0 {
		t.Fatalf("%d batches written by a refused mint", batches)
	}
}

// Two mints of one key in one transaction land as ONE row, on the transaction's day (a test clock here), with the log
// rows stamped at the same instant; a second transaction on the same day adds to it.
func TestStockReport_OneRowPerKeyAndDayAddedTo(t *testing.T) {
	db := san_testdb.DB(t)

	day := time.Date(2026, 3, 2, 23, 30, 0, 0, time.UTC) // 06:30 WIB on 3 March — a Jakarta day, never UTC's
	ctx := inventory_ledgers.WithNow(context.Background(), day)

	for range 2 {
		err := inventory_ledgers.StockTransaction(db.WithContext(ctx), func(tx *gorm.DB) error {
			txn := reportTx(t, tx)

			_, err := inventory_ledgers.MintBatches(tx, []inventory_ledgers.Mint{
				{Transaction: txn, TeamID: melati, ProductID: kaosHitam, Count: 3, PriceUnit: 1000, SupplierID: 9, ChangeType: "restock"},
				{Transaction: txn, TeamID: melati, ProductID: kaosHitam, Count: 2, PriceUnit: 1500, SupplierID: 9, ChangeType: "restock"},
			})

			return err
		})
		if err != nil {
			t.Fatalf("stock transaction: %v", err)
		}
	}

	var rows []struct {
		Day         time.Time
		ChangeCount int64
		ChangeValue float64
		SupplierID  uint64
	}

	db.Raw(`SELECT day, change_count, change_value, supplier_id FROM inventory_stock_daily_changes
		WHERE product_id = ?`, kaosHitam).Scan(&rows)

	if len(rows) != 1 || rows[0].Day.Format("2006-01-02") != "2026-03-03" || rows[0].ChangeCount != 10 ||
		rows[0].ChangeValue != 12000 || rows[0].SupplierID != 9 {
		t.Fatalf("report rows = %+v — want ONE on 2026-03-03: 10 units, Rp 12.000, supplier 9", rows)
	}

	var stamped int64
	db.Model(&models.BatchLog{}).Where("created_at = ?", day).Count(&stamped)

	if stamped != 4 {
		t.Fatalf("%d log rows stamped with the transaction's time — want all 4", stamped)
	}
}
