//go:build raceaudit

// Concurrency audit for the OrderCancelled listener (backlog #10 slice 4, inventory-returns-stock-on-order-cancelled) —
// the release of a cancelled order's take by its key, which can meet the compensation's late InventoryTxCancel on the
// same key, its own redelivery, and a stock count planned in the same instant as the cancel's count check.
//
// Build-tagged so it never runs beside the rolling-back tests: san_race COMMITS.
//
//	go test -tags raceaudit -p 1 -run "TestRace_OrderCancelled" -v ./backend/services/inventory_service/inventory_v1/
package inventory_v1_test

import (
	"context"
	"fmt"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

func raceOrderCancelled(svc *inventory_v1.Service, key string) error {
	return svc.OrderCancelled(context.Background(), &eventsv1.OrderCancelled{
		TeamId: raceOwner, OrderId: 1, ShopId: 1, ActorId: 9, IdempotencyKey: key, WarehouseId: raceWarehouse,
	})
}

// ORDERCANCELLED, ITS REDELIVERY AND A LATE INVENTORYTXCANCEL ON THE SAME KEY, all at once, 10 rounds: ONE rollback. Each
// waits on the claim row's lock in turn and the later ones find the take released — the shelf gets the 3 units back
// once, never 6 or 9.
func TestRace_OrderCancelled_AndALateTxCancelRollBackOnce(t *testing.T) {
	h := san_race.New(t, ledgerTables...)
	seedLedgers(t, h.DB(), 10, raceProductA)
	svc := raceService(h.DB())

	for round := range 10 {
		key := fmt.Sprintf("K-cancelled-%d", round)

		err := raceTake(svc, key, &inventoryv1.OrderTransactionLine{ProductId: raceProductA, Quantity: 3})
		if err != nil {
			t.Fatalf("round %d: take: %v", round, err)
		}

		res := h.Race(t, 3, func(i int) error {
			if i == 2 {
				return raceTxCancel(svc, key)
			}

			return raceOrderCancelled(svc, key)
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

		var rollbacks int64
		h.DB().Raw(`SELECT COUNT(*) FROM inventory_transactions t JOIN idempotency_order_check c ON c.transaction_id = t.id
			WHERE c.idempotency_key = ? AND t.is_rollback`, key).Scan(&rollbacks)

		if rollbacks != 1 {
			t.Fatalf("round %d: the take is rolled back %d times, want 1", round, rollbacks)
		}
	}
}

// A CANCEL RACING A COUNT START (a-cancel-still-meets-the-count-first), 10 rounds: the order's cancel checks the count
// (StockLockCheck) and then its OrderCancelled is delivered, while a count of the product is planned. Three ways it ends,
// each correct:
//
//   - the check sees the count → the cancel is refused before anything changes (the order stays pending);
//   - the check passes and the release locks the shelf first → released, and the count copies the book it left;
//   - the check passes, THEN the count locks → the release is refused naming the count — the listener's error, so the
//     broker redelivers — and the redelivery after the count ends releases.
//
// Whichever, once the count is called off the stock is all back, and the count's book was always the racks'.
func TestRace_OrderCancelled_RacingACountStartWaitsForIt(t *testing.T) {
	h := san_race.New(t, ledgerTables...)
	seedLedgers(t, h.DB(), 10, raceProductA)
	svc := raceService(h.DB())

	var refusedFirst, releasedFirst, waited int

	for round := range 10 {
		key := fmt.Sprintf("K-vs-count-%d", round)

		err := raceTake(svc, key, &inventoryv1.OrderTransactionLine{ProductId: raceProductA, Quantity: 3})
		if err != nil {
			t.Fatalf("round %d: take: %v", round, err)
		}

		var (
			session   uint64
			checked   bool
			refused   bool
			deliverEr error
		)

		res := h.Race(t, 2, func(i int) error {
			// Odd rounds hold the count back, even rounds the cancel, a little longer each time — so all three ends are hit.
			delay := time.Duration(round%5) * 2 * time.Millisecond

			if i == 0 {
				if round%2 == 1 {
					time.Sleep(delay)
				}

				planned, planErr := svc.OpnameSessionCreate(raceAdmin(43), connect.NewRequest(&inventoryv1.OpnameSessionCreateRequest{
					TeamId: raceWarehouse, Plan: inventoryv1.OpnamePlan_OPNAME_PLAN_PRODUCT, FilterProductId: raceProductA,
				}))
				if planErr != nil {
					return planErr
				}

				session = planned.Msg.GetSession().GetId()

				return nil
			}

			if round%2 == 0 {
				time.Sleep(delay)
			}

			// The order's cancel: the count first, then — if nothing held it — the status moves and the event goes out.
			lock, checkErr := svc.StockLockCheck(context.Background(), raceOwner, raceWarehouse, key)
			if checkErr != nil {
				return checkErr
			}

			checked = true

			if lock != nil {
				refused = true

				return nil
			}

			deliverEr = raceOrderCancelled(svc, key)

			return nil
		})
		if round == 0 {
			res.Report(t)
		}

		if n := res.Failed(); n != 0 {
			t.Fatalf("round %d: %d callers failed", round, n)
		}

		if !checked || session == 0 {
			t.Fatalf("round %d: checked %v, count %d — both sides must have run", round, checked, session)
		}

		switch {
		case refused:
			refusedFirst++
		case deliverEr == nil:
			releasedFirst++
		default:
			if !strings.Contains(deliverEr.Error(), "being counted") {
				t.Fatalf("round %d: the release failed for another reason: %v", round, deliverEr)
			}

			waited++
		}

		// The count's book is the racks' as they stand under it — no release slipped in.
		var book int64
		h.DB().Raw(`SELECT COALESCE(SUM(system_stock_count), 0) FROM opname_session_snapshots WHERE opname_session_id = ?`,
			session).Scan(&book)

		if _, r := stockOf(t, h.DB(), raceProductA); book != r {
			t.Fatalf("round %d: the count copied a book of %d, the racks hold %d", round, book, r)
		}

		_, err = svc.OpnameSessionCancel(raceAdmin(43), connect.NewRequest(&inventoryv1.OpnameSessionCancelRequest{
			TeamId: raceWarehouse, SessionId: session,
		}))
		if err != nil {
			t.Fatalf("round %d: cancel the count: %v", round, err)
		}

		// The redelivery after the count — or, for a refused cancel, the person cancelling again.
		err = raceOrderCancelled(svc, key)
		if err != nil {
			t.Fatalf("round %d: the release after the count: %v", round, err)
		}

		if b, r := stockOf(t, h.DB(), raceProductA); b != 20 || r != 20 {
			t.Fatalf("round %d: batches %d, racks %d, want 20 and 20 once released", round, b, r)
		}
	}

	t.Logf("10 rounds: refused by the check %d, released before the count %d, waited for the count %d",
		refusedFirst, releasedFirst, waited)
}
