//go:build perfaudit

package selling_v1_test

import (
	"strconv"
	"testing"
	"time"

	"connectrpc.com/connect"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// 50 000 orders — a transaction-grain table, and the one this stat scans in full: the census counts
// every order the team has ever placed, so this is the read whose cost grows forever if it grows at
// all. Spread across six statuses and 30 days so both halves of the response have work to do.
func perfOrderRows(n int, shopIDs []uint64) []selling_service_models.Order {
	statuses := []string{"placed", "confirmed", "picking", "packed", "shipped", "cancelled"}

	rows := make([]selling_service_models.Order, 0, n)

	for i := range n {
		rows = append(rows, selling_service_models.Order{
			ID:           uint64(1 + i),
			TeamID:       uint64(2 + i%5),
			ShopID:       shopIDs[i%len(shopIDs)],
			WarehouseID:  uint64(900 + i%3),
			Status:       statuses[i%len(statuses)],
			CustomerName: "Budi",
			Subtotal:     int64(10_000 + i),
			Total:        int64(15_000 + i),
			// Half inside the 30-day window, half outside it, so the FILTER aggregates are not
			// measured against a set that trivially matches everything.
			CreatedAt: time.Now().Add(-time.Duration(i%60) * 24 * time.Hour),
			UpdatedAt: time.Now(),
		})
	}

	return rows
}

func TestPerf_OrderStat(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))

	// `orders.shop_id` is a real foreign key, so the shops have to exist before the orders can.
	shopIDs := make([]uint64, 0, 10)
	for i := range 10 {
		shopIDs = append(shopIDs, insertShop(t, db, 2, "Toko "+strconv.Itoa(i), "TOKO-"+strconv.Itoa(i), "shopee"))
	}

	san_perf.SeedRows(t, db, perfOrderRows(50_000, shopIDs))

	svc := newService(t, db)
	ctx := t.Context()

	req := &sellingv1.OrderStatRequest{TeamId: 2}

	// Warm-up: schema reflection and pool setup are not this RPC's cost.
	_, err := svc.OrderStat(ctx, connect.NewRequest(req))
	if err != nil {
		t.Fatalf("OrderStat warm-up: %v", err)
	}

	walls := make([]time.Duration, 0, 5)

	for range 5 {
		probe.Reset()

		wall, dbTime := probe.Measure(func() {
			_, err = svc.OrderStat(ctx, connect.NewRequest(req))
		})
		if err != nil {
			t.Fatalf("OrderStat: %v", err)
		}

		walls = append(walls, wall)
		t.Logf("wall=%v db=%v go=%v queries=%d", wall, dbTime, wall-dbTime, probe.Count())
	}

	t.Logf("MEDIAN wall %v", san_perf.Median(walls))
	t.Log(san_perf.Explain(t, db, probe.Queries()[0].SQL))
	probe.Report(t, "OrderStat")
}
