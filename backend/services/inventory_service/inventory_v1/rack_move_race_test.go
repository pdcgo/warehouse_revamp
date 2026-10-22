//go:build raceaudit

// Concurrency audit for RackMove (the audit-sql skill): two people tidying the same racks, and a move racing an order's
// take of the same product.
//
//	go test -tags raceaudit -run "TestRace_RackMove" -v ./backend/services/inventory_service/inventory_v1/
package inventory_v1_test

import (
	"context"
	"fmt"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
)

func raceRack(t *testing.T, db *gorm.DB, code string) uint64 {
	t.Helper()

	var id uint64

	err := db.Raw(`SELECT id FROM placements WHERE warehouse_id = ? AND code = ?`, raceWarehouse, code).Scan(&id).Error
	if err != nil || id == 0 {
		t.Fatalf("rack %s: %v", code, err)
	}

	return id
}

// ⚠ THE DEADLOCK GUARD. Half the callers carry one unit Rak A → Rak B, the other half Rak B → Rak A. Every move locks
// both rows in ONE id-ordered statement, so they queue instead of deadlocking, and the units are all still there.
func TestRace_RackMove_OppositeMovesDoNotDeadlock(t *testing.T) {
	h := san_race.New(t, ledgerTables...)
	seedLedgers(t, h.DB(), 10, raceProductA)
	svc := raceService(h.DB())

	rakA, rakB := raceRack(t, h.DB(), "rak-a"), raceRack(t, h.DB(), "rak-b")

	res := h.Race(t, 8, func(i int) error {
		from, to := rakA, rakB
		if i%2 == 1 {
			from, to = rakB, rakA
		}

		_, err := svc.RackMove(context.Background(), connect.NewRequest(&inventoryv1.RackMoveRequest{
			TeamId: raceWarehouse, FromRackId: from,
			Lines: []*inventoryv1.RackMoveLine{{ProductId: raceProductA, Quantity: 1, ToRackId: to}},
		}))

		return err
	})
	res.Report(t)

	if n := res.Count(san_race.Deadlock); n != 0 {
		t.Fatalf("%d moves deadlocked", n)
	}

	if n := res.Failed(); n != 0 {
		t.Fatalf("%d of 8 moves failed with stock to spare", n)
	}

	if _, racks := stockOf(t, h.DB(), raceProductA); racks != 20 {
		t.Fatalf("the racks hold %d after the moves, want all 20", racks)
	}
}

// A MOVE RACING AN ORDER'S TAKE. Orders take from the racks while moves empty Rak A into Rak B: whatever interleaves, no
// rack goes below zero, nothing deadlocks, and the racks still hold exactly what the batches say.
func TestRace_RackMove_RacingATakeKeepsBothLedgersEqual(t *testing.T) {
	h := san_race.New(t, ledgerTables...)
	seedLedgers(t, h.DB(), 10, raceProductA)
	svc := raceService(h.DB())

	rakA, rakB := raceRack(t, h.DB(), "rak-a"), raceRack(t, h.DB(), "rak-b")

	res := h.Race(t, 12, func(i int) error {
		if i%2 == 0 {
			err := raceTake(svc, fmt.Sprintf("K-%d", i), &inventoryv1.OrderTransactionLine{ProductId: raceProductA, Quantity: 2})
			if connect.CodeOf(err) == connect.CodeFailedPrecondition {
				return nil
			}

			return err
		}

		_, err := svc.RackMove(context.Background(), connect.NewRequest(&inventoryv1.RackMoveRequest{
			TeamId: raceWarehouse, FromRackId: rakA,
			Lines: []*inventoryv1.RackMoveLine{{ProductId: raceProductA, Quantity: 2, ToRackId: rakB}},
		}))
		if connect.CodeOf(err) == connect.CodeFailedPrecondition {
			return nil // Rak A ran out — the right refusal
		}

		return err
	})
	res.Report(t)

	if n := res.Count(san_race.Deadlock); n != 0 {
		t.Fatalf("%d callers deadlocked", n)
	}

	if n := res.Failed(); n != 0 {
		t.Fatalf("%d callers failed for a reason other than running out", n)
	}

	batches, racks := stockOf(t, h.DB(), raceProductA)
	if batches != racks {
		t.Fatalf("batches hold %d, racks %d — the two ledgers drifted apart", batches, racks)
	}

	var negative int64
	h.DB().Raw(`SELECT COUNT(*) FROM product_placements WHERE stock_count < 0`).Scan(&negative)
	if negative != 0 {
		t.Fatalf("%d rack rows below zero", negative)
	}
}
