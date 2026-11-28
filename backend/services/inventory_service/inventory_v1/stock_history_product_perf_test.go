//go:build perfaudit

package inventory_v1_test

import (
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// A WAREHOUSE PRODUCT'S STOCK HISTORY WITH EACH ROW'S BATCH (backlog #142/#143): the unfiltered read — the warehouse
// product page's Stock History, its Placement History (kind MOVE) and its last stock-take (kind ADJUST, one row). The
// seed is TestPerf_StockHistory_ABatchsRacks's — one batch of 5 000 units with 3 000 takes on its ledger (2 000 of two
// units off two racks, 1 000 of one unit off one rack: 5 000 rack rows of the product) against the ledgers' background
// and 250 000 more rack rows of other products — plus 100 moves between the two racks (rack rows only, the batch named
// from what the warehouse held) and 20 price corrections of the batch (batch rows only). Page 1, and page 100.
func TestPerf_StockHistory_AProductsBatches(t *testing.T) {
	svc, db, probe, product := perfProductHistory(t)

	read := func(kind inventoryv1.MovementKind, p, limit uint32) func(int) error {
		return func(int) error {
			_, callErr := svc.StockHistory(ctxUser(8), connect.NewRequest(&inventoryv1.StockHistoryRequest{
				WarehouseId: otWarehouse,
				Filter:      &inventoryv1.StockHistoryFilter{ProductId: product, Kind: kind},
				Page:        &commonv1.CommonPagination{Page: p, Limit: limit},
			}))

			return callErr
		}
	}

	for _, p := range []uint32{1, 100} {
		perfRun(t, db, probe, "StockHistory (product, batches)", int(p), read(inventoryv1.MovementKind_MOVEMENT_KIND_UNSPECIFIED, p, 50))
	}

	perfRun(t, db, probe, "StockHistory (product, moves)", 1, read(inventoryv1.MovementKind_MOVEMENT_KIND_MOVE, 1, 50))
	perfRun(t, db, probe, "StockHistory (product, last adjust)", 1, read(inventoryv1.MovementKind_MOVEMENT_KIND_ADJUST, 1, 1))
}

// perfProductHistory seeds TestPerf_StockHistory_AProductsBatches's product and returns the service, the probed
// database and the product.
func perfProductHistory(t *testing.T) (*inventory_v1.Service, *gorm.DB, *san_perf.Probe, uint64) {
	t.Helper()

	db, probe := san_perf.Wrap(san_testdb.DB(t))
	quiet := db.Session(&gorm.Session{Logger: logger.Discard})
	perfLedgerBackground(t, db)

	err := quiet.Exec(`UPDATE restocks SET transaction_id = id + 10000000 WHERE note = 'perf-bg'`).Error
	if err != nil {
		t.Fatalf("restock transactions: %v", err)
	}

	svc := inventory_v1.NewService(db, nil, nil, nil, (&sentEvents{}).send, perfFacts(1), nil, nil, nil, nil)
	rakA := newRack(t, svc, otWarehouse, "perf-a")
	rakB := newRack(t, svc, otWarehouse, "perf-b")
	perfStock(t, db, otWarehouse, 1, 1, 5000, []uint64{rakA})

	product := perfProducts(1)[0]

	var batch models.Batch

	err = db.Where("product_id = ? AND warehouse_id = ?", product, otWarehouse).First(&batch).Error
	if err != nil {
		t.Fatalf("the batch: %v", err)
	}

	perfRackedTakes(t, db, batch, rakA, rakB)
	perfMovesAndCorrections(t, db, batch, rakA, rakB)

	for _, table := range []string{"batches", "batch_logs", "product_placement_logs", "inventory_transactions", "idempotency_order_check", "restocks"} {
		err = quiet.Exec("ANALYZE " + table).Error
		if err != nil {
			t.Fatalf("analyze %s: %v", table, err)
		}
	}

	return svc, db, probe, product
}

// perfMovesAndCorrections adds 100 moves of one unit from Rak A to Rak B (each its own transaction, two rack rows, no
// batch row — a-move-writes-two-rack-rows-and-no-batch-row) and 20 price corrections of the batch (each its own
// transaction, one batch row that moved no unit, no rack row).
func perfMovesAndCorrections(t *testing.T, db *gorm.DB, b models.Batch, rakA, rakB uint64) {
	t.Helper()

	quiet := db.Session(&gorm.Session{Logger: logger.Discard})

	statements := []string{
		`INSERT INTO inventory_transactions (warehouse_id, team_id, tx_type, create_by_user_id, description)
		 SELECT ?, ?, 'move', 1, 'perf-move-' || g FROM generate_series(1, 100) g`,
		`INSERT INTO product_placement_logs (warehouse_id, team_id, product_id, placement_id, transaction_id, change_type,
		                                     stock_change, stock_after, actor_id)
		 SELECT t.warehouse_id, t.team_id, ?, r.rack, t.id, 'move', r.change, 0, 1
		 FROM inventory_transactions t
		 CROSS JOIN LATERAL (VALUES (?::bigint, -1), (?::bigint, 1)) AS r(rack, change)
		 WHERE t.description LIKE 'perf-move-%'
		 ORDER BY t.id, r.change`,
		`INSERT INTO inventory_transactions (warehouse_id, team_id, tx_type, create_by_user_id, description)
		 SELECT ?, ?, 'revaluation', 1, 'perf-revalue-' || g FROM generate_series(1, 20) g`,
		`INSERT INTO batch_logs (warehouse_id, team_id, batch_id, transaction_id, change_type, change_count, change_valuation,
		                         stock_count_after, stock_valuation_after, price_unit_after, actor_id)
		 SELECT ?, ?, ?, t.id, 'revaluation', 0, 0, 0, 0, ?, 1
		 FROM inventory_transactions t WHERE t.description LIKE 'perf-revalue-%'`,
	}

	args := [][]any{
		{b.WarehouseID, b.TeamID},
		{b.ProductID, rakA, rakB},
		{b.WarehouseID, b.TeamID},
		{b.WarehouseID, b.TeamID, b.ID, b.PriceUnit},
	}

	for i, stmt := range statements {
		err := quiet.Exec(stmt, args[i]...).Error
		if err != nil {
			t.Fatalf("moves and corrections, statement %d: %v", i, err)
		}
	}
}
