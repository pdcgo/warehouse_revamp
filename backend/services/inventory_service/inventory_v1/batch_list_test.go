package inventory_v1_test

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// seedTwoBatches accepts a two-line delivery so there are batches to list, and returns the request.
func seedTwoBatches(t *testing.T, svc *inventory_v1.Service, warehouse uint64) *inventoryv1.RestockRequest {
	t.Helper()
	ctx := ctxUser(1)

	rack, err := svc.RackCreate(ctx, connect.NewRequest(&inventoryv1.RackCreateRequest{TeamId: warehouse, Code: "A-01-3"}))
	if err != nil {
		t.Fatalf("rack: %v", err)
	}
	rackID := rack.Msg.GetRack().GetId()

	created, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: 2, WarehouseId: warehouse, ShippingCode: "jne", ShippingCost: 80000, Receipt: "GRN-0721",
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: 100, Sku: "KPH-001", Name: "Kaos", Quantity: 100, TotalPrice: 4000000},
			{ProductId: 200, Sku: "TTM-207", Name: "Topi", Quantity: 30, TotalPrice: 840000},
		},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	req := created.Msg.GetRequest()
	items := req.GetItems()

	_, err = svc.RestockRequestFulfill(ctx, connect.NewRequest(&inventoryv1.RestockRequestFulfillRequest{
		TeamId: warehouse, RequestId: req.GetId(), CodShippingFee: 50000,
		Lines: []*inventoryv1.RestockRequestReceivedLine{
			{
				ItemId:           items[0].GetId(),
				ReceivedQuantity: 100,
				Placements:       []*inventoryv1.RestockPlacement{{Place: &inventoryv1.RestockPlacement_RackId{RackId: rackID}, Quantity: 100}},
			},
			{
				ItemId:           items[1].GetId(),
				ReceivedQuantity: 28,
				Placements:       []*inventoryv1.RestockPlacement{{Place: &inventoryv1.RestockPlacement_Unplaced{Unplaced: true}, Quantity: 28}},
				Damaged:          []*inventoryv1.RestockDamagedUnits{{Quantity: 2, Reason: "crushed", Type: broken}},
			},
		},
	}))
	if err != nil {
		t.Fatalf("fulfil: %v", err)
	}

	return req
}

func TestBatchList_ReadsCostLayers(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	const warehouse uint64 = 5

	req := seedTwoBatches(t, svc, warehouse)

	res, err := svc.BatchList(context.Background(), connect.NewRequest(&inventoryv1.BatchListRequest{
		TeamId: warehouse,
		Page:   page1(),
	}))
	if err != nil {
		t.Fatalf("BatchList: %v", err)
	}
	msg := res.Msg

	if len(batchRows(msg)) != 2 {
		t.Fatalf("%d batches, want 2", len(batchRows(msg)))
	}

	byProduct := map[uint64]*inventoryv1.StockBatch{}
	for _, b := range batchRows(msg) {
		byProduct[b.GetProductId()] = b
	}

	shirt := byProduct[100]
	hat := byProduct[200]
	if shirt == nil || hat == nil {
		t.Fatalf("missing a batch: %+v", byProduct)
	}

	// Identity + snapshots come off the delivery and the line.
	if shirt.GetDeliveryId() != req.GetId() || shirt.GetReceiptNo() != "GRN-0721" || shirt.GetSku() != "KPH-001" {
		t.Fatalf("shirt identity wrong: %+v", shirt)
	}

	// Frozen cost + the lifecycle numbers (freight 130.000 / 128 sellable = 1.015/pc):
	//   shirt cost 41.015; arrived 100, damaged 0, ready 100, used 0
	//   hat   cost 31.015; arrived 30, damaged 2, ready 28, used 0
	if !shirt.GetCostKnown() || shirt.GetUnitCost() != 41015 {
		t.Fatalf("shirt cost = %d known=%v, want 41015/true", shirt.GetUnitCost(), shirt.GetCostKnown())
	}
	if shirt.GetArrived() != 100 || shirt.GetBroken() != 0 || shirt.GetReady() != 100 || shirt.GetUsed() != 0 {
		t.Fatalf("shirt lifecycle = a%d b%d r%d u%d, want 100/0/100/0",
			shirt.GetArrived(), shirt.GetBroken(), shirt.GetReady(), shirt.GetUsed())
	}
	if hat.GetArrived() != 30 || hat.GetBroken() != 2 || hat.GetReady() != 28 {
		t.Fatalf("hat lifecycle = a%d b%d r%d, want 30/2/28", hat.GetArrived(), hat.GetBroken(), hat.GetReady())
	}

	// line_cost = arrived × cost; ready_value = ready × cost.
	if shirt.GetLineCost() != 4101500 || shirt.GetReadyValue() != 4101500 {
		t.Fatalf("shirt line=%d ready_value=%d, want 4101500/4101500", shirt.GetLineCost(), shirt.GetReadyValue())
	}
	if hat.GetLineCost() != 930450 || hat.GetReadyValue() != 868420 {
		t.Fatalf("hat line=%d ready_value=%d, want 930450/868420", hat.GetLineCost(), hat.GetReadyValue())
	}

	// Header tile: ready value over the whole set = 4.101.500 + 868.420.
	if msg.GetReadyValueTotal() != 4969920 {
		t.Fatalf("ready_value_total = %d, want 4969920", msg.GetReadyValueTotal())
	}

	// Filter to one product — the detail's Batches tab.
	only, err := svc.BatchList(context.Background(), connect.NewRequest(&inventoryv1.BatchListRequest{
		TeamId: warehouse, Filter: &inventoryv1.BatchListFilter{ProductId: 100}, Page: page1(),
	}))
	if err != nil {
		t.Fatalf("BatchList product filter: %v", err)
	}
	if len(batchRows(only.Msg)) != 1 || batchRows(only.Msg)[0].GetProductId() != 100 {
		t.Fatalf("product filter returned %d batches, want 1 for product 100", len(batchRows(only.Msg)))
	}

	// Search by the delivery/batch number (with the on-screen '#') finds the delivery's batches.
	found, err := svc.BatchList(context.Background(), connect.NewRequest(&inventoryv1.BatchListRequest{
		TeamId: warehouse, Filter: &inventoryv1.BatchListFilter{Search: "GRN-0721"}, Page: page1(),
	}))
	if err != nil {
		t.Fatalf("BatchList search: %v", err)
	}
	if len(batchRows(found.Msg)) != 2 {
		t.Fatalf("receipt search returned %d, want 2", len(batchRows(found.Msg)))
	}
}

// The date-range filter (#217) narrows on the arrived (accepted-at) or the expiry date. Here the two
// batches arrived just now, so a range ending yesterday finds none and one ending tomorrow finds both.
func TestBatchList_DateRange(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	const warehouse uint64 = 5
	seedTwoBatches(t, svc, warehouse)

	now := time.Now()

	// Arrived on or before yesterday — nothing (they just arrived).
	past, err := svc.BatchList(context.Background(), connect.NewRequest(&inventoryv1.BatchListRequest{
		TeamId: warehouse,
		Filter: &inventoryv1.BatchListFilter{
			DateField: inventoryv1.BatchDateField_BATCH_DATE_FIELD_ARRIVED,
			ToUnix:    now.AddDate(0, 0, -1).Unix(),
		},
		Page: page1(),
	}))
	if err != nil {
		t.Fatalf("BatchList past: %v", err)
	}
	if len(batchRows(past.Msg)) != 0 {
		t.Fatalf("arrived ≤ yesterday returned %d, want 0", len(batchRows(past.Msg)))
	}

	// Arrived on or before tomorrow — both.
	upto, err := svc.BatchList(context.Background(), connect.NewRequest(&inventoryv1.BatchListRequest{
		TeamId: warehouse,
		Filter: &inventoryv1.BatchListFilter{
			DateField: inventoryv1.BatchDateField_BATCH_DATE_FIELD_ARRIVED,
			ToUnix:    now.AddDate(0, 0, 1).Unix(),
		},
		Page: page1(),
	}))
	if err != nil {
		t.Fatalf("BatchList upto: %v", err)
	}
	if len(batchRows(upto.Msg)) != 2 {
		t.Fatalf("arrived ≤ tomorrow returned %d, want 2", len(batchRows(upto.Msg)))
	}
}
