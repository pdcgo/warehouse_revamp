//go:build raceaudit

// Concurrency audit for OrderTransactionCreate and OrderTransactionRelease (the audit-sql skill) — the take is the
// writer two people hit in the same second as a matter of course.
//
// Build-tagged so it never runs beside the rolling-back tests: san_race COMMITS.
//
//	go test -tags raceaudit -run "TestRace_OrderTransaction" -v ./backend/services/inventory_service/inventory_v1/
package inventory_v1_test

import (
	"context"
	"fmt"
	"sync"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_ledgers"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// Children first, so the harness's DELETEs do not fight the foreign keys.
var ledgerTables = []string{
	"idempotency_order_check",
	"inventory_transaction_items",
	"batch_price_logs",
	"batch_logs",
	"product_placement_logs",
	"product_placements",
	"batches",
	"inventory_transactions",
	"placements",
}

const (
	raceWarehouse uint64 = 5
	raceOwner     uint64 = 2
	raceProductA  uint64 = 801
	raceProductB  uint64 = 802
)

// seedLedgers commits, per product, `perBatch` units in each of two batches and spreads them over two racks, so racing
// takes all start from the same shelves.
func seedLedgers(t *testing.T, db *gorm.DB, perBatch int64, products ...uint64) {
	t.Helper()

	var restockTx uint64

	err := db.Raw(`INSERT INTO inventory_transactions (warehouse_id, team_id, tx_type) VALUES (?, ?, 'restock') RETURNING id`,
		raceWarehouse, raceOwner).Scan(&restockTx).Error
	if err != nil {
		t.Fatalf("seed transaction: %v", err)
	}

	racks := make([]uint64, 0, 2)
	for _, code := range []string{"rak-a", "rak-b"} {
		var id uint64

		err = db.Raw(`INSERT INTO placements (warehouse_id, code, name) VALUES (?, ?, ?) RETURNING id`, raceWarehouse, code, code).Scan(&id).Error
		if err != nil {
			t.Fatalf("seed rack: %v", err)
		}

		racks = append(racks, id)
	}

	for _, product := range products {
		for range 2 {
			err = db.Exec(`
				INSERT INTO batches (warehouse_id, team_id, product_id, transaction_id, price_unit, stock_count, stock_valuation,
				                     init_stock_count, init_stock_valuation)
				VALUES (?, ?, ?, ?, 1000, ?, ?, ?, ?)`,
				raceWarehouse, raceOwner, product, restockTx, perBatch, float64(perBatch)*1000, perBatch, float64(perBatch)*1000).Error
			if err != nil {
				t.Fatalf("seed batch: %v", err)
			}
		}

		for _, rack := range racks {
			err = db.Exec(`
				INSERT INTO product_placements (team_id, warehouse_id, product_id, placement_id, stock_count)
				VALUES (?, ?, ?, ?, ?)`, raceOwner, raceWarehouse, product, rack, perBatch).Error
			if err != nil {
				t.Fatalf("seed rack row: %v", err)
			}
		}
	}
}

func raceService(db *gorm.DB) *inventory_v1.Service {
	return inventory_v1.NewService(db, nil, nil, nil, nil, fakeFacts{
		raceProductA: {TeamID: raceOwner},
		raceProductB: {TeamID: raceOwner},
	})
}

func raceTake(svc *inventory_v1.Service, key string, lines ...*inventoryv1.OrderTransactionLine) error {
	_, err := svc.OrderTransactionCreate(context.Background(), connect.NewRequest(&inventoryv1.OrderTransactionCreateRequest{
		TeamId: raceOwner, IdempotencyKey: key, WarehouseId: raceWarehouse, Lines: lines,
	}))

	return err
}

func stockOf(t *testing.T, db *gorm.DB, product uint64) (batches, racks int64) {
	t.Helper()

	db.Raw(`SELECT COALESCE(SUM(stock_count), 0) FROM batches WHERE product_id = ?`, product).Scan(&batches)
	db.Raw(`SELECT COALESCE(SUM(stock_count), 0) FROM product_placements WHERE product_id = ?`, product).Scan(&racks)

	return batches, racks
}

// codes collects each caller's Connect code, so a refusal is told apart from a crash.
type codes struct {
	mu  sync.Mutex
	got map[connect.Code]int
}

func (c *codes) add(err error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if c.got == nil {
		c.got = map[connect.Code]int{}
	}

	if err == nil {
		c.got[0]++
		return
	}

	c.got[connect.CodeOf(err)]++
}

// ⚠ NEVER SELL WHAT IS NOT THERE. 20 units, 16 callers each wanting 2: exactly 10 takes win, 6 are refused as not
// enough stock, nobody deadlocks, and both ledgers end at exactly 0 — a lost update would leave stock behind or sell it
// twice.
func TestRace_OrderTransactionCreate_NeverSellsMoreThanTheShelfHolds(t *testing.T) {
	h := san_race.New(t, ledgerTables...)
	seedLedgers(t, h.DB(), 10, raceProductA)
	svc := raceService(h.DB())

	var c codes

	res := h.Race(t, 16, func(i int) error {
		err := raceTake(svc, fmt.Sprintf("K-%d", i), &inventoryv1.OrderTransactionLine{ProductId: raceProductA, Quantity: 2})
		c.add(err)

		if connect.CodeOf(err) == connect.CodeFailedPrecondition {
			return nil // a refusal for stock is the right answer, not a failure
		}

		return err
	})
	res.Report(t)

	if n := res.Count(san_race.Deadlock); n != 0 {
		t.Fatalf("%d callers deadlocked", n)
	}

	if c.got[0] != 10 || c.got[connect.CodeFailedPrecondition] != 6 {
		t.Fatalf("outcomes = %v, want 10 takes and 6 refused for stock", c.got)
	}

	if b, r := stockOf(t, h.DB(), raceProductA); b != 0 || r != 0 {
		t.Fatalf("after the race the batches hold %d and the racks %d, want 0 and 0", b, r)
	}

	var txIDs []uint64
	h.DB().Raw(`SELECT id FROM inventory_transactions WHERE tx_type = 'order'`).Scan(&txIDs)

	for _, id := range txIDs {
		err := inventory_ledgers.Verify(h.DB(), id)
		if err != nil {
			t.Fatalf("Verify %d: %v", id, err)
		}
	}
}

// ⚠ THE DEADLOCK GUARD. Callers send two lines in OPPOSITE order; the take works in product order, batches before
// racks, so they converge on one lock order and wait instead of deadlocking.
func TestRace_OrderTransactionCreate_OppositeLineOrdersDoNotDeadlock(t *testing.T) {
	h := san_race.New(t, ledgerTables...)
	seedLedgers(t, h.DB(), 10, raceProductA, raceProductB)
	svc := raceService(h.DB())

	res := h.Race(t, 8, func(i int) error {
		lines := []*inventoryv1.OrderTransactionLine{
			{ProductId: raceProductA, Quantity: 1},
			{ProductId: raceProductB, Quantity: 1},
		}
		if i%2 == 1 {
			lines[0], lines[1] = lines[1], lines[0]
		}

		return raceTake(svc, fmt.Sprintf("K-%d", i), lines...)
	})
	res.Report(t)

	if n := res.Count(san_race.Deadlock); n != 0 {
		t.Fatalf("%d callers deadlocked — the product order is not holding", n)
	}

	if n := res.Failed(); n != 0 {
		t.Fatalf("%d of 8 takes failed with stock to spare", n)
	}

	for _, p := range []uint64{raceProductA, raceProductB} {
		if b, r := stockOf(t, h.DB(), p); b != 12 || r != 12 {
			t.Fatalf("product %d: batches %d, racks %d, want 12 and 12", p, b, r)
		}
	}
}

// A TWIN SUBMIT TAKES ONCE. Eight callers with the same K in the same second: one take, seven refused as a used key —
// the lookup alone cannot stop them, the unique claim does (the-key-is-claimed-in-its-own-table).
func TestRace_OrderTransactionCreate_ATwinSubmitTakesOnce(t *testing.T) {
	h := san_race.New(t, ledgerTables...)
	seedLedgers(t, h.DB(), 10, raceProductA)
	svc := raceService(h.DB())

	var c codes

	res := h.Race(t, 8, func(int) error {
		err := raceTake(svc, "K-twin", &inventoryv1.OrderTransactionLine{ProductId: raceProductA, Quantity: 1})
		c.add(err)

		if connect.CodeOf(err) == connect.CodeAlreadyExists {
			return nil
		}

		return err
	})
	res.Report(t)

	if c.got[0] != 1 || c.got[connect.CodeAlreadyExists] != 7 {
		t.Fatalf("outcomes = %v, want 1 take and 7 refused as a used key", c.got)
	}

	if b, _ := stockOf(t, h.DB(), raceProductA); b != 19 {
		t.Fatalf("batches hold %d, want 19 — the twin took more than once", b)
	}
}

// A RELEASE RACING ITS OWN TAKE leaves one outcome either way: the take lands and is rolled back, or the release claims
// K first and the take is refused. The shelves end where they started.
func TestRace_OrderTransactionRelease_RacingItsTakeNetsToZero(t *testing.T) {
	h := san_race.New(t, ledgerTables...)
	seedLedgers(t, h.DB(), 10, raceProductA)
	svc := raceService(h.DB())

	for round := range 10 {
		key := fmt.Sprintf("K-round-%d", round)

		res := h.Race(t, 2, func(i int) error {
			if i == 0 {
				err := raceTake(svc, key, &inventoryv1.OrderTransactionLine{ProductId: raceProductA, Quantity: 3})
				if connect.CodeOf(err) == connect.CodeAlreadyExists {
					return nil
				}

				return err
			}

			_, err := svc.OrderTransactionRelease(context.Background(), connect.NewRequest(&inventoryv1.OrderTransactionReleaseRequest{
				TeamId: raceOwner, IdempotencyKey: key,
			}))

			return err
		})
		res.Report(t)

		if n := res.Failed(); n != 0 {
			t.Fatalf("round %d: %d callers failed", round, n)
		}

		// Whichever won, a take that landed after the release saw no claim and must still be released.
		_, err := svc.OrderTransactionRelease(context.Background(), connect.NewRequest(&inventoryv1.OrderTransactionReleaseRequest{
			TeamId: raceOwner, IdempotencyKey: key,
		}))
		if err != nil {
			t.Fatalf("round %d: settling release: %v", round, err)
		}

		if b, r := stockOf(t, h.DB(), raceProductA); b != 20 || r != 20 {
			t.Fatalf("round %d: batches %d, racks %d, want 20 and 20", round, b, r)
		}
	}
}
