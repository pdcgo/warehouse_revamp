//go:build perfaudit

package inventory_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// A sample handed over at the warehouse: one product off a rack, and twenty, each holding 10 batches, against the
// background volume.
func TestPerf_RackSample(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	perfLedgerBackground(t, db)

	svc := inventory_v1.NewService(db, nil, nil, nil, (&sentEvents{}).send, perfFacts(20))
	rack := newRack(t, svc, otWarehouse, "perf-shelf")
	perfStock(t, db, otWarehouse, 20, 10, 100, []uint64{rack})

	counts := map[int]int{}

	for _, size := range []int{1, 20} {
		lines := make([]*inventoryv1.RackSampleLine, 0, size)
		for _, product := range perfProducts(size) {
			lines = append(lines, &inventoryv1.RackSampleLine{ProductId: product, Quantity: 1})
		}

		counts[size] = perfRun(t, db, probe, "RackSample", size, func(int) error {
			_, err := svc.RackSample(ctxUser(8), connect.NewRequest(&inventoryv1.RackSampleRequest{
				TeamId: otWarehouse, RackId: rack, Recipient: "Budi", Description: "perf", Lines: lines,
			}))

			return err
		})
	}

	t.Logf("RackSample queries: 1 line=%d, 20 lines=%d", counts[1], counts[20])
}
