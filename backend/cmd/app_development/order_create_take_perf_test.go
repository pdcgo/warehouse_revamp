//go:build perfaudit

// Performance audit for OrderCreate after backlog #10 slice 3 (the audit-rpc-performance skill): the stock take runs
// BEFORE the order row and OUTSIDE selling's transaction, under the order's key, and a create that fails after the take
// releases it directly and publishes InventoryTxCancel. Measured through the REAL take and the REAL fee, on one probed
// database, beside a shelf with history on it: a create that places (the key lookup, the take in its own transaction,
// then selling's transaction), and a create the fee refuses after the take (the same, plus the compensation's release).
//
//	go test -tags perfaudit -p 1 -run TestPerf_OrderCreate_TakeBeforeTheRow -v ./backend/cmd/app_development/
package main

import (
	"context"
	"strconv"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
	warehouse_v1 "github.com/pdcgo/warehouse_revamp/backend/services/warehouse_service/warehouse_v1"
)

const (
	perfTakeTeam      uint64 = 9_300_001
	perfTakeWarehouse uint64 = 9_300_002 // has a fee rate — a create places
	perfTakeNoRate    uint64 = 9_300_003 // has stock, no fee rate — a create fails after its take
	perfTakeProduct   uint64 = 9_300_010
)

// perfTakeShelf seeds both warehouses with 5 000 units of the product over 50 batches on 10 racks, a 10% fee on the
// first only, and a shop. Returns the shop.
func perfTakeShelf(t *testing.T, db *gorm.DB) uint64 {
	t.Helper()

	quiet := db.Session(&gorm.Session{Logger: logger.Discard})

	var shop uint64

	err := quiet.Raw(`INSERT INTO shops (team_id, name, shop_code, marketplace) VALUES (?, 'Toko Perf', 'PERF-TAKE', 'shopee')
		RETURNING id`, perfTakeTeam).Scan(&shop).Error
	if err != nil {
		t.Fatalf("shop: %v", err)
	}

	for _, w := range []uint64{perfTakeWarehouse, perfTakeNoRate} {
		var restockTx uint64

		err = quiet.Raw(`INSERT INTO inventory_transactions (warehouse_id, team_id, tx_type) VALUES (?, ?, 'restock') RETURNING id`,
			w, perfTakeTeam).Scan(&restockTx).Error
		if err != nil {
			t.Fatalf("restock tx: %v", err)
		}

		statements := []string{
			`INSERT INTO batches (warehouse_id, team_id, product_id, transaction_id, price_unit, stock_count, stock_valuation,
			                      init_stock_count, init_stock_valuation)
			 SELECT ?, ?, ?, ?, 10000 + g, 100, (10000 + g) * 100, 100, (10000 + g) * 100 FROM generate_series(1, 50) g`,
			`INSERT INTO placements (warehouse_id, code, name) SELECT ?, 'perf-take-' || g, 'Rak' FROM generate_series(1, 10) g`,
		}

		err = quiet.Exec(statements[0], w, perfTakeTeam, perfTakeProduct, restockTx).Error
		if err == nil {
			err = quiet.Exec(statements[1], w).Error
		}

		if err == nil {
			err = quiet.Exec(`INSERT INTO product_placements (team_id, warehouse_id, product_id, placement_id, stock_count)
				SELECT ?, ?, ?, id, 500 FROM placements WHERE warehouse_id = ? AND code LIKE 'perf-take-%'`,
				perfTakeTeam, w, perfTakeProduct, w).Error
		}

		if err != nil {
			t.Fatalf("shelf %d: %v", w, err)
		}
	}

	err = quiet.Exec(`INSERT INTO warehouse_fees (warehouse_id, fee_percent, min_fee) VALUES (?, 10, 0)`, perfTakeWarehouse).Error
	if err != nil {
		t.Fatalf("fee: %v", err)
	}

	err = quiet.Exec(`ANALYZE batches; ANALYZE product_placements; ANALYZE idempotency_order_check; ANALYZE orders`).Error
	if err != nil {
		t.Fatalf("analyze: %v", err)
	}

	return shop
}

func perfTakeReq(shop, warehouse uint64, key string) *sellingv1.OrderCreateRequest {
	return &sellingv1.OrderCreateRequest{
		ShipmentChannelId: testShipmentChannelID,
		IdempotencyKey:    key,
		TeamId:            perfTakeTeam, ShopId: shop, WarehouseId: warehouse, CustomerName: "Budi",
		PlatformCreatedAtUnix: 1_790_000_000, PlatformTotal: 60_000,
		Items: []*sellingv1.OrderItem{{ProductId: perfTakeProduct, ProductCode: "KAOS", Name: "Kaos", Quantity: 3}},
	}
}

func TestPerf_OrderCreate_TakeBeforeTheRow(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	shop := perfTakeShelf(t, db)

	inventory := inventory_v1.NewService(db, nil, nil, nil, nil, nil, nil, nil)
	svc := selling_v1.NewService(db, NewStockPicker(inventory), nil, nil, nil, runsEveryShop{}, nil,
		NewWarehouseFeePricer(warehouse_v1.NewService(db, nil)), nil, nil)

	run := 0

	for _, tc := range []struct {
		name      string
		warehouse uint64
		ok        bool
	}{
		{"a create that places", perfTakeWarehouse, true},
		{"a create the fee refuses after the take — compensated", perfTakeNoRate, false},
	} {
		place := func() error {
			run++

			_, err := svc.OrderCreate(context.Background(), connect.NewRequest(perfTakeReq(shop, tc.warehouse,
				"perf-take-"+strconv.Itoa(run))))

			return err
		}

		err := place()
		if (err == nil) != tc.ok {
			t.Fatalf("%s warm-up: %v", tc.name, err)
		}

		walls := make([]time.Duration, 0, 5)

		for range 5 {
			probe.Reset()

			var callErr error

			wall, dbTime := probe.Measure(func() {
				callErr = place()
			})
			if (callErr == nil) != tc.ok {
				t.Fatalf("%s: %v", tc.name, callErr)
			}

			walls = append(walls, wall)
			t.Logf("%s: wall=%v db=%v go=%v queries=%d", tc.name, wall, dbTime, wall-dbTime, probe.Count())
		}

		t.Logf("%s: MEDIAN wall %v", tc.name, san_perf.Median(walls))
		probe.Report(t, "OrderCreate — "+tc.name)
	}

	// Every compensated take is back on the shelf: the no-rate warehouse holds all 5 000.
	var left int64

	db.Raw(`SELECT COALESCE(SUM(stock_count), 0) FROM batches WHERE warehouse_id = ?`, perfTakeNoRate).Scan(&left)
	if left != 5_000 {
		t.Fatalf("the no-rate warehouse holds %d after the refused creates, want all 5000 back", left)
	}
}
