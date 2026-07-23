package inventory_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// The Placement tab lists a product's shelves, each with its on-hand and the last time stock arrived
// there — the receive sets Last in; nothing has left, so Last out is empty (#209).
func TestPlacementList_PerShelfWithDates(t *testing.T) {
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

	acceptOne(t, svc, warehouse, rackAID, product, 100, 4000000)
	acceptOne(t, svc, warehouse, rackBID, product, 50, 2000000)

	res, err := svc.PlacementList(context.Background(), connect.NewRequest(&inventoryv1.PlacementListRequest{
		TeamId: warehouse, ProductId: product, Page: page1(),
	}))
	if err != nil {
		t.Fatalf("PlacementList: %v", err)
	}
	placements := res.Msg.GetPlacements()

	if len(placements) != 2 {
		t.Fatalf("%d placements, want 2 shelves", len(placements))
	}

	byRack := map[uint64]*inventoryv1.ProductPlacement{}
	for _, p := range placements {
		byRack[p.GetRackId()] = p
	}

	a := byRack[rackAID]
	b := byRack[rackBID]
	if a == nil || b == nil {
		t.Fatalf("missing a shelf: %+v", byRack)
	}
	if a.GetOnHand() != 100 || b.GetOnHand() != 50 {
		t.Fatalf("on-hand = A:%d B:%d, want 100/50", a.GetOnHand(), b.GetOnHand())
	}

	// The receive set Last in; nothing has left, so Last out and Last opname are absent.
	if a.GetLastInUnix() == 0 {
		t.Fatal("A has no Last in, but it was just received")
	}
	if a.GetLastOutUnix() != 0 || a.GetLastOpnameUnix() != 0 {
		t.Fatalf("A last_out/opname = %d/%d, want 0/0 (nothing left or was counted)", a.GetLastOutUnix(), a.GetLastOpnameUnix())
	}
}
