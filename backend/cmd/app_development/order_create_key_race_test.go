//go:build raceaudit

// Concurrency audit for OrderCreate's idempotency key (backlog #10 — slice 1 the-idempotency-key-is-unique,
// the-order-refuses-a-used-key; slice 3 the take before the order row): two submits of ONE key at the same second.
// OrderCreate's lookup cannot stop them (both read before either commits). Since slice 3 the take runs first, under the
// key, so inventory's claim of the key refuses the twin as KEY_USED — and a used key is never compensated
// (a-used-key-is-never-cancelled), so the winner's take survives and the shelf gives up exactly one take.
//
// In the composition root, beside order_create_race_test.go, because the stock is inventory's REAL take.
//
//	go test -tags raceaudit -p 1 -run "TestRace_OrderCreateSameKey|TestInterleave_OrderCreateSameKey" -v ./backend/cmd/app_development/
package main

import (
	"context"
	"errors"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	warehouse_v1 "github.com/pdcgo/warehouse_revamp/backend/services/warehouse_service/warehouse_v1"
)

// keyUsedRefusal reports whether err is OrderCreate's used-key refusal: AlreadyExists carrying inventory's
// OrderTransactionRefusal with KEY_USED (⚠ #10 Q9 default).
func keyUsedRefusal(err error) bool {
	var connectErr *connect.Error
	if !errors.As(err, &connectErr) || connectErr.Code() != connect.CodeAlreadyExists {
		return false
	}

	for _, detail := range connectErr.Details() {
		value, valueErr := detail.Value()
		if valueErr != nil {
			continue
		}

		refusal, ok := value.(*inventoryv1.OrderTransactionRefusal)
		if ok && refusal.GetReason() == inventoryv1.OrderTransactionRefusalReason_ORDER_TRANSACTION_REFUSAL_REASON_KEY_USED {
			return true
		}
	}

	return false
}

// assertOneTakeUnderKey checks the data a same-key race must leave: one order holding the key, and a shelf of 4 that
// gave up exactly the one take of 2.
func assertOneTakeUnderKey(t *testing.T, db *gorm.DB, round int, key string) {
	t.Helper()

	var keyed, all int64

	db.Raw(`SELECT COUNT(*) FROM orders WHERE idempotency_key = ?`, key).Scan(&keyed)
	db.Raw(`SELECT COUNT(*) FROM orders`).Scan(&all)

	if keyed != 1 || all != 1 {
		t.Fatalf("round %d: %d orders hold the key, %d in all — want exactly one", round, keyed, all)
	}

	var left int64

	db.Raw(`SELECT COALESCE(SUM(stock_count), 0) FROM batches WHERE product_id = ?`, ocProduct).Scan(&left)
	if left != 2 {
		t.Fatalf("round %d: the shelf holds %d of 4 after one order of 2, want 2 — the stock net one take", round, left)
	}
}

// TWO SUBMITS OF ONE KEY, released at once, five rounds: exactly one order; the other caller is refused as a used key
// (whether the lookup or the unique index caught it); the shelf gives up one take of 2. The data is asserted.
func TestRace_OrderCreateSameKey(t *testing.T) {
	h := san_race.New(t, orderRaceTables...)
	db := h.DB()

	for round := range 5 {
		resetOrderRace(t, db)
		shop := seedTwoBatches(t, db)
		svc := orderService(db, nil)
		req := twoUnits(shop)

		res := h.Race(t, 2, func(int) error {
			_, err := svc.OrderCreate(context.Background(), connect.NewRequest(req))

			return err
		})

		if round == 0 {
			res.Report(t)
		}

		var won, refused int

		for _, o := range res.Outcomes {
			switch {
			case o.Err == nil:
				won++
			case keyUsedRefusal(o.Err):
				refused++
			default:
				t.Fatalf("round %d: caller %d failed with %v (%s), want success or the KEY_USED refusal", round, o.I, o.Err,
					o.Kind)
			}
		}

		if won != 1 || refused != 1 {
			t.Fatalf("round %d: %d placed and %d refused as a used key, want 1 and 1", round, won, refused)
		}

		assertOneTakeUnderKey(t, db, round, req.GetIdempotencyKey())
	}
}

// THE TAKE REFUSES THE TWIN, step by step. Submit 1 is parked in the fee call — its take committed under the key, its
// row inserted, uncommitted. Submit 2 of the same key passes the order lookup (submit 1 is invisible to it), and its take
// is refused AT ONCE as KEY_USED: inventory's claim of the key committed with submit 1's take, so nothing waits. Submit 2
// releases nothing (a-used-key-is-never-cancelled) — submit 1's take survives it — and submit 1 then commits.
func TestInterleave_OrderCreateSameKey_TheTakeRefusesTheTwin(t *testing.T) {
	h := san_race.New(t, orderRaceTables...)
	db := h.DB()
	shop := seedTwoBatches(t, db)
	req := twoUnits(shop)

	fees := &parkedFees{
		real:    NewWarehouseFeePricer(warehouse_v1.NewService(db, nil)),
		entered: make(chan struct{}),
		release: make(chan struct{}),
	}
	parked := orderService(db, fees)

	first := make(chan error, 1)

	go func() {
		_, err := parked.OrderCreate(context.Background(), connect.NewRequest(req))
		first <- err
	}()

	select {
	case <-fees.entered:
	case <-time.After(10 * time.Second):
		t.Fatal("submit 1 never reached the fee call")
	}

	second := make(chan error, 1)

	go func() {
		_, err := orderService(db, nil).OrderCreate(context.Background(), connect.NewRequest(req))
		second <- err
	}()

	// Submit 2 must be REFUSED while submit 1 is still uncommitted — not left waiting on it.
	select {
	case err := <-second:
		if !keyUsedRefusal(err) {
			t.Fatalf("submit 2 while submit 1 is parked: %v — want AlreadyExists with KEY_USED", err)
		}
	case <-time.After(10 * time.Second):
		waiters, _ := san_race.Waiters(db)
		t.Fatalf("submit 2 never answered while submit 1 was parked — waiting: %+v", waiters)
	}

	// Submit 1's take survived the twin: the shelf still lacks its 2.
	var left int64

	db.Raw(`SELECT COALESCE(SUM(stock_count), 0) FROM batches WHERE product_id = ?`, ocProduct).Scan(&left)
	if left != 2 {
		t.Fatalf("the shelf holds %d while submit 1 is parked, want 2 — the refused twin must release nothing", left)
	}

	close(fees.release)

	err := <-first
	if err != nil {
		t.Fatalf("submit 1, released: %v", err)
	}

	assertOneTakeUnderKey(t, db, 0, req.GetIdempotencyKey())
}
