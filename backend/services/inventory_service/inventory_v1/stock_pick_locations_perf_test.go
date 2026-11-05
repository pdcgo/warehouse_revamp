//go:build perfaudit

package inventory_v1_test

import (
	"fmt"
	"testing"

	"connectrpc.com/connect"

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

	svc := inventory_v1.NewService(db, nil, nil, nil, (&sentEvents{}).send, perfFacts(20), nil, nil)
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
