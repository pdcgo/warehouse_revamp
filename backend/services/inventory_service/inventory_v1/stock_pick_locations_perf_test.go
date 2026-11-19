//go:build perfaudit

package inventory_v1_test

import (
	"fmt"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// The pick page's shelf column: one take's placement log rows, read by its transaction id within the caller's
// warehouse (the-placement-page-reads-racks-by-transaction-id). A take of one line and of twenty, each spread over
// three racks, against the ledger background (50 000 placement log rows over 20 warehouses). The query count must not
// move with the number of lines.
func TestPerf_StockPickLocations(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	perfLedgerBackground(t, db)

	svc := inventory_v1.NewService(db, nil, nil, nil, (&sentEvents{}).send, perfFacts(20), nil, nil, nil, nil)
	racks := []uint64{newRack(t, svc, otWarehouse, "perf-a"), newRack(t, svc, otWarehouse, "perf-b"), newRack(t, svc, otWarehouse, "perf-c")}
	perfStock(t, db, otWarehouse, 20, 10, 100, racks)

	counts := map[int]int{}

	for _, size := range []int{1, 20} {
		lines := make([]*inventoryv1.OrderTransactionLine, 0, size)
		for _, product := range perfProducts(size) {
			lines = append(lines, line(product, 250))
		}

		taken, err := take(svc, fmt.Sprintf("perf-pick:%d", size), lines...)
		if err != nil {
			t.Fatalf("take: %v", err)
		}

		counts[size] = perfRun(t, db, probe, "StockPickLocations", size, func(int) error {
			res, callErr := svc.StockPickLocations(ctxUser(8), connect.NewRequest(&inventoryv1.StockPickLocationsRequest{
				WarehouseId: otWarehouse, TransactionId: taken.GetTransactionId(),
			}))
			if callErr != nil {
				return callErr
			}

			if len(res.Msg.GetLocations()) < size {
				return fmt.Errorf("%d stops for %d lines", len(res.Msg.GetLocations()), size)
			}

			return nil
		})
	}

	t.Logf("StockPickLocations queries: 1 line=%d, 20 lines=%d", counts[1], counts[20])
}

// THE BULK PICK LIST'S READ AT VOLUME (the-bulk-pick-list-prototype-is-accepted): 50 takes — the request's cap, the
// warehouse list's largest page — of four lines each over three racks, read in ONE call, against the ledger background
// plus 450 000 more placement log rows (500 000 in all, the busy building's included). One take and fifty must both be
// ONE statement, and the fifty must stay an index read by transaction (product_placement_logs_transaction_idx) — under
// the custom plan and under the generic plan pgx's prepared statement settles on after five runs.
func TestPerf_StockPickLocationsManyTakes(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	perfLedgerBackground(t, db)

	quiet := db.Session(&gorm.Session{Logger: logger.Discard})

	err := quiet.Exec(`
		INSERT INTO product_placement_logs (warehouse_id, team_id, product_id, placement_id, transaction_id, change_type,
		                                    stock_change, stock_after, actor_id)
		SELECT 1 + g % 20, 2, 100000 + g % 2500, p0.first + g % 10000, t0.first + g % 50000, 'restock', 10, 10, 1
		FROM generate_series(1, 450000) g
		CROSS JOIN (SELECT min(id) AS first FROM placements WHERE description = 'perf-bg') p0
		CROSS JOIN (SELECT min(id) AS first FROM inventory_transactions WHERE description = 'perf-bg') t0`).Error
	if err != nil {
		t.Fatalf("volume seed: %v", err)
	}

	err = quiet.Exec("ANALYZE product_placement_logs").Error
	if err != nil {
		t.Fatalf("analyze: %v", err)
	}

	svc := inventory_v1.NewService(db, nil, nil, nil, (&sentEvents{}).send, perfFacts(20), nil, nil, nil, nil)
	racks := []uint64{newRack(t, svc, otWarehouse, "bulk-a"), newRack(t, svc, otWarehouse, "bulk-b"), newRack(t, svc, otWarehouse, "bulk-c")}
	perfStock(t, db, otWarehouse, 20, 10, 100, racks)

	products := perfProducts(20)
	takes := make([]uint64, 0, 50)

	for i := range 50 {
		lines := make([]*inventoryv1.OrderTransactionLine, 0, 4)
		for k := range 4 {
			lines = append(lines, line(products[(i+k*5)%len(products)], 3))
		}

		taken, takeErr := take(svc, fmt.Sprintf("perf-bulk:%d", i), lines...)
		if takeErr != nil {
			t.Fatalf("take %d: %v", i, takeErr)
		}

		takes = append(takes, taken.GetTransactionId())
	}

	err = quiet.Exec("ANALYZE product_placement_logs").Error
	if err != nil {
		t.Fatalf("analyze: %v", err)
	}

	read := func(asked []uint64) func(int) error {
		return func(int) error {
			res, callErr := svc.StockPickLocations(ctxUser(8), connect.NewRequest(&inventoryv1.StockPickLocationsRequest{
				WarehouseId: otWarehouse, TransactionIds: asked,
			}))
			if callErr != nil {
				return callErr
			}

			if len(res.Msg.GetLocations()) < 4*len(asked) {
				return fmt.Errorf("%d stops for %d takes of 4 lines", len(res.Msg.GetLocations()), len(asked))
			}

			return nil
		}
	}

	one := perfRun(t, db, probe, "StockPickLocations many", 1, read(takes[:1]))
	fifty := perfRun(t, db, probe, "StockPickLocations many", 50, read(takes))
	// One take again, after the fifty: the first planning after the seed pays the planner's first look at the new
	// statistics; the steady single-take read is this one.
	again := perfRun(t, db, probe, "StockPickLocations many (one take again)", 1, read(takes[1:2]))

	err = db.Exec("SET LOCAL plan_cache_mode = force_generic_plan").Error
	if err != nil {
		t.Fatalf("generic plan: %v", err)
	}

	generic := perfRun(t, db, probe, "StockPickLocations many (generic plan)", 50, read(takes))

	t.Logf("StockPickLocations queries: 1 take=%d, 50 takes=%d, 1 take again=%d, 50 takes generic=%d", one, fifty, again, generic)

	if one != 1 || fifty != 1 || again != 1 || generic != 1 {
		t.Fatalf("queries = %d / %d / %d / %d, want ONE statement whatever the number of takes", one, fifty, again, generic)
	}
}
