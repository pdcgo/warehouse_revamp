package inventory_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// Accepting a delivery MINTS A BATCH per received line (#209): one product's units from one delivery,
// carrying the frozen cost, split across shelves as shelf_batch rows — the (shelf × batch) grain the
// stock feature turns on. Broken units count toward Arrived but never place.
func TestAccept_MintsBatchPerLine(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const sellingTeam, warehouse uint64 = 2, 5

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

	created, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: sellingTeam, WarehouseId: warehouse, ShippingCode: "jne", ShippingCost: 80000,
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

	// 100 shirts split 60/40; 28 hats unplaced with 2 broken.
	_, err = svc.RestockRequestFulfill(ctx, connect.NewRequest(&inventoryv1.RestockRequestFulfillRequest{
		TeamId: warehouse, RequestId: req.GetId(), CodShippingFee: 50000,
		Lines: []*inventoryv1.RestockRequestReceivedLine{
			{
				ItemId:           items[0].GetId(),
				ReceivedQuantity: 100,
				Placements: []*inventoryv1.RestockPlacement{
					{Place: &inventoryv1.RestockPlacement_RackId{RackId: rackAID}, Quantity: 60},
					{Place: &inventoryv1.RestockPlacement_RackId{RackId: rackBID}, Quantity: 40},
				},
			},
			{
				ItemId:           items[1].GetId(),
				ReceivedQuantity: 28,
				Placements: []*inventoryv1.RestockPlacement{
					{Place: &inventoryv1.RestockPlacement_Unplaced{Unplaced: true}, Quantity: 28},
				},
				Damaged: []*inventoryv1.RestockDamagedUnits{{Quantity: 2, Reason: "crushed", Type: broken}},
			},
		},
	}))
	if err != nil {
		t.Fatalf("fulfil: %v", err)
	}

	var batches []inventory_service_models.StockBatch
	err = db.WithContext(context.Background()).
		Where("warehouse_id = ?", warehouse).
		Order("id ASC").
		Find(&batches).Error
	if err != nil {
		t.Fatalf("load batches: %v", err)
	}

	// One batch per RECEIVED line — both lines received something.
	if len(batches) != 2 {
		t.Fatalf("%d batches, want 2 (one per received line)", len(batches))
	}

	shirt, hat := batches[0], batches[1]

	// The line IS the batch, and the delivery is the request.
	if shirt.RestockRequestItemID != items[0].GetId() || shirt.DeliveryID != req.GetId() {
		t.Fatalf("shirt batch identity wrong: item=%d delivery=%d", shirt.RestockRequestItemID, shirt.DeliveryID)
	}

	// Frozen HPP: line total / received + freight/sellable. Freight 130.000 over 128 = 1.015/pc.
	//   shirt: 4.000.000/100 + 1.015 = 41.015 ; hat: 840.000/28 + 1.015 = 31.015
	if shirt.UnitCost == nil || *shirt.UnitCost != 41015 {
		t.Fatalf("shirt unit_cost = %v, want 41015", shirt.UnitCost)
	}
	if hat.UnitCost == nil || *hat.UnitCost != 31015 {
		t.Fatalf("hat unit_cost = %v, want 31015", hat.UnitCost)
	}

	// Arrived = sellable + damaged; damaged never entered stock.
	if shirt.ArrivedQty != 100 || shirt.DamagedQty != 0 {
		t.Fatalf("shirt arrived/damaged = %d/%d, want 100/0", shirt.ArrivedQty, shirt.DamagedQty)
	}
	if hat.ArrivedQty != 30 || hat.DamagedQty != 2 {
		t.Fatalf("hat arrived/damaged = %d/%d, want 30/2 (28 sellable + 2 broken)", hat.ArrivedQty, hat.DamagedQty)
	}

	// The shirt's units split across two shelves; Ready = Σ shelf_batch = 100.
	var shelves []inventory_service_models.StockShelfBatch
	err = db.WithContext(context.Background()).
		Where("batch_id = ?", shirt.ID).
		Find(&shelves).Error
	if err != nil {
		t.Fatalf("load shelf batches: %v", err)
	}
	if len(shelves) != 2 {
		t.Fatalf("%d shelf_batch rows for the shirt, want 2", len(shelves))
	}

	var ready int64
	placed := map[uint64]int64{}
	for _, s := range shelves {
		ready += s.Qty
		if s.RackID != nil {
			placed[*s.RackID] = s.Qty
		}
	}
	if ready != 100 {
		t.Fatalf("shirt Ready (Σ shelf_batch) = %d, want 100", ready)
	}
	if placed[rackAID] != 60 || placed[rackBID] != 40 {
		t.Fatalf("shirt split = A:%d B:%d, want 60/40", placed[rackAID], placed[rackBID])
	}

	// The hat sits on the unplaced pile — a shelf_batch with a nil rack.
	var hatShelves []inventory_service_models.StockShelfBatch
	err = db.WithContext(context.Background()).Where("batch_id = ?", hat.ID).Find(&hatShelves).Error
	if err != nil {
		t.Fatalf("load hat shelves: %v", err)
	}
	if len(hatShelves) != 1 || hatShelves[0].RackID != nil || hatShelves[0].Qty != 28 {
		t.Fatalf("hat shelf_batch = %+v, want one unplaced row of 28", hatShelves)
	}
}
