package liability_v1_test

import (
	"context"
	"testing"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_service_models"
	liability_v1 "github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_v1"
)

// The return's order — the SAME NUMBER as courierRestock on purpose: an order id and a restock id come from two
// services' sequences, and nothing keeps them apart.
const courierReturnOrder = courierRestock

func returnCourierLegs(t *testing.T, db *gorm.DB) []liability_service_models.LiabilityLog {
	t.Helper()

	var legs []liability_service_models.LiabilityLog

	err := db.Where("source_type = ? AND source_id = ?", "return_incidental_fee", courierReturnOrder).
		Order("id").Find(&legs).Error
	if err != nil {
		t.Fatalf("read legs: %v", err)
	}

	return legs
}

// The selling team owes the warehouse the courier's charge at a return, ONCE per order, as a `return_incidental_fee`
// (a-return-may-carry-the-couriers-ask) — a redelivery posts nothing new.
func TestChargeReturnCourier_PostsTheDebtOnceForTheOrder(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, nil, nil)

	charge := liability_v1.ReturnCourierCharge{
		OrderID: courierReturnOrder, SellingTeamID: courierSellingTeam, WarehouseID: courierWarehouse,
		Amount: 15_000, ActorID: 31,
	}

	for range 2 {
		err := svc.ChargeReturnCourier(context.Background(), charge)
		if err != nil {
			t.Fatalf("ChargeReturnCourier: %v", err)
		}
	}

	legs := returnCourierLegs(t, db)
	if len(legs) != 2 {
		t.Fatalf("%d ledger legs, want one posting (2 legs) — a redelivery must post nothing new", len(legs))
	}

	for _, leg := range legs {
		want := float64(15_000)
		if leg.TeamID == courierSellingTeam {
			want = -15_000
		}

		if leg.Amount != want || leg.ActorID != 31 {
			t.Fatalf("leg %+v, want %v by 31 — the selling team owes, the warehouse is owed", leg, want)
		}
	}
}

// ⚠ THE KEY DOES NOT COLLIDE WITH A RESTOCK'S. A restock's courier charge and a return's, for the same pair and the
// same number, are two debts — the second is not swallowed as a redelivery of the first.
func TestChargeReturnCourier_DoesNotCollideWithARestockOfTheSameNumber(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, nil, nil)
	ctx := context.Background()

	err := svc.ChargeRestockCourier(ctx, liability_v1.CourierCharge{
		RestockID: courierRestock, SellingTeamID: courierSellingTeam, WarehouseID: courierWarehouse, Amount: 25_000, ActorID: 9,
	})
	if err != nil {
		t.Fatalf("ChargeRestockCourier: %v", err)
	}

	err = svc.ChargeReturnCourier(ctx, liability_v1.ReturnCourierCharge{
		OrderID: courierReturnOrder, SellingTeamID: courierSellingTeam, WarehouseID: courierWarehouse, Amount: 15_000, ActorID: 31,
	})
	if err != nil {
		t.Fatalf("ChargeReturnCourier: %v", err)
	}

	if legs := returnCourierLegs(t, db); len(legs) != 2 {
		t.Fatalf("%d return legs, want 2 — the restock of the same number must not have taken its key", len(legs))
	}

	var balance float64

	err = db.Raw(`SELECT balance FROM liability_balances WHERE team_id = ? AND counterparty_id = ?`,
		courierWarehouse, courierSellingTeam).Scan(&balance).Error
	if err != nil {
		t.Fatalf("read balance: %v", err)
	}

	if balance != 40_000 {
		t.Fatalf("the warehouse is owed %v, want 40.000 — both charges", balance)
	}
}

// No charge, no entry — the common case: the courier rarely asks.
func TestChargeReturnCourier_ZeroPostsNothing(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, nil, nil)

	err := svc.ChargeReturnCourier(context.Background(), liability_v1.ReturnCourierCharge{
		OrderID: courierReturnOrder, SellingTeamID: courierSellingTeam, WarehouseID: courierWarehouse,
	})
	if err != nil {
		t.Fatalf("ChargeReturnCourier: %v", err)
	}

	if legs := returnCourierLegs(t, db); len(legs) != 0 {
		t.Fatalf("%d legs posted for a return with no charge, want 0", len(legs))
	}
}

// A TEAM THAT IS ITS OWN WAREHOUSE, accepting its own return, owes nobody: nothing is posted, and the event is ACKED rather
// than refused — PostEntry would refuse one team on both sides, and a NACK would redeliver it forever.
func TestChargeReturnCourier_NothingIsOwedToOneself(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, nil, nil)

	err := svc.ChargeReturnCourier(context.Background(), liability_v1.ReturnCourierCharge{
		OrderID: courierReturnOrder, SellingTeamID: courierSellingTeam, WarehouseID: courierSellingTeam, Amount: 15_000,
	})
	if err != nil {
		t.Fatalf("ChargeReturnCourier to oneself: %v", err)
	}

	if legs := returnCourierLegs(t, db); len(legs) != 0 {
		t.Fatalf("%d legs posted for a charge to oneself, want 0", len(legs))
	}
}
