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

// Staff reorganizing a shelf: one product carried to another rack, and twenty, against the background volume.
func TestPerf_RackMove(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	perfLedgerBackground(t, db)

	svc := inventory_v1.NewService(db, nil, nil, nil, (&sentEvents{}).send, perfFacts(20))
	from := newRack(t, svc, otWarehouse, "perf-from")
	to := newRack(t, svc, otWarehouse, "perf-to")
	perfStock(t, db, otWarehouse, 20, 3, 100, []uint64{from})

	counts := map[int]int{}

	for _, size := range []int{1, 20} {
		lines := make([]*inventoryv1.RackMoveLine, 0, size)
		for _, product := range perfProducts(size) {
			lines = append(lines, moveLine(product, 1, to))
		}

		counts[size] = perfRun(t, db, probe, "RackMove", size, func(int) error {
			_, err := svc.RackMove(ctxUser(8), connect.NewRequest(&inventoryv1.RackMoveRequest{
				TeamId: otWarehouse, FromRackId: from, Lines: lines, Description: "perf",
			}))

			return err
		})
	}

	t.Logf("RackMove queries: 1 line=%d, 20 lines=%d", counts[1], counts[20])
}
