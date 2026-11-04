//go:build perfaudit

package inventory_v1_test

import (
	"context"
	"fmt"
	"testing"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// The InventoryTxCancel listener (backlog #10 slice 3) against the background volume, in its three shapes: the backup
// that finds the take still taken (1 line and 20), the usual backup that finds it already released by the order's direct
// call, and a key nothing was taken under (claimed with none).
//
//	go test -tags perfaudit -p 1 -run TestPerf_InventoryTxCancel -v ./backend/services/inventory_service/inventory_v1/
func TestPerf_InventoryTxCancel(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	perfLedgerBackground(t, db)

	svc := inventory_v1.NewService(db, nil, nil, nil, (&sentEvents{}).send, perfFacts(20), nil)
	racks := []uint64{newRack(t, svc, otWarehouse, "perf-a"), newRack(t, svc, otWarehouse, "perf-b"), newRack(t, svc, otWarehouse, "perf-c")}
	perfStock(t, db, otWarehouse, 20, 10, 100, racks)

	cancel := func(key string) error {
		return svc.InventoryTxCancel(context.Background(), &eventsv1.InventoryTxCancel{
			IdempotencyKey: key, TeamId: otMelati, WarehouseId: otWarehouse, ActorId: 8,
		})
	}

	counts := map[string]int{}

	for _, size := range []int{1, 20} {
		lines := make([]*inventoryv1.OrderTransactionLine, 0, size)
		for _, product := range perfProducts(size) {
			lines = append(lines, line(product, 3))
		}

		// The takes to cancel — one per run, the warm-up included.
		for run := 0; run <= 5; run++ {
			_, err := take(svc, fmt.Sprintf("perf-cancel:%d:%d", size, run), lines...)
			if err != nil {
				t.Fatalf("take: %v", err)
			}
		}

		counts[fmt.Sprintf("taken, %d lines", size)] = perfRun(t, db, probe, "InventoryTxCancel — taken", size, func(run int) error {
			return cancel(fmt.Sprintf("perf-cancel:%d:%d", size, run))
		})
	}

	// The usual case: the order's direct release ran first, so the event finds the take released.
	counts["already released"] = perfRun(t, db, probe, "InventoryTxCancel — already released", 20, func(run int) error {
		return cancel(fmt.Sprintf("perf-cancel:20:%d", run))
	})

	counts["unseen key"] = perfRun(t, db, probe, "InventoryTxCancel — unseen key", 0, func(run int) error {
		return cancel(fmt.Sprintf("perf-cancel-unseen:%d", run))
	})

	t.Logf("InventoryTxCancel queries: %v", counts)
}
