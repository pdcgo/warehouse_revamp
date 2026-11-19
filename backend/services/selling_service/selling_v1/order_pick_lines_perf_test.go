//go:build perfaudit

// Performance audit for OrderPickLines (the audit-rpc-performance skill) — the bulk pick list's orders
// (the-bulk-pick-list-prototype-is-accepted) at one id and at the contract's cap (50), over 50 000 orders with three
// lines each, a fifth of them shipping from the asking warehouse.
//
//	go test -tags perfaudit -run TestPerf_OrderPickLines -v ./backend/services/selling_service/selling_v1/
package selling_v1_test

import (
	"fmt"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

func TestPerf_OrderPickLines(t *testing.T) {
	tx := san_testdb.DB(t)
	db, probe := san_perf.Wrap(tx)

	const rows = 50_000

	shop := insertShop(t, db, 2, "Toko Ambil Perf", "AMB-PERF", "shopee")

	orders := make([]selling_service_models.Order, 0, rows)
	for i := range rows {
		take := uint64(5_000_000 + i)
		orders = append(orders, selling_service_models.Order{
			IdempotencyKey:     newOrderKey(),
			TeamID:             2,
			ShopID:             shop,
			WarehouseID:        testWarehouse + uint64(i%5),
			Status:             "processed",
			TransactionID:      &take,
			OrderExternalRefID: fmt.Sprintf("SP-PERF-%06d", i),
			Receipt:            fmt.Sprintf("JP%010d", i),
			ShipmentChannelID:  testShipmentChannel,
			Address:            &selling_service_models.OrderAddress{CustomerName: "Budi"},
			Items: []selling_service_models.OrderItem{
				{ProductID: 1 + uint64(i%40), ProductCode: "SKU-A", Name: "Kaos", Quantity: 1},
				{ProductID: 41 + uint64(i%40), ProductCode: "SKU-B", Name: "Topi", Quantity: 2},
				{ProductID: 81 + uint64(i%40), ProductCode: "SKU-C", Name: "Kemeja", Quantity: 1},
			},
		})
	}

	san_perf.SeedRows(t, db, orders)

	err := db.Exec("ANALYZE order_items").Error
	if err != nil {
		t.Fatalf("analyze: %v", err)
	}

	// The asking warehouse's orders (every fifth row), spread across the table, as a page of the list would hold them.
	mine := make([]uint64, 0, 50)
	for i := 0; len(mine) < 50; i += 5 * 101 {
		mine = append(mine, orders[i].ID)
	}

	svc := newService(t, db)
	ctx := t.Context()

	for _, ids := range [][]uint64{mine[:1], mine} {
		req := &sellingv1.OrderPickLinesRequest{TeamId: testWarehouse, OrderIds: ids}

		_, err = svc.OrderPickLines(ctx, connect.NewRequest(req))
		if err != nil {
			t.Fatalf("warm-up: %v", err)
		}

		walls := make([]time.Duration, 0, 5)

		var res *connect.Response[sellingv1.OrderPickLinesResponse]

		for range 5 {
			probe.Reset()

			wall, dbTime := probe.Measure(func() {
				res, err = svc.OrderPickLines(ctx, connect.NewRequest(req))
			})
			if err != nil {
				t.Fatalf("OrderPickLines (%d ids): %v", len(ids), err)
			}

			walls = append(walls, wall)
			t.Logf("%d ids: wall=%v db=%v go=%v queries=%d", len(ids), wall, dbTime, wall-dbTime, probe.Count())
		}

		if len(res.Msg.GetOrders()) != len(ids) {
			t.Fatalf("%d ids answered %d orders", len(ids), len(res.Msg.GetOrders()))
		}

		t.Logf("OrderPickLines %d ids MEDIAN wall %v, %d queries", len(ids), san_perf.Median(walls), probe.Count())
		probe.Report(t, fmt.Sprintf("OrderPickLines %d ids", len(ids)))

		if probe.Count() != 2 {
			t.Fatalf("%d ids took %d queries, want 2 (the orders, then their lines) whatever the count", len(ids), probe.Count())
		}

		for _, q := range probe.Queries() {
			if strings.HasPrefix(strings.TrimSpace(strings.ToUpper(q.SQL)), "SELECT") {
				san_perf.Explain(t, db, q.SQL)
			}
		}
	}
}
