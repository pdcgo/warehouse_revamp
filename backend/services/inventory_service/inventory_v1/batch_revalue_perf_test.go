//go:build perfaudit

package inventory_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// Koreksi Harga against the background volume (50 000 batches and their logs): one batch of 1 000 units corrected five
// times, each from the price the last one left. The write is one batch's lock, one transaction, one log row, one price
// log, one update and one item — a fixed count, whatever the batch's history.
func TestPerf_BatchRevalue(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	perfLedgerBackground(t, db)

	svc := inventory_v1.NewService(db, nil, nil, nil, (&sentEvents{}).send, perfFacts(1), nil, nil)
	rack := newRack(t, svc, otWarehouse, "perf-shelf")
	perfStock(t, db, otWarehouse, 1, 1, 1000, []uint64{rack})

	var batch models.Batch

	err := db.Where("product_id = ? AND warehouse_id = ?", perfProducts(1)[0], otWarehouse).First(&batch).Error
	if err != nil {
		t.Fatalf("the batch: %v", err)
	}

	price := batch.PriceUnit

	count := perfRun(t, db, probe, "BatchRevalue", 1, func(run int) error {
		to := price + float64(run+1)*10

		_, callErr := svc.BatchRevalue(ctxUser(8), connect.NewRequest(&inventoryv1.BatchRevalueRequest{
			TeamId: otMelati, BatchId: batch.ID, ExpectedPriceUnit: price, NewPriceUnit: to, Reason: "perf",
		}))
		if callErr == nil {
			price = to
		}

		return callErr
	})

	t.Logf("BatchRevalue queries: %d", count)
}
