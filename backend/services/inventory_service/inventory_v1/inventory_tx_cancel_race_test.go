//go:build raceaudit

// Concurrency audit for the InventoryTxCancel listener (backlog #10 slice 3, the-compensation-event-is-inventory-tx-cancel)
// — the compensation of a failed order create, which can meet its own take in flight (the take's answer lost, the
// cancel published) and can be delivered twice at once (Pub/Sub delivers at least once).
//
// Build-tagged so it never runs beside the rolling-back tests: san_race COMMITS.
//
//	go test -tags raceaudit -p 1 -run "TestRace_TakeVsTxCancel|TestRace_TxCancelRedelivery" -v ./backend/services/inventory_service/inventory_v1/
package inventory_v1_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"connectrpc.com/connect"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

func raceTxCancel(svc *inventory_v1.Service, key string) error {
	return svc.InventoryTxCancel(context.Background(), &eventsv1.InventoryTxCancel{
		IdempotencyKey: key, TeamId: raceOwner, WarehouseId: raceWarehouse, ActorId: 9, Reason: "race",
	})
}

// THE TAKE AND ITS CANCEL AT ONCE, same K, 20 rounds: either the cancel claims K first and the take is refused as a used
// key, or the take lands first and the cancel rolls it back — the cancel's claim INSERT waits on the take's uncommitted
// key and then finds its transaction. Either way the shelves end where they started WITHOUT a settling release, and a
// release afterwards finds nothing left to give back.
func TestRace_TakeVsTxCancel(t *testing.T) {
	h := san_race.New(t, ledgerTables...)
	seedLedgers(t, h.DB(), 10, raceProductA)
	svc := raceService(h.DB())

	var refused, rolledBack int

	for round := range 20 {
		key := fmt.Sprintf("K-vs-cancel-%d", round)

		var takeErr error

		res := h.Race(t, 2, func(i int) error {
			if i == 0 {
				takeErr = raceTake(svc, key, &inventoryv1.OrderTransactionLine{ProductId: raceProductA, Quantity: 3})
				if connect.CodeOf(takeErr) == connect.CodeAlreadyExists {
					return nil
				}

				return takeErr
			}

			// The take reads the product facts before its transaction, so a cancel released at the same instant always
			// wins. Held back a little longer each round, the cancel also lands after the take and in the middle of it.
			time.Sleep(time.Duration(round%10) * time.Millisecond)

			return raceTxCancel(svc, key)
		})
		if round == 0 {
			res.Report(t)
		}

		if n := res.Failed(); n != 0 {
			t.Fatalf("round %d: %d callers failed", round, n)
		}

		if b, r := stockOf(t, h.DB(), raceProductA); b != 20 || r != 20 {
			t.Fatalf("round %d: batches %d, racks %d, want 20 and 20 — the take and its cancel must net to zero", round, b, r)
		}

		after, err := svc.OrderTransactionRelease(context.Background(), connect.NewRequest(&inventoryv1.OrderTransactionReleaseRequest{
			TeamId: raceOwner, IdempotencyKey: key,
		}))
		if err != nil || after.Msg.GetReleased() {
			t.Fatalf("round %d: a release after the race = %+v, %v — want nothing left to give back", round, after, err)
		}

		if takeErr == nil {
			rolledBack++
		} else {
			refused++
		}
	}

	t.Logf("20 rounds: take landed and was rolled back %d, take refused as a used key %d", rolledBack, refused)
}

// THE SAME CANCEL DELIVERED TWICE AT ONCE, 10 rounds: one rollback. The second waits on the first's claim row lock, then
// finds the take released — the shelf gets the 3 units back once, never 6.
func TestRace_TxCancelRedelivery(t *testing.T) {
	h := san_race.New(t, ledgerTables...)
	seedLedgers(t, h.DB(), 10, raceProductA)
	svc := raceService(h.DB())

	for round := range 10 {
		key := fmt.Sprintf("K-redelivered-%d", round)

		err := raceTake(svc, key, &inventoryv1.OrderTransactionLine{ProductId: raceProductA, Quantity: 3})
		if err != nil {
			t.Fatalf("round %d: take: %v", round, err)
		}

		res := h.Race(t, 2, func(int) error {
			return raceTxCancel(svc, key)
		})
		if round == 0 {
			res.Report(t)
		}

		if n := res.Failed(); n != 0 {
			t.Fatalf("round %d: %d deliveries failed", round, n)
		}

		if b, r := stockOf(t, h.DB(), raceProductA); b != 20 || r != 20 {
			t.Fatalf("round %d: batches %d, racks %d, want 20 and 20 — exactly one rollback", round, b, r)
		}
	}
}
