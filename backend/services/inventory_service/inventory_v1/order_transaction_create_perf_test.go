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

// The order take is on the order form's submit, the busiest write in the system. One line and twenty, each product
// holding 10 batches over 3 racks in Gudang 5, against the background volume.
func TestPerf_OrderTransactionCreate(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	perfLedgerBackground(t, db)

	svc := inventory_v1.NewService(db, nil, nil, nil, (&sentEvents{}).send, perfFacts(20))
	racks := []uint64{newRack(t, svc, otWarehouse, "perf-a"), newRack(t, svc, otWarehouse, "perf-b"), newRack(t, svc, otWarehouse, "perf-c")}
	perfStock(t, db, otWarehouse, 20, 10, 100, racks)

	counts := map[int]int{}

	for _, size := range []int{1, 20} {
		lines := make([]*inventoryv1.OrderTransactionLine, 0, size)
		for _, product := range perfProducts(size) {
			lines = append(lines, line(product, 1))
		}

		counts[size] = perfRun(t, db, probe, "OrderTransactionCreate", size, func(run int) error {
			_, err := svc.OrderTransactionCreate(ctxUser(8), connect.NewRequest(&inventoryv1.OrderTransactionCreateRequest{
				TeamId: otMelati, IdempotencyKey: fmt.Sprintf("perf:%d:%d", size, run), WarehouseId: otWarehouse, Lines: lines,
			}))

			return err
		})
	}

	t.Logf("OrderTransactionCreate queries: 1 line=%d, 20 lines=%d", counts[1], counts[20])
}
