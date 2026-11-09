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

// An order's return (return_decision.md): a take of one line and of twenty, each line drawn across several batches, put
// back at the return warehouse — one unit of every line broken, so the door rows are written too — against the
// background volume. Each take is made before the timer starts; each run returns a fresh one.
//
//	go test -tags perfaudit -run TestPerf_OrderTransactionReturn -v ./backend/services/inventory_service/inventory_v1/
func TestPerf_OrderTransactionReturn(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	perfLedgerBackground(t, db)

	svc := inventory_v1.NewService(db, nil, nil, nil, (&sentEvents{}).send, perfFacts(20), nil, nil)
	racks := []uint64{newRack(t, svc, otWarehouse, "perf-a"), newRack(t, svc, otWarehouse, "perf-b"), newRack(t, svc, otWarehouse, "perf-c")}
	returnRack := newRack(t, svc, rtReturnWarehouse, "perf-return")

	// 30 batches of 2 units per product, so each take of 4 draws from two batches and twelve takes fit.
	perfStock(t, db, otWarehouse, 20, 30, 2, racks)

	counts := map[int]int{}

	for _, size := range []int{1, 20} {
		lines := make([]*inventoryv1.OrderTransactionLine, 0, size)
		for _, product := range perfProducts(size) {
			lines = append(lines, line(product, 4))
		}

		takes := make([]uint64, 0, 6)

		for run := 0; run <= 5; run++ {
			took, err := take(svc, fmt.Sprintf("perf-ret:%d:%d", size, run), lines...)
			if err != nil {
				t.Fatalf("take: %v", err)
			}

			takes = append(takes, took.GetTransactionId())
		}

		counts[size] = perfRun(t, db, probe, "OrderTransactionReturn", size, func(run int) error {
			returned := make([]*inventoryv1.OrderTransactionReturnLine, 0, size)
			for _, product := range perfProducts(size) {
				returned = append(returned, &inventoryv1.OrderTransactionReturnLine{
					ProductId: product, ReturnProductId: product, Sound: 3, Broken: 1, Note: "pecah",
					Placements: []*inventoryv1.OrderTransactionReturnPlacement{{PlacementId: returnRack, Quantity: 3}},
				})
			}

			_, err := svc.OrderTransactionReturn(ctxUser(rtCrew), connect.NewRequest(&inventoryv1.OrderTransactionReturnRequest{
				TeamId: rtReturnWarehouse, SellingTeamId: otMelati, TakeTransactionId: takes[run], Lines: returned,
			}))

			return err
		})
	}

	t.Logf("OrderTransactionReturn queries: 1 line=%d, 20 lines=%d", counts[1], counts[20])
}
