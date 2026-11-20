package liability_v1_test

import (
	"context"
	"testing"
	"time"

	"gorm.io/gorm"

	liabilityv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/liability/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_service_models"
	liability_v1 "github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_v1"
)

// The custom shipment — the SAME NUMBER as courierRestock and courierTransfer on purpose: parcels, restocks and
// transfers are numbered separately, and nothing keeps them apart but the source type.
const courierParcel = courierRestock

func parcelCourierLegs(t *testing.T, db *gorm.DB) []liability_service_models.LiabilityLog {
	t.Helper()

	var legs []liability_service_models.LiabilityLog

	err := db.Where("source_type = ? AND source_id = ?", "custom_shipment_fee", courierParcel).
		Order("id").
		Find(&legs).
		Error
	if err != nil {
		t.Fatalf("read legs: %v", err)
	}

	return legs
}

func parcelCharge(amount float64) liability_v1.CustomShipmentCourierCharge {
	return liability_v1.CustomShipmentCourierCharge{
		CustomShipmentID: courierParcel, SellingTeamID: courierSellingTeam, WarehouseID: courierWarehouse,
		Amount: amount, ActorID: 35,
	}
}

// the-courier-is-paid-by-the-team-or-by-the-warehouse, *Gudang bayar*: the selling team owes the warehouse it shipped
// from what it paid the courier at the handover, ONCE per parcel, as a `custom_shipment_fee` — the same event twice is
// one posting. Exact, never rounded (the-backend-never-rounds-money).
func TestChargeCustomShipmentCourier_PostsTheDebtOnceForTheParcel(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, nil, nil)

	for range 2 {
		err := svc.ChargeCustomShipmentCourier(context.Background(), parcelCharge(18_500.5))
		if err != nil {
			t.Fatalf("ChargeCustomShipmentCourier: %v", err)
		}
	}

	legs := parcelCourierLegs(t, db)
	if len(legs) != 2 {
		t.Fatalf("%d ledger legs, want one posting (2 legs) — a redelivery must post nothing new", len(legs))
	}

	if legs[0].GroupID != legs[1].GroupID {
		t.Fatalf("groups %d/%d — the two legs of one posting share one", legs[0].GroupID, legs[1].GroupID)
	}

	for _, leg := range legs {
		want, counterparty := 18_500.5, courierSellingTeam
		if leg.TeamID == courierSellingTeam {
			want, counterparty = -18_500.5, courierWarehouse
		}

		if leg.Amount != want || leg.CounterpartyID != counterparty || leg.ActorID != 35 || leg.Reversal || leg.IsOverride {
			t.Fatalf("leg %+v, want %v by 35 — the selling team owes, the warehouse that shipped is owed", leg, want)
		}
	}
}

// ⚠ THE KEY DOES NOT COLLIDE. Restock 7001's courier charge, transfer 7001's and custom shipment 7001's, for the same
// pair, are three debts — none is swallowed as a redelivery of another (a-transfer-charge-is-a-transfer-fee).
func TestChargeCustomShipmentCourier_DoesNotCollideWithARestockOrATransferOfTheSameNumber(t *testing.T) {
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

	err = svc.ChargeCustomShipmentCourier(ctx, parcelCharge(3_000))
	if err != nil {
		t.Fatalf("ChargeCustomShipmentCourier: %v", err)
	}

	if legs := parcelCourierLegs(t, db); len(legs) != 2 {
		t.Fatalf("%d parcel legs, want 2 — the restock or transfer of the same number must not have taken its key", len(legs))
	}

	var balance float64

	err = db.Raw(`SELECT balance FROM liability_balances WHERE team_id = ? AND counterparty_id = ?`,
		courierWarehouse, courierSellingTeam).Scan(&balance).Error
	if err != nil {
		t.Fatalf("read balance: %v", err)
	}

	if balance != 33_000 {
		t.Fatalf("the warehouse is owed %v, want 33.000 — all three charges", balance)
	}
}

// No cost, no entry — the warehouse may type 0 at the handover, and the event is published after every handover.
func TestChargeCustomShipmentCourier_ZeroPostsNothing(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, nil, nil)

	err := svc.ChargeCustomShipmentCourier(context.Background(), parcelCharge(0))
	if err != nil {
		t.Fatalf("ChargeCustomShipmentCourier: %v", err)
	}

	if legs := parcelCourierLegs(t, db); len(legs) != 0 {
		t.Fatalf("%d legs posted for a parcel with no courier cost, want 0", len(legs))
	}
}

// A team that ships from its own building owes nobody: nothing posts, and the event is ACKED — PostEntry would refuse
// one team on both sides, and a NACK would redeliver it forever.
func TestChargeCustomShipmentCourier_NothingIsOwedToOneself(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, nil, nil)

	charge := parcelCharge(5_000)
	charge.WarehouseID = courierSellingTeam

	err := svc.ChargeCustomShipmentCourier(context.Background(), charge)
	if err != nil {
		t.Fatalf("ChargeCustomShipmentCourier to oneself: %v", err)
	}

	if legs := parcelCourierLegs(t, db); len(legs) != 0 {
		t.Fatalf("%d legs posted for a charge to oneself, want 0", len(legs))
	}
}

// an-override-is-stamped-in-every-service: a handover by Root or the Administrator from outside the warehouse stamps
// both legs.
func TestChargeCustomShipmentCourier_StampsAnOverride(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, nil, nil)

	charge := parcelCharge(7_000)
	charge.ActorIsOverride = true

	err := svc.ChargeCustomShipmentCourier(context.Background(), charge)
	if err != nil {
		t.Fatalf("ChargeCustomShipmentCourier: %v", err)
	}

	legs := parcelCourierLegs(t, db)
	if len(legs) != 2 || !legs[0].IsOverride || !legs[1].IsOverride {
		t.Fatalf("legs %+v, want both stamped as an override", legs)
	}
}

// The screens read it by its own name: the history line's source type is CUSTOM_SHIPMENT_FEE and its id the parcel
// (the cause the detail page words), and the daily statement's by_source carries it under that key — the one the
// statement's courier column adds to the restock's, the return's and the transfer's.
func TestChargeCustomShipmentCourier_TheScreensReadItAsACustomShipmentFee(t *testing.T) {
	db := san_testdb.DB(t)
	svc := liability_v1.NewService(db, nil, nil, nil)

	err := svc.ChargeCustomShipmentCourier(context.Background(), parcelCharge(12_000))
	if err != nil {
		t.Fatalf("ChargeCustomShipmentCourier: %v", err)
	}

	msg := history(t, svc, courierWarehouse, courierSellingTeam)
	rows := entryRows(msg)

	if len(rows) != 1 {
		t.Fatalf("%d history lines, want 1", len(rows))
	}

	if rows[0].GetSourceType() != liabilityv1.LiabilitySourceType_LIABILITY_SOURCE_TYPE_CUSTOM_SHIPMENT_FEE ||
		rows[0].GetSourceId() != courierParcel || rows[0].GetAmount() != 12_000 {
		t.Fatalf("history line %+v, want a CUSTOM_SHIPMENT_FEE of 12.000 for parcel %d", rows[0], courierParcel)
	}

	// On a fixed Jakarta day, so the window is exact.
	at := time.Date(2026, 3, 10, 10, 0, 0, 0, time.FixedZone("WIB", 7*3600))

	err = db.Exec(`UPDATE liability_logs SET created_at = ? WHERE source_type = 'custom_shipment_fee' AND source_id = ?`,
		at, courierParcel).Error
	if err != nil {
		t.Fatalf("backdate: %v", err)
	}

	res := daily(t, svc, courierWarehouse, "2026-03-10", "2026-03-10")
	key := int32(liabilityv1.LiabilitySourceType_LIABILITY_SOURCE_TYPE_CUSTOM_SHIPMENT_FEE)

	if len(res.GetDays()) != 1 || res.GetDays()[0].GetBySource()[key] != 12_000 || res.GetTotals().GetBySource()[key] != 12_000 {
		t.Fatalf("daily = %+v, want 12.000 under CUSTOM_SHIPMENT_FEE (key %d)", res, key)
	}
}
