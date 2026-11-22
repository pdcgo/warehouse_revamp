//go:build perfaudit

package inventory_v1_test

import (
	"fmt"
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

// THE OWNER'S HISTORY WITH EACH SAMPLE'S RECIPIENT (backlog #111, a-sample-keeps-its-recipient): OwnerStockHistory reads
// who received a sample row from its own inventory transaction — #108's recipientExpr, on the PAGE only, as the override
// flag is read. One batch of the owner's with 5 000 rows on its ledger, each under its own transaction — every fifth a
// sample to its own recipient, the rest order takes — against the ledgers' background (50 000 batches over 2 500
// products in 20 warehouses). Page 1 and page 100 (offset 4 950, the deep page: a per-row lookup in the inner select would
// run for every row the OFFSET skips), under the custom plan and `plan_cache_mode = force_generic_plan`.
func TestPerf_OwnerStockHistory_ASamplesRecipient(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	quiet := db.Session(&gorm.Session{Logger: logger.Discard})
	perfLedgerBackground(t, db)
	// The background's accepted restocks carry no transaction (0); a real accepted restock carries its own — left at 0,
	// every row's `ref` (refExpr) seq-scans them.
	err := quiet.Exec(`UPDATE restocks SET transaction_id = id + 10000000 WHERE note = 'perf-bg'`).Error
	if err != nil {
		t.Fatalf("restock transactions: %v", err)
	}

	svc := inventory_v1.NewService(db, nil, nil, nil, (&sentEvents{}).send, perfFacts(1), nil, nil, nil, nil)
	rack := newRack(t, svc, otWarehouse, "perf-oh")
	perfStock(t, db, otWarehouse, 1, 1, 5000, []uint64{rack})

	product := perfProducts(1)[0]

	var batch models.Batch

	err = db.
		Where("product_id = ? AND warehouse_id = ?", product, otWarehouse).
		First(&batch).
		Error
	if err != nil {
		t.Fatalf("the batch: %v", err)
	}

	statements := []string{
		`INSERT INTO inventory_transactions (warehouse_id, team_id, tx_type, create_by_user_id, description, recipient)
		 SELECT ?, ?, CASE WHEN g % 5 = 0 THEN 'sample' ELSE 'order' END, 1, 'perf-oh-' || g,
		        CASE WHEN g % 5 = 0 THEN 'perf-recipient-' || g ELSE '' END
		 FROM generate_series(1, 5000) g`,
		`INSERT INTO batch_logs (warehouse_id, team_id, batch_id, transaction_id, change_type, change_count, change_valuation,
		                         stock_count_after, stock_valuation_after, price_unit_after, actor_id)
		 SELECT ?, ?, ?, t.id, t.tx_type, -1, -?::double precision,
		        ? - row_number() OVER (ORDER BY t.id), (? - row_number() OVER (ORDER BY t.id)) * ?::double precision, ?, 1
		 FROM inventory_transactions t WHERE t.description LIKE 'perf-oh-%'`,
	}

	args := [][]any{
		{batch.WarehouseID, batch.TeamID},
		{batch.WarehouseID, batch.TeamID, batch.ID, batch.PriceUnit, batch.StockCount, batch.StockCount, batch.PriceUnit, batch.PriceUnit},
	}

	for i, stmt := range statements {
		err = quiet.Exec(stmt, args[i]...).Error
		if err != nil {
			t.Fatalf("the owner's ledger, statement %d: %v", i, err)
		}
	}

	for _, table := range []string{"batches", "batch_logs", "inventory_transactions", "idempotency_order_check", "restocks"} {
		err = quiet.Exec("ANALYZE " + table).Error
		if err != nil {
			t.Fatalf("analyze %s: %v", table, err)
		}
	}

	for _, plan := range []string{"auto", "force_generic_plan"} {
		err = quiet.Exec("SET LOCAL plan_cache_mode = " + plan).Error
		if err != nil {
			t.Fatalf("plan mode %s: %v", plan, err)
		}

		for _, p := range []uint32{1, 100} {
			perfRun(t, db, probe, fmt.Sprintf("OwnerStockHistory page %d [%s]", p, plan), 1, func(int) error {
				_, callErr := svc.OwnerStockHistory(ctxUser(8), connect.NewRequest(&inventoryv1.OwnerStockHistoryRequest{
					TeamId: batch.TeamID,
					Filter: &inventoryv1.OwnerStockHistoryFilter{ProductId: product},
					Page:   &commonv1.CommonPagination{Page: p, Limit: 50},
				}))

				return callErr
			})
		}
	}
}
