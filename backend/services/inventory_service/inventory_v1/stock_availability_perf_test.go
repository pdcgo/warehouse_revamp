//go:build perfaudit

package inventory_v1_test

import (
	"context"
	"strconv"
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
// 50 000 stock_levels rows: a movement-grain table (a row per warehouse × product × place), spread
// over 20 warehouses so the warehouse filter is genuinely selective rather than matching everything.
func perfStockLevelRows(n int) []inventory_service_models.StockLevel {
	rows := make([]inventory_service_models.StockLevel, 0, n)

	for i := range n {
		warehouse := uint64(1 + i%20)
		product := uint64(1 + i/20)

		var rack *uint64
		// Two thirds shelved, one third unplaced — a pick drains both, so both must be in the plan.
		if i%3 != 0 {
			id := uint64(1 + i%500)
			rack = &id
		}

		rows = append(rows, inventory_service_models.StockLevel{
			WarehouseID: warehouse,
			ProductID:   product,
			RackID:      rack,
			OnHand:      int64(1 + i%40),
			UpdatedAt:   time.Now(),
		})
	}

	return rows
}

// The shelves the levels above sit on. `stock_levels.rack_id` is a real foreign key, so the racks have
// to exist before the levels can — seeding levels alone fails on the constraint rather than measuring
// anything.
func perfRackRows(n int) []inventory_service_models.Rack {
	rows := make([]inventory_service_models.Rack, 0, n)

	for i := range n {
		rows = append(rows, inventory_service_models.Rack{
			ID:          uint64(1 + i),
			WarehouseID: uint64(1 + i%20),
			Code:        "R-" + strconv.Itoa(i),
			CreatedAt:   time.Now(),
			UpdatedAt:   time.Now(),
		})
	}

	return rows
}

func TestPerf_StockAvailability(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	san_perf.SeedRows(t, db, perfRackRows(500))
	san_perf.SeedRows(t, db, perfStockLevelRows(50_000))

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
		_, err := svc.StockAvailability(ctx, connect.NewRequest(req))
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

var _ = context.Background
