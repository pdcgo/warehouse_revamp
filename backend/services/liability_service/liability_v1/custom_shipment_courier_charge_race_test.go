//go:build raceaudit

// Concurrency audit for the custom shipment courier charge (the audit-sql skill) — liability's listener on Custom
// Shipment Handed Over, *Gudang bayar* (the-courier-is-paid-by-the-team-or-by-the-warehouse). The transfer charge's twin:
// its idempotency is the ledger's unique key, not a claim table. These tests hold it to that when Pub/Sub redelivers
// while the first delivery is still running, and when a restock's and a transfer's charge with the same number for the
// same pair land at the same instant.
//
//	go test -tags raceaudit -run 'TestRace_ChargeCustomShipmentCourier' -count=1 -v ./backend/services/liability_service/liability_v1/
package liability_v1_test

import (
	"context"
	"testing"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	liability_v1 "github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_v1"
)

// The same handover delivered eight times at once: the debt posts ONCE. Every delivery is ACKED — a loser of the unique
// key reads ErrAlreadyPosted, which is the right answer, not a failure — and the balance holds one charge.
func TestRace_ChargeCustomShipmentCourier_OneEventEightDeliveries(t *testing.T) {
	h := san_race.New(t, transferFeeTables...)
	svc := liability_v1.NewService(h.DB(), nil, nil, nil)

	res := h.Race(t, 8, func(int) error {
		return svc.ChargeCustomShipmentCourier(context.Background(), parcelCharge(6_000))
	})
	res.Report(t)

	if res.Failed() != 0 {
		t.Fatalf("%d deliveries failed — a redelivery must ACK, never NACK into a loop", res.Failed())
	}

	var legs int64

	err := h.DB().Raw(`SELECT COUNT(*) FROM liability_logs WHERE source_type = 'custom_shipment_fee' AND source_id = ?`,
		courierParcel).Scan(&legs).Error
	if err != nil {
		t.Fatalf("count legs: %v", err)
	}

	if legs != 2 {
		t.Fatalf("%d legs, want one posting (2) — the charge posted more than once", legs)
	}

	if got := warehouseOwed(t, h); got != 6_000 {
		t.Fatalf("the warehouse is owed %v, want 6.000 — one charge", got)
	}
}

// A restock's, a transfer's and a custom shipment's courier charge, the SAME number for the SAME pair, at the same
// instant: all post — the keys differ by source type — and the shared balance row loses none (moveBalance's upsert
// serialises them), with no deadlock.
func TestRace_ChargeCustomShipmentCourier_BesideARestockAndATransferOfTheSameNumber(t *testing.T) {
	h := san_race.New(t, transferFeeTables...)
	svc := liability_v1.NewService(h.DB(), nil, nil, nil)
	ctx := context.Background()

	res := h.Race(t, 9, func(i int) error {
		switch i % 3 {
		case 0:
			return svc.ChargeCustomShipmentCourier(ctx, parcelCharge(6_000))
		case 1:
			return svc.ChargeTransferCourier(ctx, transferCharge(5_000))
		default:
			return svc.ChargeRestockCourier(ctx, liability_v1.CourierCharge{
				RestockID: courierRestock, SellingTeamID: courierSellingTeam, WarehouseID: courierWarehouse, Amount: 25_000, ActorID: 9,
			})
		}
	})
	res.Report(t)

	if n := res.Count(san_race.Deadlock); n != 0 {
		t.Fatalf("%d deadlocks", n)
	}

	if res.Failed() != 0 {
		t.Fatalf("%d deliveries failed", res.Failed())
	}

	if got := warehouseOwed(t, h); got != 36_000 {
		t.Fatalf("the warehouse is owed %v, want 36.000 — the restock's, the transfer's and the parcel's, once each", got)
	}
}
