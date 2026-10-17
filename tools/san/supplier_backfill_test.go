package main

import (
	"context"
	"errors"
	"testing"
	"time"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
	supplier_v1 "github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_v1"
)

// seedRestock writes one restock as inventory_service stores it — its status, one line naming its supplier and that line's
// problem rows — accepted at `acceptedAt` when it is "accepted". 9 were in the box, 2 of them broken: 7 good.
func seedRestock(t *testing.T, db *gorm.DB, status string, supplierID *uint64, acceptedAt time.Time) uint64 {
	t.Helper()

	rr := inventory_service_models.Restock{
		TeamID:      12,
		WarehouseID: 5,
		Status:      status,
		Items: []inventory_service_models.RestockItem{{
			ProductID: 100, SKU: "SKU1", Name: "Kaos", Count: 10, Total: 30000, PriceUnit: 3000, ReceivedCount: 9,
			SupplierID: supplierID,
		}},
		Problems: []inventory_service_models.RestockProblemItem{
			{ProductID: 100, Count: 2, Note: "crushed", ProblemType: "broken"},
			{ProductID: 100, Count: 1, Note: "short", ProblemType: "missing"},
		},
	}

	if status == "accepted" {
		rr.AcceptedAt = &acceptedAt
	}

	err := db.Create(&rr).Error
	if err != nil {
		t.Fatalf("seed restock: %v", err)
	}

	return rr.ID
}

type backfilledRow struct {
	Day                 time.Time
	RestockCount        int64
	RestockValuation    int64
	ShippingLostCount   int64
	ShippingBrokenCount int64
}

// Every ACCEPTED restock naming a supplier is folded through supplier_service's own fold — the event its accept would
// have sent: 7 good at Rp 3.000, 1 short, 2 broken, on its Jakarta accept day. A pending restock and one with no
// supplier are not. Run again, it folds nothing (past-accepts-are-backfilled-once).
func TestBackfillSupplierFigures_FoldsTheAcceptedOnce(t *testing.T) {
	db := san_testdb.DB(t)
	san := &San{db: db, suppliers: NewSupplierFigures(db), target: "test"}

	supplier := uint64(31)
	// 23:30 on the 2nd in UTC is the 3rd in Jakarta — the day the figures must land on.
	acceptedAt := time.Date(2026, 9, 2, 23, 30, 0, 0, time.UTC)

	seedRestock(t, db, "accepted", &supplier, acceptedAt)
	seedRestock(t, db, "accepted", nil, acceptedAt)
	seedRestock(t, db, "ongoing", &supplier, acceptedAt)

	result, err := san.BackfillSupplierFigures(context.Background())
	if err != nil {
		t.Fatalf("backfill: %v", err)
	}

	if result.Folded != 1 {
		t.Fatalf("folded %d restocks, want 1 — only the accepted one naming a supplier", result.Folded)
	}

	var rows []backfilledRow

	err = db.Raw(`SELECT day, restock_count, restock_valuation, shipping_lost_count, shipping_broken_count
	              FROM supplier_product_daily_reports WHERE supplier_id = 31 AND product_id = 100 AND team_id = 12`).
		Scan(&rows).Error
	if err != nil {
		t.Fatalf("read figures: %v", err)
	}

	if len(rows) != 1 {
		t.Fatalf("%d figure rows, want 1", len(rows))
	}

	got := rows[0]
	if got.Day.Format("2006-01-02") != "2026-09-03" || got.RestockCount != 7 || got.RestockValuation != 21000 ||
		got.ShippingLostCount != 1 || got.ShippingBrokenCount != 2 {
		t.Fatalf("figures = %+v, want 2026-09-03: 7 good worth 21000, 1 lost, 2 broken", got)
	}

	_, err = san.BackfillSupplierFigures(context.Background())
	if !errors.Is(err, supplier_v1.ErrAlreadyBackfilled) {
		t.Fatalf("second run err = %v, want ErrAlreadyBackfilled", err)
	}
}
