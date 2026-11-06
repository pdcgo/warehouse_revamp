package liability_v1_test

import (
	"context"
	"testing"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_service_models"
	liability_v1 "github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_v1"
)

// The transfer — the SAME NUMBER as courierRestock on purpose: transfers and restocks are numbered separately, and
// nothing keeps them apart.
const courierTransfer = courierRestock

func transferCourierLegs(t *testing.T, db *gorm.DB) []liability_service_models.LiabilityLog {
	t.Helper()

	var legs []liability_service_models.LiabilityLog

	err := db.Where("source_type = ? AND source_id = ?", "transfer_fee", courierTransfer).
		Order("id").Find(&legs).Error
	if err != nil {
		t.Fatalf("read legs: %v", err)
	}

	return legs
}

func transferCharge(amount float64) liability_v1.TransferCourierCharge {
	return liability_v1.TransferCourierCharge{
		TransferID: courierTransfer, SellingTeamID: courierSellingTeam, WarehouseID: courierWarehouse,
		Amount: amount, ActorID: 33,
	}
}

// The selling team owes the receiving warehouse the courier's charge at its door, ONCE per transfer, as a
// `transfer_fee` (a-transfer-charge-is-a-transfer-fee) — a redelivery posts nothing new.
func TestChargeTransferCourier_PostsTheDebtOnceForTheTransfer(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, nil, nil)

	for range 2 {
		err := svc.ChargeTransferCourier(context.Background(), transferCharge(5_000))
		if err != nil {
			t.Fatalf("ChargeTransferCourier: %v", err)
		}
	}

	legs := transferCourierLegs(t, db)
	if len(legs) != 2 {
		t.Fatalf("%d ledger legs, want one posting (2 legs) — a redelivery must post nothing new", len(legs))
	}

	if legs[0].GroupID != legs[1].GroupID {
		t.Fatalf("groups %d/%d — the two legs of one posting share one", legs[0].GroupID, legs[1].GroupID)
	}

	for _, leg := range legs {
		want, counterparty := float64(5_000), courierSellingTeam
		if leg.TeamID == courierSellingTeam {
			want, counterparty = -5_000, courierWarehouse
		}

		if leg.Amount != want || leg.CounterpartyID != counterparty || leg.ActorID != 33 || leg.Reversal {
			t.Fatalf("leg %+v, want %v by 33 — the selling team owes, the receiving warehouse is owed", leg, want)
		}
	}
}

// ⚠ THE KEY DOES NOT COLLIDE WITH A RESTOCK'S. Restock 7001's courier charge and transfer 7001's, for the same pair, are
// two debts — the second is not swallowed as a redelivery of the first.
func TestChargeTransferCourier_DoesNotCollideWithARestockOfTheSameNumber(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, nil, nil)
	ctx := context.Background()

	err := svc.ChargeRestockCourier(ctx, liability_v1.CourierCharge{
		RestockID: courierRestock, SellingTeamID: courierSellingTeam, WarehouseID: courierWarehouse, Amount: 25_000, ActorID: 9,
	})
	if err != nil {
		t.Fatalf("ChargeRestockCourier: %v", err)
	}

	err = svc.ChargeTransferCourier(ctx, transferCharge(5_000))
	if err != nil {
		t.Fatalf("ChargeTransferCourier: %v", err)
	}

	if legs := transferCourierLegs(t, db); len(legs) != 2 {
		t.Fatalf("%d transfer legs, want 2 — the restock of the same number must not have taken its key", len(legs))
	}

	var balance float64

	err = db.Raw(`SELECT balance FROM liability_balances WHERE team_id = ? AND counterparty_id = ?`,
		courierWarehouse, courierSellingTeam).Scan(&balance).Error
	if err != nil {
		t.Fatalf("read balance: %v", err)
	}

	if balance != 30_000 {
		t.Fatalf("the warehouse is owed %v, want 30.000 — both charges", balance)
	}
}

// No charge, no entry — the event is published after EVERY accept, 0 included.
func TestChargeTransferCourier_ZeroPostsNothing(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, nil, nil)

	err := svc.ChargeTransferCourier(context.Background(), transferCharge(0))
	if err != nil {
		t.Fatalf("ChargeTransferCourier: %v", err)
	}

	if legs := transferCourierLegs(t, db); len(legs) != 0 {
		t.Fatalf("%d legs posted for a transfer with no charge, want 0", len(legs))
	}
}

// A team that is its own receiving warehouse owes nobody: nothing posts, and the event is ACKED — PostEntry would refuse
// one team on both sides, and a NACK would redeliver it forever.
func TestChargeTransferCourier_NothingIsOwedToOneself(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, nil, nil)

	charge := transferCharge(5_000)
	charge.WarehouseID = courierSellingTeam

	err := svc.ChargeTransferCourier(context.Background(), charge)
	if err != nil {
		t.Fatalf("ChargeTransferCourier to oneself: %v", err)
	}

	if legs := transferCourierLegs(t, db); len(legs) != 0 {
		t.Fatalf("%d legs posted for a charge to oneself, want 0", len(legs))
	}
}
