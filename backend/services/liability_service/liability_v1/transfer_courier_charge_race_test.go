//go:build raceaudit

// Concurrency audit for the transfer courier charge (the audit-sql skill) — liability's listener on Warehouse Transfer
// Accepted (a-transfer-charge-is-a-transfer-fee). Its idempotency is the ledger's unique key, not a claim table: these
// tests hold it to that when Pub/Sub redelivers while the first delivery is still running, and when a restock's charge
// with the same number for the same pair lands at the same instant.
//
//	go test -tags raceaudit -run 'TestRace_ChargeTransferCourier' -count=1 -v ./backend/services/liability_service/liability_v1/
package liability_v1_test

import (
	"context"
	"testing"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	liability_v1 "github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_v1"
)

// The tables this audit writes — the ledger's two.
var transferFeeTables = []string{"liability_logs", "liability_balances"}

func warehouseOwed(t *testing.T, h *san_race.Harness) float64 {
	t.Helper()

	var balance float64

	err := h.DB().Raw(`SELECT COALESCE(SUM(balance), 0) FROM liability_balances WHERE team_id = ? AND counterparty_id = ?`,
		courierWarehouse, courierSellingTeam).Scan(&balance).Error
	if err != nil {
		t.Fatalf("read balance: %v", err)
	}

	return balance
}

// The same accept delivered eight times at once: the debt posts ONCE. Every delivery is ACKED — a loser of the unique
// key reads ErrAlreadyPosted, which is the right answer, not a failure — and the balance holds one charge.
func TestRace_ChargeTransferCourier_OneEventEightDeliveries(t *testing.T) {
	h := san_race.New(t, transferFeeTables...)
	svc := liability_v1.NewService(h.DB(), nil, nil, nil)

	res := h.Race(t, 8, func(int) error {
		return svc.ChargeTransferCourier(context.Background(), transferCharge(5_000))
	})
	res.Report(t)

	if res.Failed() != 0 {
		t.Fatalf("%d deliveries failed — a redelivery must ACK, never NACK into a loop", res.Failed())
	}

	var legs int64

	err := h.DB().Raw(`SELECT COUNT(*) FROM liability_logs WHERE source_type = 'transfer_fee' AND source_id = ?`,
		courierTransfer).Scan(&legs).Error
	if err != nil {
		t.Fatalf("count legs: %v", err)
	}

	if legs != 2 {
		t.Fatalf("%d legs, want one posting (2) — the charge posted more than once", legs)
	}

	if got := warehouseOwed(t, h); got != 5_000 {
		t.Fatalf("the warehouse is owed %v, want 5.000 — one charge", got)
	}
}

// A restock's courier charge and a transfer's, the SAME number for the SAME pair, at the same instant: both post — the
// keys differ by source type — and the shared balance row loses neither (moveBalance's upsert serialises them).
func TestRace_ChargeTransferCourier_BesideARestockOfTheSameNumber(t *testing.T) {
	h := san_race.New(t, transferFeeTables...)
	svc := liability_v1.NewService(h.DB(), nil, nil, nil)
	ctx := context.Background()

	res := h.Race(t, 8, func(i int) error {
		if i%2 == 0 {
			return svc.ChargeTransferCourier(ctx, transferCharge(5_000))
		}

		return svc.ChargeRestockCourier(ctx, liability_v1.CourierCharge{
			RestockID: courierRestock, SellingTeamID: courierSellingTeam, WarehouseID: courierWarehouse, Amount: 25_000, ActorID: 9,
		})
	})
	res.Report(t)

	if n := res.Count(san_race.Deadlock); n != 0 {
		t.Fatalf("%d deadlocks", n)
	}

	if res.Failed() != 0 {
		t.Fatalf("%d deliveries failed", res.Failed())
	}

	if got := warehouseOwed(t, h); got != 30_000 {
		t.Fatalf("the warehouse is owed %v, want 30.000 — the restock's and the transfer's, once each", got)
	}
}
