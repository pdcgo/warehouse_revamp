package inventory_v1_test

import (
	"context"
	"fmt"
	"sync/atomic"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_mutations"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// stockOnLedger puts `count` units of a product on one rack through the same mutation a restock accept writes — one
// `restock` transaction owned by `team`, one batch at `price`, the rack row — so a reader's test starts from stock the
// decided ledgers hold. Returns the transaction.
func stockOnLedger(
	t *testing.T,
	db *gorm.DB,
	warehouse, team, product, rack uint64,
	count int64,
	price float64,
) models.InventoryTransaction {
	t.Helper()

	tx, err := inventory_mutations.PostRestock(db, inventory_mutations.Restock{
		WarehouseID: warehouse,
		TeamID:      team,
		ActorID:     1,
		Lines: []inventory_mutations.RestockLine{{
			ProductID:  product,
			Good:       count,
			PriceUnit:  price,
			Placements: []inventory_mutations.RestockPlacement{{PlacementID: rack, Count: count}},
		}},
	})
	if err != nil {
		t.Fatalf("stock %d of product %d on rack %d: %v", count, product, rack, err)
	}

	return tx
}

// seedOwner owns the stock seedLevel puts down.
const seedOwner uint64 = 2

// seedLevel puts `onHand` units of a product on a rack of the warehouse, on the ledgers, owned by seedOwner. A nil rack
// is a fresh one — every unit is on a rack (there-is-no-unplaced-pile). 0 leaves an EMPTIED rack row: a row at 0, as a
// rack that once held the product reads.
func seedLevel(t *testing.T, db *gorm.DB, warehouseID, productID uint64, rack *uint64, onHand int64) {
	t.Helper()

	if rack == nil {
		id := insertRack(t, db, warehouseID, fmt.Sprintf("seed-%d-%d", productID, onHand))
		rack = &id
	}

	if onHand > 0 {
		stockOnLedger(t, db, warehouseID, seedOwner, productID, *rack, onHand, 1000)
		return
	}

	err := db.Exec(`
		INSERT INTO product_placements (team_id, warehouse_id, product_id, placement_id, stock_count)
		VALUES (?, ?, ?, ?, 0)
		ON CONFLICT (product_id, placement_id) DO NOTHING`,
		seedOwner, warehouseID, productID, *rack,
	).Error
	if err != nil {
		t.Fatalf("seed an emptied rack row: %v", err)
	}
}

var receiveRacks atomic.Uint64

// receive brings `qty` units of a product into the warehouse the way they really come in: a restock raised by
// seedOwner and accepted onto a FRESH rack — every unit is on a rack (there-is-no-unplaced-pile). Returns the rack.
func receive(
	t *testing.T,
	svc *inventory_v1.Service,
	ctx context.Context,
	warehouseID, productID uint64,
	qty int64,
) uint64 {
	t.Helper()

	rack, err := svc.RackCreate(ctx, connect.NewRequest(&inventoryv1.RackCreateRequest{
		TeamId: warehouseID, Code: fmt.Sprintf("recv-%d", receiveRacks.Add(1)), Name: "Receiving",
	}))
	if err != nil {
		t.Fatalf("receiving rack: %v", err)
	}

	receiveOn(t, svc, ctx, warehouseID, productID, rack.Msg.GetRack().GetId(), qty)

	return rack.Msg.GetRack().GetId()
}

// receiveOn is receive onto a rack the test already has, at Rp 1.000 a unit.
func receiveOn(
	t *testing.T,
	svc *inventory_v1.Service,
	ctx context.Context,
	warehouseID, productID, rackID uint64,
	qty int64,
) {
	t.Helper()

	created, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: seedOwner, WarehouseId: warehouseID,
		Items: []*inventoryv1.RestockRequestItem{{ProductId: productID, Sku: "SKU", Name: "Product", Count: qty, Total: float64(qty * 1000)}},
	}))
	if err != nil {
		t.Fatalf("receive %d — restock create: %v", qty, err)
	}

	r := created.Msg.GetRequest()

	_, err = svc.RestockRequestAccept(ctx, connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: warehouseID, RequestId: r.GetId(),
		Lines: []*inventoryv1.RestockRequestReceivedLine{{
			ItemId: r.GetItems()[0].GetId(), ReceivedCount: qty,
			Placements: []*inventoryv1.RestockPlacement{{PlacementId: rackID, Quantity: qty}},
		}},
	}))
	if err != nil {
		t.Fatalf("receive %d — restock accept: %v", qty, err)
	}
}

// onHand reads a product's on-hand at a warehouse via StockList (0 if it holds none).
func onHand(t *testing.T, svc *inventory_v1.Service, ctx context.Context, warehouseID, productID uint64) int64 {
	t.Helper()

	return warehouseTotal(t, svc, ctx, warehouseID, productID)
}

// warehouseTotal is what StockList reports: the warehouse's total for a product, across its racks.
func warehouseTotal(
	t *testing.T,
	svc interface {
		StockList(context.Context, *connect.Request[inventoryv1.StockListRequest]) (*connect.Response[inventoryv1.StockListResponse], error)
	},
	ctx context.Context,
	warehouse, product uint64,
) int64 {
	t.Helper()

	resp, err := svc.StockList(ctx, connect.NewRequest(&inventoryv1.StockListRequest{WarehouseId: warehouse, Page: page1()}))
	if err != nil {
		t.Fatalf("StockList: %v", err)
	}

	for _, lvl := range stockLevelRows(resp.Msg) {
		if lvl.GetProductId() == product {
			return lvl.GetOnHand()
		}
	}

	return 0
}

// placeOnHand reads ONE rack row's count straight from the placement ledger; nil reads 0 — there is no unplaced pile.
func placeOnHand(t *testing.T, db *gorm.DB, warehouse, product uint64, rack *uint64) int64 {
	t.Helper()

	if rack == nil {
		return 0
	}

	var on int64

	err := db.Raw(`SELECT COALESCE(SUM(stock_count), 0) FROM product_placements WHERE warehouse_id = ? AND product_id = ? AND placement_id = ?`,
		warehouse, product, *rack).Scan(&on).Error
	if err != nil {
		t.Fatalf("read rack row: %v", err)
	}

	return on
}

func onRack(id uint64) *inventoryv1.StockPlace {
	return &inventoryv1.StockPlace{Place: &inventoryv1.StockPlace_RackId{RackId: id}}
}
