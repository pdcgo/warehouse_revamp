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

// The warehouse counting a box in: a restock of one line and of twenty, each line on its rack, against the background
// volume. The restocks are raised before the timer starts.
func TestPerf_RestockRequestAccept(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	perfLedgerBackground(t, db)

	svc := inventory_v1.NewService(db, nil, nil, nil, (&sentEvents{}).send, perfFacts(20))
	rack := newRack(t, svc, otWarehouse, "perf-door")

	counts := map[int]int{}

	for _, size := range []int{1, 20} {
		items := make([]*inventoryv1.RestockRequestItem, 0, size)
		for _, product := range perfProducts(size) {
			items = append(items, &inventoryv1.RestockRequestItem{ProductId: product, Sku: "PERF", Name: "Perf", Count: 10, Total: 100000})
		}

		raised := make([]*inventoryv1.RestockRequest, 0, 6)

		for range 6 {
			created, err := svc.RestockRequestCreate(ctxUser(1), connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
				TeamId: otMelati, WarehouseId: otWarehouse, FinanceAccountId: 7, ShipmentCost: 15000, Items: items,
			}))
			if err != nil {
				t.Fatalf("raise: %v", err)
			}

			raised = append(raised, created.Msg.GetRequest())
		}

		counts[size] = perfRun(t, db, probe, "RestockRequestAccept", size, func(run int) error {
			r := raised[run]

			lines := make([]*inventoryv1.RestockRequestReceivedLine, 0, size)
			for _, item := range r.GetItems() {
				lines = append(lines, &inventoryv1.RestockRequestReceivedLine{
					ItemId: item.GetId(), ReceivedCount: 10, BrokenCount: 1,
					Placements: []*inventoryv1.RestockPlacement{{PlacementId: rack, Quantity: 9}},
				})
			}

			_, err := svc.RestockRequestAccept(ctxUser(1), connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
				TeamId: otWarehouse, RequestId: r.GetId(), Lines: lines,
				WarehouseAdditionalCost: 5000, WarehouseAdditionalCostNote: "courier",
			}))

			return err
		})
	}

	t.Logf("RestockRequestAccept queries: 1 line=%d, 20 lines=%d", counts[1], counts[20])
}
