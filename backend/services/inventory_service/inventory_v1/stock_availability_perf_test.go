//go:build perfaudit

package inventory_v1_test

import (
	"testing"
	"time"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// The order form asks this on every warehouse change and every product picked, so it is on the typing
// path of the busiest screen in the system — worth knowing what it costs.
//
// 50 000 batches spread over 20 warehouses, so the warehouse filter is genuinely selective rather than matching
// everything. Every batch belongs to one seed transaction: `batches.transaction_id` is a real foreign key.
func perfBatchRows(n int, transactionID uint64) []inventory_service_models.Batch {
	rows := make([]inventory_service_models.Batch, 0, n)

	for i := range n {
		count := int64(1 + i%40)

		rows = append(rows, inventory_service_models.Batch{
			WarehouseID:        uint64(1 + i%20),
			TeamID:             2,
			ProductID:          uint64(1 + i/20),
			TransactionID:      transactionID,
			PriceUnit:          1000,
			StockCount:         count,
			StockValuation:     float64(count) * 1000,
			InitStockCount:     count,
			InitStockValuation: float64(count) * 1000,
			CreatedAt:          time.Now(),
			UpdatedAt:          time.Now(),
		})
	}

	return rows
}

func TestPerf_StockAvailability(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))

	seed := inventory_service_models.InventoryTransaction{WarehouseID: 1, TeamID: 2, TxType: inventory_service_models.TxRestock}

	err := db.Create(&seed).Error
	if err != nil {
		t.Fatalf("seed transaction: %v", err)
	}

	san_perf.SeedRows(t, db, perfBatchRows(50_000, seed.ID))

	svc := newService(t, db)
	ctx := ctxUser(1)

	// Two sizes: if the query count moves with the number of products asked about, that is an N+1 and
	// it is heavy however small the absolute number looks.
	for _, size := range []int{5, 200} {
		ids := make([]uint64, 0, size)
		for i := range size {
			ids = append(ids, uint64(1+i))
		}

		req := &inventoryv1.StockAvailabilityRequest{
			TeamId: 2, WarehouseId: 1, ProductIds: ids,
		}

		// Warm-up: schema reflection and pool setup are not this RPC's cost.
		_, err = svc.StockAvailability(ctx, connect.NewRequest(req))
		if err != nil {
			t.Fatalf("StockAvailability warm-up: %v", err)
		}

		walls := make([]time.Duration, 0, 5)

		for range 5 {
			probe.Reset()

			wall, dbTime := probe.Measure(func() {
				_, err = svc.StockAvailability(ctx, connect.NewRequest(req))
			})
			if err != nil {
				t.Fatalf("StockAvailability: %v", err)
			}

			walls = append(walls, wall)
			t.Logf("ids=%d wall=%v db=%v go=%v queries=%d", size, wall, dbTime, wall-dbTime, probe.Count())
		}

		t.Logf("ids=%d MEDIAN wall %v", size, san_perf.Median(walls))

		if size == 200 {
			t.Log(san_perf.Explain(t, db, probe.Queries()[0].SQL))
			probe.Report(t, "StockAvailability")
		}
	}
}
