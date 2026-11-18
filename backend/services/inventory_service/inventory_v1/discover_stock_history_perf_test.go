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
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// ANOTHER TEAM'S STOCK HISTORY AT VOLUME — DiscoverStockHistory (stock-history-is-everyones) beside the owner's own
// OwnerStockHistory, on ONE seed in one process: the ledger background (50 000 batches over 2 500 products in 20
// warehouses) plus one product with a long, corrected batch — 5 000 units, 3 000 one-unit order takes and 20 price
// corrections on its ledger (BatchDetail's perf seed). The discover read is the owner's statement less its price,
// reference and override columns and less the corrections, so it must not be slower: page 1, a deep page, and the lens,
// each under the custom plan and under `plan_cache_mode = force_generic_plan` (pgx prepares every statement).
func TestPerf_DiscoverStockHistory(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	quiet := db.Session(&gorm.Session{Logger: logger.Discard})
	perfLedgerBackground(t, db)

	err := quiet.Exec(`UPDATE restocks SET transaction_id = id + 10000000 WHERE note = 'perf-bg'`).Error
	if err != nil {
		t.Fatalf("restock transactions: %v", err)
	}

	svc := inventory_v1.NewService(db, nil, nil, nil, (&sentEvents{}).send, perfFacts(1), nil, nil, nil, nil)
	rack := newRack(t, svc, otWarehouse, "perf-shelf")
	perfStock(t, db, otWarehouse, 1, 1, 5000, []uint64{rack})

	product := perfProducts(1)[0]

	var batch models.Batch

	err = db.Where("product_id = ? AND warehouse_id = ?", product, otWarehouse).First(&batch).Error
	if err != nil {
		t.Fatalf("the batch: %v", err)
	}

	perfLongBatch(t, db, batch)

	price := batch.PriceUnit

	for i := range 20 {
		to := price + float64(i+1)

		_, err = svc.BatchRevalue(ctxUser(8), connect.NewRequest(&inventoryv1.BatchRevalueRequest{
			TeamId: otMelati, BatchId: batch.ID, ExpectedPriceUnit: price, NewPriceUnit: to, Reason: "perf",
		}))
		if err != nil {
			t.Fatalf("correction %d: %v", i, err)
		}

		price = to
	}

	for _, table := range []string{"batches", "batch_logs", "inventory_transactions", "idempotency_order_check", "restocks"} {
		err = quiet.Exec("ANALYZE " + table).Error
		if err != nil {
			t.Fatalf("analyze %s: %v", table, err)
		}
	}

	reader := ctxAs(41, otSinar, role_basev1.Role_ROLE_SELLING_OWNER)

	for _, plan := range []string{"auto", "force_generic_plan"} {
		err = quiet.Exec("SET LOCAL plan_cache_mode = " + plan).Error
		if err != nil {
			t.Fatalf("plan mode %s: %v", plan, err)
		}

		for _, c := range []struct {
			name      string
			page      uint32
			warehouse uint64
		}{
			{"page 1", 1, 0},
			{"page 100", 100, 0},
			{"page 1, the lens", 1, otWarehouse},
		} {
			pagination := &commonv1.CommonPagination{Page: c.page, Limit: 20}

			perfRun(t, db, probe, fmt.Sprintf("OwnerStockHistory %s [%s]", c.name, plan), 1, func(int) error {
				_, callErr := svc.OwnerStockHistory(ctxUser(8), connect.NewRequest(&inventoryv1.OwnerStockHistoryRequest{
					TeamId: otMelati,
					Filter: &inventoryv1.OwnerStockHistoryFilter{ProductId: product, WarehouseId: c.warehouse},
					Page:   pagination,
				}))

				return callErr
			})

			perfRun(t, db, probe, fmt.Sprintf("DiscoverStockHistory %s [%s]", c.name, plan), 1, func(int) error {
				_, callErr := svc.DiscoverStockHistory(reader, connect.NewRequest(&inventoryv1.DiscoverStockHistoryRequest{
					TeamId: otSinar,
					Filter: &inventoryv1.DiscoverStockHistoryFilter{ProductId: product, WarehouseId: c.warehouse},
					Page:   pagination,
				}))

				return callErr
			})
		}
	}
}
