package inventory_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// labelsFor is the read under test, sugar for the request.
func labelsFor(
	t *testing.T,
	svc *inventory_v1.Service,
	warehouse, requestID uint64,
) (*inventoryv1.RestockRequestLabelsResponse, error) {
	t.Helper()

	res, err := svc.RestockRequestLabels(ctxUser(1), connect.NewRequest(&inventoryv1.RestockRequestLabelsRequest{
		TeamId:    warehouse,
		RequestId: requestID,
	}))
	if err != nil {
		return nil, err
	}

	return res.Msg, nil
}

// An ACCEPTED delivery, split across shelves and with breakage, prints ONE label PER PLACEMENT — the
// broken units never enter stock so they never get a label, and a line on two shelves is two labels
// that share its batch id (#207).
func TestRestockLabels_OnePerPlacementDamageExcluded(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const sellingTeam, warehouse uint64 = 2, 5

	// Two shelves to split a line across.
	rackA, err := svc.RackCreate(ctx, connect.NewRequest(&inventoryv1.RackCreateRequest{TeamId: warehouse, Code: "A-01-3"}))
	if err != nil {
		t.Fatalf("rack A: %v", err)
	}
	rackB, err := svc.RackCreate(ctx, connect.NewRequest(&inventoryv1.RackCreateRequest{TeamId: warehouse, Code: "B-02-1"}))
	if err != nil {
		t.Fatalf("rack B: %v", err)
	}
	rackAID := rackA.Msg.GetRack().GetId()
	rackBID := rackB.Msg.GetRack().GetId()

	// there-is-no-unplaced-pile: what is not shelved yet goes to the staging placement, which has a code like any rack.
	staging := stagingPlacement(t, db, warehouse)

	// A two-line request: 100 shirts (freight-bearing), 30 hats.
	created, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: sellingTeam, WarehouseId: warehouse, ShipmentCost: 80000,
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: 100, Sku: "KPH-001", Name: "Kaos Polos Hitam", Count: 100, Total: 4000000},
			{ProductId: 200, Sku: "TTM-207", Name: "Topi Trucker Merah", Count: 30, Total: 840000},
		},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	req := created.Msg.GetRequest()
	items := req.GetItems()

	// Accept: shirts split 60/40 across two shelves; 30 hats in the box, 2 broken, the 28 good to the staging
	// placement.
	_, err = svc.RestockRequestAccept(ctx, connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: warehouse, RequestId: req.GetId(), WarehouseAdditionalCost: 50000, WarehouseAdditionalCostNote: courierNote,
		Lines: []*inventoryv1.RestockRequestReceivedLine{
			{
				ItemId:        items[0].GetId(),
				ReceivedCount: 100,
				Placements: []*inventoryv1.RestockPlacement{
					{PlacementId: rackAID, Quantity: 60},
					{PlacementId: rackBID, Quantity: 40},
				},
			},
			{
				ItemId:        items[1].GetId(),
				ReceivedCount: 30,
				BrokenCount:   2,
				BrokenNote:    "crushed brims",
				Placements:    placedOn(staging, 28),
			},
		},
	}))
	if err != nil {
		t.Fatalf("accept: %v", err)
	}

	msg, err := labelsFor(t, svc, warehouse, req.GetId())
	if err != nil {
		t.Fatalf("labels: %v", err)
	}

	// Three placements → three labels. The 2 broken hats are absent — they never entered stock.
	if len(msg.GetLabels()) != 3 {
		t.Fatalf("labels = %d, want 3 (one per placement, breakage excluded)", len(msg.GetLabels()))
	}

	if msg.GetRestockId() != req.GetId() {
		t.Fatalf("restock_id = %d, want %d", msg.GetRestockId(), req.GetId())
	}
	if msg.GetReceivedAtUnix() == 0 {
		t.Fatal("received_at_unix is 0 on an accepted request")
	}

	// The 2 broken hats got no label, and the screen is told so out loud.
	if msg.GetExcludedCount() != 2 {
		t.Fatalf("excluded_count = %d, want 2 (the broken hats)", msg.GetExcludedCount())
	}

	// The two shirt labels share the line's batch id and name their shelves; their quantities are the
	// per-shelf split, not the line total.
	byRack := map[string]*inventoryv1.RestockLabel{}
	for _, l := range msg.GetLabels() {
		byRack[l.GetPlacementCode()] = l
	}

	shirtA := byRack["A-01-3"]
	shirtB := byRack["B-02-1"]
	hats := byRack[stagingCode]
	if shirtA == nil || shirtB == nil || hats == nil {
		t.Fatalf("missing a label: %+v", byRack)
	}

	if shirtA.GetQuantity() != 60 || shirtB.GetQuantity() != 40 {
		t.Fatalf("shirt split = %d/%d, want 60/40", shirtA.GetQuantity(), shirtB.GetQuantity())
	}
	if shirtA.GetBatchId() != items[0].GetId() || shirtB.GetBatchId() != items[0].GetId() {
		t.Fatalf("two shelves of one line must share the batch id (%d): got %d/%d",
			items[0].GetId(), shirtA.GetBatchId(), shirtB.GetBatchId())
	}
	if shirtA.GetSku() != "KPH-001" {
		t.Fatalf("sku = %q, want KPH-001", shirtA.GetSku())
	}

	// The hats went to the staging placement — a label a picker can walk to, never a blank code
	// (there-is-no-unplaced-pile).
	if hats.GetPlacementCode() != stagingCode {
		t.Fatalf("hat label code = %q, want %q", hats.GetPlacementCode(), stagingCode)
	}
	if hats.GetQuantity() != 28 {
		t.Fatalf("hats placed = %d, want 28 (2 broken excluded)", hats.GetQuantity())
	}

	// HPP carries freight (shipping 80.000 + COD 50.000 = 130.000 over 128 sellable units = 1.015/pc):
	//   shirts: 4.000.000 / 100 + 1.015 = 41.015
	//   hats:   840.000 / 28  + 1.015 = 31.015
	if shirtA.GetHpp() != 41015 {
		t.Fatalf("shirt HPP = %d, want 41015 (line cost + freight share)", shirtA.GetHpp())
	}
	if hats.GetHpp() != 31015 {
		t.Fatalf("hat HPP = %d, want 31015", hats.GetHpp())
	}
}

// An ONGOING request has nothing shelved yet, so there is nothing to print — refused, not returned
// empty, so the screen can say the delivery has not been accepted.
func TestRestockLabels_OngoingIsRefused(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const sellingTeam, warehouse uint64 = 2, 5

	created, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: sellingTeam, WarehouseId: warehouse,
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: 100, Sku: "SKU1", Name: "Widget", Count: 10, Total: 5000},
		},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	_, err = labelsFor(t, svc, warehouse, created.Msg.GetRequest().GetId())
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("ongoing labels code = %v, want FailedPrecondition", connect.CodeOf(err))
	}
}

// The scope is the ACCEPTING warehouse: another warehouse asking for the labels reads NotFound, so the
// id cannot be used to probe another team's deliveries.
func TestRestockLabels_CrossWarehouseIsNotFound(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	const sellingTeam, warehouse, other uint64 = 2, 5, 9

	created, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: sellingTeam, WarehouseId: warehouse,
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: 100, Sku: "SKU1", Name: "Widget", Count: 10, Total: 5000},
		},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}
	req := created.Msg.GetRequest()

	_, err = svc.RestockRequestAccept(ctx, connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: warehouse, RequestId: req.GetId(), Lines: allArrived(t, db, req),
	}))
	if err != nil {
		t.Fatalf("accept: %v", err)
	}

	_, err = labelsFor(t, svc, other, req.GetId())
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("cross-warehouse labels code = %v, want NotFound", connect.CodeOf(err))
	}
}
