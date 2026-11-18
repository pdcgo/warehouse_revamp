package main

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// returnOrdersCatalog is product_service here: every product is the selling team's own, so no line is borrowed.
type returnOrdersCatalog struct {
	team uint64
}

func (c returnOrdersCatalog) Snapshots(_ context.Context, _ uint64, ids []uint64) (map[uint64]selling_v1.ProductSnapshot, error) {
	out := make(map[uint64]selling_v1.ProductSnapshot, len(ids))
	for _, id := range ids {
		out[id] = selling_v1.ProductSnapshot{TeamID: c.team, ProductCode: "SKU", Name: "Kaos"}
	}

	return out, nil
}

// A RETURN'S BATCH OPENS ITS ORDER, THROUGH THE REAL WIRING (a-returns-batch-opens-its-order). Melati's order of 3 ships
// from Gudang A, comes back, and Gudang A — her return warehouse — accepts it through selling's real OrderReturnAccept, its
// stock half through the real StockPicker. Inventory's BatchList and BatchDetail, wired with the composition root's
// ReturnOrders over selling's own table, name THAT order on the batch the return minted; the restock's batch keeps its
// restock number and names no order.
func TestReturnOrders_AReturnsBatchNamesItsOrderThroughTheRealAccept(t *testing.T) {
	const (
		team      uint64 = 9_000_620
		warehouse uint64 = 9_000_621
		product   uint64 = 9_000_622
	)

	ctx := context.Background()
	db := san_testdb.DB(t)
	inventory := inventory_v1.NewService(db, nil, nil, nil, nil, nil, nil, nil, NewInventoryReturnOrders(db), nil)
	svc := selling_v1.NewService(db, NewStockPicker(inventory), nil, returnOrdersCatalog{team: team}, nil, runsEveryShop{},
		nil, nil, nil, nil, nil)

	stockForPicker(t, inventory, team, warehouse, product, 5)
	shop := shopForOrders(t, db, team, warehouse)

	created, err := svc.OrderCreate(ctx, connect.NewRequest(twoLinesOf(team, shop, warehouse, product)))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	order := created.Msg.GetOrder()

	move := func(as uint64, to sellingv1.OrderStatus) {
		t.Helper()

		res, moveErr := svc.OrderStatusChange(ctx, connect.NewRequest(&sellingv1.OrderStatusChangeRequest{
			TeamId: as, OrderIds: []uint64{order.GetId()}, To: to,
		}))
		if moveErr != nil || !res.Msg.GetResults()[0].GetMoved() {
			t.Fatalf("move to %v: %v %v", to, moveErr, res)
		}
	}

	move(warehouse, sellingv1.OrderStatus_ORDER_STATUS_PROCESSED)
	move(warehouse, sellingv1.OrderStatus_ORDER_STATUS_PICKED)
	move(warehouse, sellingv1.OrderStatus_ORDER_STATUS_SHIPPING)
	move(team, sellingv1.OrderStatus_ORDER_STATUS_RETURN)

	var rack uint64

	err = db.Raw(`SELECT id FROM placements WHERE warehouse_id = ? AND code = 'rak-picker'`, warehouse).Scan(&rack).Error
	if err != nil {
		t.Fatalf("the rack: %v", err)
	}

	_, err = svc.OrderReturnAccept(ctx, connect.NewRequest(&sellingv1.OrderReturnAcceptRequest{
		TeamId: warehouse, OrderId: order.GetId(),
		Lines: []*sellingv1.OrderReturnAcceptLine{{
			OrderItemId: order.GetItems()[0].GetId(),
			Placements:  []*sellingv1.OrderReturnPlacement{{RackId: rack, Quantity: 3}},
		}},
	}))
	if err != nil {
		t.Fatalf("accept the return: %v", err)
	}

	list, err := inventory.BatchList(ctx, connect.NewRequest(&inventoryv1.BatchListRequest{
		TeamId: warehouse, Page: &commonv1.CommonPagination{Page: 1, Limit: 20},
	}))
	if err != nil {
		t.Fatalf("batch list: %v", err)
	}

	var returned, restocked *inventoryv1.StockBatch

	for _, item := range list.Msg.GetItems() {
		for _, b := range item.GetBatch().GetMapData() {
			switch b.GetOrigin() {
			case inventoryv1.BatchOrigin_BATCH_ORIGIN_RETURN:
				returned = b
			case inventoryv1.BatchOrigin_BATCH_ORIGIN_RESTOCK:
				restocked = b
			}
		}
	}

	if returned == nil || restocked == nil {
		t.Fatalf("the list = %v — want the restock's batch and the return's", list.Msg)
	}

	if returned.GetReturnOrderId() != order.GetId() || returned.GetDeliveryId() != 0 {
		t.Fatalf("the return's batch = order %d, restock %d — want order %d and no restock",
			returned.GetReturnOrderId(), returned.GetDeliveryId(), order.GetId())
	}

	if restocked.GetReturnOrderId() != 0 || restocked.GetDeliveryId() == 0 {
		t.Fatalf("the restock's batch = order %d, restock %d — want its restock and no order",
			restocked.GetReturnOrderId(), restocked.GetDeliveryId())
	}

	detail, err := inventory.BatchDetail(ctx, connect.NewRequest(&inventoryv1.BatchDetailRequest{
		TeamId: warehouse, BatchId: returned.GetId(),
	}))
	if err != nil {
		t.Fatalf("batch detail: %v", err)
	}

	if detail.Msg.GetBatch().GetReturnOrderId() != order.GetId() {
		t.Fatalf("the return batch's page names order %d — want %d", detail.Msg.GetBatch().GetReturnOrderId(), order.GetId())
	}
}
