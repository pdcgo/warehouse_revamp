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

// A cancelled order's release: every log row of its take flipped back. A take of one line and of twenty, each taken
// before the timer starts, against the background volume.
func TestPerf_OrderTransactionRelease(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	perfLedgerBackground(t, db)

	svc := inventory_v1.NewService(db, nil, nil, nil, (&sentEvents{}).send, perfFacts(20))
	racks := []uint64{newRack(t, svc, otWarehouse, "perf-a"), newRack(t, svc, otWarehouse, "perf-b"), newRack(t, svc, otWarehouse, "perf-c")}
	perfStock(t, db, otWarehouse, 20, 10, 100, racks)

	counts := map[int]int{}

	for _, size := range []int{1, 20} {
		lines := make([]*inventoryv1.OrderTransactionLine, 0, size)
		for _, product := range perfProducts(size) {
			lines = append(lines, line(product, 3))
		}

		// The takes to release — one per run, the warm-up included.
		for run := 0; run <= 5; run++ {
			_, err := take(svc, fmt.Sprintf("perf-rel:%d:%d", size, run), lines...)
			if err != nil {
				t.Fatalf("take: %v", err)
			}
		}

		counts[size] = perfRun(t, db, probe, "OrderTransactionRelease", size, func(run int) error {
			_, err := release(svc, otMelati, fmt.Sprintf("perf-rel:%d:%d", size, run))

			return err
		})
	}

	t.Logf("OrderTransactionRelease queries: 1 line=%d, 20 lines=%d", counts[1], counts[20])
}

var _ = connect.NewRequest[inventoryv1.OrderTransactionReleaseRequest]
