package inventory_v1_test

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// restockListOverrides is a page of RestockRequestList as `team`: each restock's created_by_is_override, by id.
func restockListOverrides(t *testing.T, svc *inventory_v1.Service, team uint64) map[uint64]bool {
	t.Helper()

	res, err := svc.RestockRequestList(ctxUser(1), connect.NewRequest(&inventoryv1.RestockRequestListRequest{
		TeamId: team, Page: page1(),
	}))
	if err != nil {
		t.Fatalf("list as team %d: %v", team, err)
	}

	out := map[uint64]bool{}

	for _, item := range res.Msg.GetItems() {
		for id, r := range item.GetRestockRequest().GetMapData() {
			out[id] = r.GetCreatedByIsOverride()
		}
	}

	return out
}

// WHO RAISED IT, AND WHETHER ROOT DID FROM OUTSIDE (an-override-shows-a-platform-badge): the list's created-by cell
// draws the "by Root team" badge from `created_by_is_override`, read from the trail's FIRST row — the create's. Root
// raising a restock for a seller it is not in reads true on both sides; the seller's own reads false, even when Root
// counted it in later (the accept's override is a later trail row, not the create's).
func TestRestockRequestList_CreatedByIsOverride(t *testing.T) {
	db := san_testdb.DB(t)
	svc := inventory_v1.NewService(db, nil, nil, nil, nil, otFacts(), nil, nil)
	rack := newRack(t, svc, otWarehouse, "rak-a")

	rootInSeller := ctxAs(ovRoot, otMelati, role_basev1.Role_ROLE_UNSPECIFIED)
	rootInWarehouse := ctxAs(ovRoot, otWarehouse, role_basev1.Role_ROLE_UNSPECIFIED)
	seller := ctxAs(8, otMelati, role_basev1.Role_ROLE_SELLING_ADMIN)
	staff := ctxAs(31, otWarehouse, role_basev1.Role_ROLE_WAREHOUSE_STAFF)

	byRoot := restockAs(t, svc, rootInSeller, staff, rack)
	bySeller := restockAs(t, svc, seller, rootInWarehouse, rack)

	// A member's restock still on its way: a trail of one row, the create.
	created, err := svc.RestockRequestCreate(seller, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: otMelati, WarehouseId: otWarehouse,
		Items: []*inventoryv1.RestockRequestItem{{ProductId: otKaosHitam, ProductCode: "KH-001", Name: "Kaos Hitam", Count: 1, Total: 10000}},
	}))
	if err != nil {
		t.Fatalf("restock create: %v", err)
	}

	ongoing := created.Msg.GetRequest().GetId()

	want := map[uint64]bool{byRoot: true, bySeller: false, ongoing: false}

	for _, side := range []struct {
		name string
		team uint64
	}{{"the seller", otMelati}, {"the warehouse", otWarehouse}} {
		got := restockListOverrides(t, svc, side.team)

		for id, w := range want {
			v, ok := got[id]
			if !ok {
				t.Fatalf("%s: restock %d not on the page %v", side.name, id, got)
			}

			if v != w {
				t.Errorf("%s: restock %d created_by_is_override = %v, want %v", side.name, id, v, w)
			}
		}
	}
}

// restockListSteps is a page of RestockRequestList as `team`: each restock's three by-line flags, by id.
func restockListSteps(t *testing.T, svc *inventory_v1.Service, team uint64) map[uint64]steps {
	t.Helper()

	res, err := svc.RestockRequestList(ctxUser(1), connect.NewRequest(&inventoryv1.RestockRequestListRequest{
		TeamId: team, Page: page1(),
	}))
	if err != nil {
		t.Fatalf("list as team %d: %v", team, err)
	}

	out := map[uint64]steps{}

	for _, item := range res.Msg.GetItems() {
		for id, r := range item.GetRestockRequest().GetMapData() {
			out[id] = steps{r.GetCreatedByIsOverride(), r.GetArrivedByIsOverride(), r.GetAcceptedByIsOverride()}
		}
	}

	return out
}

// steps is a restock's created / arrived / accepted override flags, in that order.
type steps struct{ created, arrived, accepted bool }

// EACH STEP'S BY-LINE SAYS WHETHER ROOT TOOK IT FROM OUTSIDE (an-override-shows-a-platform-badge): the selling list's
// *Accepted by* and the warehouse list's *Arrived by* draw the "by Root team" badge from `accepted_by_is_override` /
// `arrived_by_is_override`, each read from that step's own trail row — never from another act's. A box counted straight
// from ongoing was signed for by that count, so its arrive reads the accept's row; an edit (the status kept) is no step.
func TestRestockRequestList_EachStepSaysWhetherRootTookIt(t *testing.T) {
	db := san_testdb.DB(t)
	svc := inventory_v1.NewService(db, nil, nil, nil, nil, otFacts(), nil, nil)
	rack := newRack(t, svc, otWarehouse, "rak-a")

	rootInSeller := ctxAs(ovRoot, otMelati, role_basev1.Role_ROLE_UNSPECIFIED)
	rootInWarehouse := ctxAs(ovRoot, otWarehouse, role_basev1.Role_ROLE_UNSPECIFIED)
	seller := ctxAs(8, otMelati, role_basev1.Role_ROLE_SELLING_ADMIN)
	staff := ctxAs(31, otWarehouse, role_basev1.Role_ROLE_WAREHOUSE_STAFF)

	raise := func() *inventoryv1.RestockRequest {
		created, err := svc.RestockRequestCreate(seller, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
			TeamId: otMelati, WarehouseId: otWarehouse,
			Items: []*inventoryv1.RestockRequestItem{{ProductId: otKaosHitam, ProductCode: "KH-001", Name: "Kaos Hitam", Count: 2, Total: 20000}},
		}))
		if err != nil {
			t.Fatalf("restock create: %v", err)
		}

		return created.Msg.GetRequest()
	}

	arrive := func(ctx context.Context, id uint64) {
		_, err := svc.RestockRequestArrive(ctx, connect.NewRequest(&inventoryv1.RestockRequestArriveRequest{
			TeamId: otWarehouse, RequestId: id,
		}))
		if err != nil {
			t.Fatalf("restock %d arrive: %v", id, err)
		}
	}

	accept := func(ctx context.Context, r *inventoryv1.RestockRequest) {
		_, err := svc.RestockRequestAccept(ctx, connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
			TeamId: otWarehouse, RequestId: r.GetId(),
			Lines: []*inventoryv1.RestockRequestReceivedLine{{
				ItemId: r.GetItems()[0].GetId(), ReceivedCount: 2,
				Placements: []*inventoryv1.RestockPlacement{{PlacementId: rack, Quantity: 2}},
			}},
		}))
		if err != nil {
			t.Fatalf("restock %d accept: %v", r.GetId(), err)
		}
	}

	// Root raised it; the warehouse's own staff counted it in straight from ongoing — so signed for it too.
	byRoot := restockAs(t, svc, rootInSeller, staff, rack)

	// The seller raised it; Root counted it in straight from ongoing — the count is the signature.
	countedByRoot := restockAs(t, svc, seller, rootInWarehouse, rack)

	// Root signed for the box; the staff counted it.
	signedByRoot := raise()
	arrive(rootInWarehouse, signedByRoot.GetId())
	accept(staff, signedByRoot)

	// The staff signed for it, Root counted it.
	acceptedByRoot := raise()
	arrive(staff, acceptedByRoot.GetId())
	accept(rootInWarehouse, acceptedByRoot)

	// Signed for and counted by the staff — with a Root-stamped EDIT between: a trail row that keeps the status names
	// no step, so it leaves every by-line plain.
	editedByRoot := raise()
	arrive(staff, editedByRoot.GetId())

	err := db.Create(&inventory_service_models.RestockLog{
		RestockID: editedByRoot.GetId(), FromStatus: "arrived", ToStatus: "arrived",
		ActorUserID: ovRoot, IsOverride: true, Description: "edited", CreatedAt: time.Now(),
	}).Error
	if err != nil {
		t.Fatalf("edit row: %v", err)
	}

	accept(staff, editedByRoot)

	// On its way: only the create.
	ongoing := raise()

	want := map[uint64]steps{
		byRoot:                 {created: true},
		countedByRoot:          {arrived: true, accepted: true},
		signedByRoot.GetId():   {arrived: true},
		acceptedByRoot.GetId(): {accepted: true},
		editedByRoot.GetId():   {},
		ongoing.GetId():        {},
	}

	for _, side := range []struct {
		name string
		team uint64
	}{{"the seller", otMelati}, {"the warehouse", otWarehouse}} {
		got := restockListSteps(t, svc, side.team)

		for id, w := range want {
			v, ok := got[id]
			if !ok {
				t.Fatalf("%s: restock %d not on the page %v", side.name, id, got)
			}

			if v != w {
				t.Errorf("%s: restock %d (created, arrived, accepted) overrides = %+v, want %+v", side.name, id, v, w)
			}
		}
	}
}
