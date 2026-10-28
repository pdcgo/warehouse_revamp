package liability_v1_test

import (
	"context"
	"testing"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_service_models"
	liability_v1 "github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_v1"
)

const (
	courierSellingTeam uint64 = 2
	courierWarehouse   uint64 = 5
	courierRestock     uint64 = 7001
)

func courierLegs(t *testing.T, db *gorm.DB) []liability_service_models.LiabilityLog {
	t.Helper()

	var legs []liability_service_models.LiabilityLog

	err := db.Where("source_id = ?", courierRestock).
		Order("id").Find(&legs).Error
	if err != nil {
		t.Fatalf("read legs: %v", err)
	}

	return legs
}

// The selling team owes the warehouse the courier's charge, once, keyed by the restock
// (balance-posts-the-couriers-debt-from-the-event).
func TestChargeRestockCourier_PostsTheDebtOnceForTheRestock(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, nil, nil)

	charge := liability_v1.CourierCharge{
		RestockID: courierRestock, SellingTeamID: courierSellingTeam, WarehouseID: courierWarehouse, Amount: 25000, ActorID: 9,
	}

	for range 2 {
		err := svc.ChargeRestockCourier(context.Background(), charge)
		if err != nil {
			t.Fatalf("ChargeRestockCourier: %v", err)
		}
	}

	legs := courierLegs(t, db)
	if len(legs) != 2 {
		t.Fatalf("%d ledger legs, want one posting (2 legs) — a redelivery must post nothing new", len(legs))
	}
}

// No charge, no entry — a zero reads as a debt of nothing.
func TestChargeRestockCourier_ZeroPostsNothing(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, nil, nil)

	err := svc.ChargeRestockCourier(context.Background(), liability_v1.CourierCharge{
		RestockID: courierRestock, SellingTeamID: courierSellingTeam, WarehouseID: courierWarehouse,
	})
	if err != nil {
		t.Fatalf("ChargeRestockCourier: %v", err)
	}

	if legs := courierLegs(t, db); len(legs) != 0 {
		t.Fatalf("%d legs posted for a restock with no charge, want 0", len(legs))
	}
}
