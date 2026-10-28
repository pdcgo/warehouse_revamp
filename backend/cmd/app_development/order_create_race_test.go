//go:build raceaudit

// Concurrency audit for OrderCreate (the audit-sql skill), after an-order-is-costed-at-what-leaves-the-shelf moved the
// order's money onto the take's answer: the warehouse fee is priced AFTER the take, inside the order's transaction, and
// the header's goods_cost, fee and total_cost are written by an UPDATE of the order's own row once the draw is known.
//
// It lives in the composition root because it is the one place selling's placeOrder, inventory's take and warehouse's
// fee meet a real database together — the race is across the three, through the real adapters.
//
// Build-tagged so it never runs beside the rolling-back tests: san_race COMMITS.
//
//	go test -tags raceaudit -run "TestRace_OrderCreate" -v ./backend/cmd/app_development/
package main

import (
	"context"
	"math"
	"sort"
	"sync"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
	warehouse_v1 "github.com/pdcgo/warehouse_revamp/backend/services/warehouse_service/warehouse_v1"
)

// Parents' children cascade; the ledgers are listed children first.
var orderRaceTables = []string{
	"orders",
	"order_drafts",
	"shops",
	"warehouse_fees",
	"idempotency_order_check",
	"inventory_transaction_items",
	"batch_price_logs",
	"batch_logs",
	"product_placement_logs",
	"product_placements",
	"batches",
	"inventory_transactions",
	"placements",
}

const (
	ocTeam      uint64 = 2
	ocWarehouse uint64 = 5
	ocProduct   uint64 = 901
)

// seedTwoBatches commits the spec's shelf: 2 units bought at 10.000 in January, 2 at 14.000 in March — 48.000 in all —
// on one rack, a 10% warehouse fee, and a shop. Returns the shop.
func seedTwoBatches(t *testing.T, db *gorm.DB) uint64 {
	t.Helper()

	var restockTx, rack, shop uint64

	err := db.Raw(`INSERT INTO inventory_transactions (warehouse_id, team_id, tx_type) VALUES (?, ?, 'restock') RETURNING id`,
		ocWarehouse, ocTeam).Scan(&restockTx).Error
	if err == nil {
		err = db.Raw(`INSERT INTO placements (warehouse_id, code, name) VALUES (?, 'rak-a', 'rak-a') RETURNING id`,
			ocWarehouse).Scan(&rack).Error
	}

	for _, price := range []float64{10_000, 14_000} {
		if err != nil {
			break
		}

		err = db.Exec(`
			INSERT INTO batches (warehouse_id, team_id, product_id, transaction_id, price_unit, stock_count, stock_valuation,
			                     init_stock_count, init_stock_valuation)
			VALUES (?, ?, ?, ?, ?, 2, ?, 2, ?)`,
			ocWarehouse, ocTeam, ocProduct, restockTx, price, price*2, price*2).Error
	}

	if err == nil {
		err = db.Exec(`INSERT INTO product_placements (team_id, warehouse_id, product_id, placement_id, stock_count)
			VALUES (?, ?, ?, ?, 4)`, ocTeam, ocWarehouse, ocProduct, rack).Error
	}

	if err == nil {
		err = db.Exec(`INSERT INTO warehouse_fees (warehouse_id, fee_percent, min_fee) VALUES (?, 10, 0)`, ocWarehouse).Error
	}

	if err == nil {
		err = db.Raw(`INSERT INTO shops (team_id, name, shop_code, marketplace) VALUES (?, 'Toko Melati', 'MEL', 'shopee')
			RETURNING id`, ocTeam).Scan(&shop).Error
	}

	if err != nil {
		t.Fatalf("seed: %v", err)
	}

	return shop
}

// orderService is selling wired to the REAL take and the REAL fee, through the composition root's own adapters.
func orderService(db *gorm.DB, fees selling_v1.WarehouseFeePricer) *selling_v1.Service {
	inventory := inventory_v1.NewService(db, nil, nil, nil, nil, nil)

	if fees == nil {
		fees = NewWarehouseFeePricer(warehouse_v1.NewService(db, nil))
	}

	return selling_v1.NewService(db, NewStockPicker(inventory), nil, nil, nil, nil, nil, fees)
}

func twoUnits(shop uint64) *sellingv1.OrderCreateRequest {
	return &sellingv1.OrderCreateRequest{
		TeamId: ocTeam, ShopId: shop, WarehouseId: ocWarehouse, CustomerName: "Budi",
		PlatformCreatedAtUnix: 1_790_000_000, PlatformTotal: 60_000,
		Items: []*sellingv1.OrderItem{{ProductId: ocProduct, Sku: "KAOS", Name: "Kaos", Quantity: 2}},
	}
}

// EIGHT CREATES OVER A FOUR-UNIT SHELF, each wanting 2: exactly two win, and each freezes THE DRAW IT MADE — one the
// January pair (20.000), the other the March pair (28.000). Their goods_cost add up to the 48.000 the goods were bought for,
// each fee is 10% of its own goods_cost (an own product: no markup), each line's unit cost is its own batch's, and each order's goods_cost is exactly what its
// inventory transaction took. A loser's take is given back. The data, not the errors, is asserted.
func TestRace_OrderCreate_EachOrderFreezesItsOwnDraw(t *testing.T) {
	h := san_race.New(t, orderRaceTables...)
	db := h.DB()

	for round := range 5 {
		resetOrderRace(t, db)
		shop := seedTwoBatches(t, db)
		svc := orderService(db, nil)

		res := h.Race(t, 8, func(int) error {
			_, err := svc.OrderCreate(context.Background(), connect.NewRequest(twoUnits(shop)))

			return err
		})

		if round == 0 {
			res.Report(t)
		}

		var orders []struct {
			ID           uint64
			GoodsCost    int64
			WarehouseFee *float64
		}

		db.Raw(`SELECT id, goods_cost, warehouse_fee FROM orders ORDER BY goods_cost`).Scan(&orders)

		if len(orders) != 2 {
			t.Fatalf("round %d: %d orders over a shelf of 4 with 2 each, want exactly 2", round, len(orders))
		}

		if orders[0].GoodsCost != 20_000 || orders[1].GoodsCost != 28_000 {
			t.Fatalf("round %d: goods_cost %d and %d, want the January 20000 and the March 28000 — each its own draw",
				round, orders[0].GoodsCost, orders[1].GoodsCost)
		}

		for _, o := range orders {
			if o.WarehouseFee == nil || math.Abs(*o.WarehouseFee-float64(o.GoodsCost)/10) > 0.0001 {
				t.Fatalf("round %d: order %d fee %v on goods_cost %d, want 10%% of its own goods_cost", round, o.ID, o.WarehouseFee, o.GoodsCost)
			}

			var taken float64

			db.Raw(`
				SELECT COALESCE(SUM(i.total), 0) FROM inventory_transaction_items i
				JOIN idempotency_order_check k ON k.transaction_id = i.transaction_id
				WHERE k.idempotency_key = ?`, "order:"+itoa(o.ID)).Scan(&taken)

			if int64(math.Round(taken)) != o.GoodsCost {
				t.Fatalf("round %d: order %d froze goods_cost %d, its take drew %v", round, o.ID, o.GoodsCost, taken)
			}

			var unitCosts []int64

			db.Raw(`SELECT unit_cost FROM order_items WHERE order_id = ?`, o.ID).Scan(&unitCosts)
			if len(unitCosts) != 1 || unitCosts[0]*2 != o.GoodsCost {
				t.Fatalf("round %d: order %d lines' unit costs %v, want its own batch's price", round, o.ID, unitCosts)
			}
		}

		var left int64

		db.Raw(`SELECT COALESCE(SUM(stock_count), 0) FROM batches WHERE product_id = ?`, ocProduct).Scan(&left)
		if left != 0 {
			t.Fatalf("round %d: the shelf holds %d after two orders of 2 from 4, want 0", round, left)
		}
	}
}

// parkedFees is the real pricer, held inside the fee call until released — the window this change opened.
type parkedFees struct {
	real    selling_v1.WarehouseFeePricer
	entered chan struct{}
	release chan struct{}
	once    sync.Once
}

func (p *parkedFees) Price(ctx context.Context, teamID, warehouseID uint64, goodsCost float64) (float64, error) {
	p.once.Do(func() { close(p.entered) })
	<-p.release

	return p.real.Price(ctx, teamID, warehouseID, goodsCost)
}

// WHAT THE FEE CALL HOLDS, and what it does not. While an order is parked in the fee call — after the take, inside its
// transaction — its INSERT still holds KEY SHARE on the shop row, so a grant writer's FOR UPDATE on that shop waits
// (pattern 6, the same exposure the take inside the transaction already had, #149). A second create on the SAME shop is
// not blocked by it: the fee read takes no lock, so nothing can deadlock on it.
func TestRace_OrderCreate_TheFeeCallHoldsTheShopKeyShareOnly(t *testing.T) {
	h := san_race.New(t, orderRaceTables...)
	db := h.DB()
	shop := seedTwoBatches(t, db)

	fees := &parkedFees{
		real:    NewWarehouseFeePricer(warehouse_v1.NewService(db, nil)),
		entered: make(chan struct{}),
		release: make(chan struct{}),
	}
	parked := orderService(db, fees)

	done := make(chan error, 1)

	go func() {
		_, err := parked.OrderCreate(context.Background(), connect.NewRequest(twoUnits(shop)))
		done <- err
	}()

	select {
	case <-fees.entered:
	case <-time.After(10 * time.Second):
		t.Fatal("the create never reached the fee call")
	}

	// A grant writer's lock on the shop: refused at once while the create sits in the fee call.
	err := db.Transaction(func(tx *gorm.DB) error {
		return tx.Exec(`SELECT id FROM shops WHERE id = ? FOR UPDATE NOWAIT`, shop).Error
	})
	if san_race.Classify(err) != san_race.LockTimeout {
		t.Fatalf("FOR UPDATE on the shop during the fee call: %v (%s) — want it to be held (lock not available)", err,
			san_race.Classify(err))
	}

	// A second create on the same shop, through the real fee, runs to the end while the first is parked.
	other := orderService(db, nil)

	_, err = other.OrderCreate(context.Background(), connect.NewRequest(twoUnits(shop)))
	if err != nil {
		t.Fatalf("a second create while the first is parked in the fee call: %v — want it to pass", err)
	}

	close(fees.release)

	err = <-done
	if err != nil {
		t.Fatalf("the parked create, released: %v", err)
	}

	var goodsCosts []int64

	db.Raw(`SELECT goods_cost FROM orders ORDER BY goods_cost`).Scan(&goodsCosts)
	sort.Slice(goodsCosts, func(i, j int) bool { return goodsCosts[i] < goodsCosts[j] })

	if len(goodsCosts) != 2 || goodsCosts[0] != 20_000 || goodsCosts[1] != 28_000 {
		t.Fatalf("goods_cost %v, want the parked order's January 20000 and the second's March 28000", goodsCosts)
	}

	err = db.Transaction(func(tx *gorm.DB) error {
		return tx.Exec(`SELECT id FROM shops WHERE id = ? FOR UPDATE NOWAIT`, shop).Error
	})
	if err != nil {
		t.Fatalf("the shop is still held after both creates committed: %v", err)
	}
}

// resetOrderRace empties the race's tables between rounds, in the harness's own order.
func resetOrderRace(t *testing.T, db *gorm.DB) {
	t.Helper()

	for _, table := range orderRaceTables {
		err := db.Exec(`DELETE FROM ` + table).Error
		if err != nil {
			t.Fatalf("reset %s: %v", table, err)
		}
	}
}

func itoa(n uint64) string {
	if n == 0 {
		return "0"
	}

	var b []byte

	for n > 0 {
		b = append([]byte{byte('0' + n%10)}, b...)
		n /= 10
	}

	return string(b)
}
