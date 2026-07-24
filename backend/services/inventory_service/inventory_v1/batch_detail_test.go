package inventory_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// BatchDetail is one batch's full record; BatchPlacementList is where it sits. A batch of another
// warehouse reads NotFound (#209).
func TestBatchDetailAndPlacements(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const warehouse, product uint64 = 5, 100

	rackA, err := svc.RackCreate(ctx, connect.NewRequest(&inventoryv1.RackCreateRequest{TeamId: warehouse, Code: "A-01-3"}))
	if err != nil {
		t.Fatalf("rack A: %v", err)
	}
	rackB, err := svc.RackCreate(ctx, connect.NewRequest(&inventoryv1.RackCreateRequest{TeamId: warehouse, Code: "B-04-2"}))
	if err != nil {
		t.Fatalf("rack B: %v", err)
	}
	rackAID := rackA.Msg.GetRack().GetId()
	rackBID := rackB.Msg.GetRack().GetId()

	// One delivery of 100, split 60/40 across two shelves.
	created, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: 2, WarehouseId: warehouse, ShippingCode: "jne", Receipt: "GRN-0721",
		Items: []*inventoryv1.RestockRequestItem{{ProductId: product, Sku: "KPH-001", Name: "Kaos", Quantity: 100, TotalPrice: 4000000}},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	item := created.Msg.GetRequest().GetItems()[0]
	_, err = svc.RestockRequestFulfill(ctx, connect.NewRequest(&inventoryv1.RestockRequestFulfillRequest{
		TeamId: warehouse, RequestId: created.Msg.GetRequest().GetId(),
		Lines: []*inventoryv1.RestockRequestReceivedLine{{
			ItemId:           item.GetId(),
			ReceivedQuantity: 100,
			Placements: []*inventoryv1.RestockPlacement{
				{Place: &inventoryv1.RestockPlacement_RackId{RackId: rackAID}, Quantity: 60},
				{Place: &inventoryv1.RestockPlacement_RackId{RackId: rackBID}, Quantity: 40},
			},
		}},
	}))
	if err != nil {
		t.Fatalf("fulfil: %v", err)
	}

	list, err := svc.BatchList(ctx, connect.NewRequest(&inventoryv1.BatchListRequest{TeamId: warehouse, Page: page1(), ProductId: product}))
	if err != nil {
		t.Fatalf("BatchList: %v", err)
	}
	batchID := list.Msg.GetBatches()[0].GetId()

	// Detail.
	detail, err := svc.BatchDetail(context.Background(), connect.NewRequest(&inventoryv1.BatchDetailRequest{TeamId: warehouse, BatchId: batchID}))
	if err != nil {
		t.Fatalf("BatchDetail: %v", err)
	}
	b := detail.Msg.GetBatch()
	if b.GetReceiptNo() != "GRN-0721" || b.GetArrived() != 100 || b.GetReady() != 100 {
		t.Fatalf("detail = receipt %q arrived %d ready %d, want GRN-0721/100/100", b.GetReceiptNo(), b.GetArrived(), b.GetReady())
	}

	// Placements — the two shelves.
	places, err := svc.BatchPlacementList(context.Background(), connect.NewRequest(&inventoryv1.BatchPlacementListRequest{
		TeamId: warehouse, BatchId: batchID, Page: page1(),
	}))
	if err != nil {
		t.Fatalf("BatchPlacementList: %v", err)
	}
	byRack := map[uint64]int64{}
	for _, s := range places.Msg.GetShelves() {
		byRack[s.GetRackId()] = s.GetQty()
	}
	if byRack[rackAID] != 60 || byRack[rackBID] != 40 {
		t.Fatalf("batch shelves = A:%d B:%d, want 60/40", byRack[rackAID], byRack[rackBID])
	}

	// Another warehouse cannot read the batch.
	_, err = svc.BatchDetail(context.Background(), connect.NewRequest(&inventoryv1.BatchDetailRequest{TeamId: 9, BatchId: batchID}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("cross-warehouse BatchDetail = %v, want NotFound", connect.CodeOf(err))
	}
}
