package inventory_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// A SHELF'S HISTORY READS THE OVERRIDE STAMP (an-override-shows-a-platform-badge): the rack page's By column carries the
// "by Root team" badge on the stock-in Root made from outside the warehouse, and not on the staff's.
func TestRackHistory_ReadsTheOverrideStamp(t *testing.T) {
	db := san_testdb.DB(t)
	svc := inventory_v1.NewService(db, nil, nil, nil, nil, otFacts(), nil, nil)
	rack := newRack(t, svc, otWarehouse, "rak-a")

	// Root raises the first and the warehouse's staff count it in; the seller raises the second and Root, from outside
	// the warehouse, counts it in — so one stock-in transaction is the staff's and the other an override.
	restockAs(t, svc, ctxAs(ovRoot, otMelati, rootOutsideRole), ctxAs(31, otWarehouse, staffRole), rack)
	restockAs(t, svc, ctxAs(8, otMelati, sellerRole), ctxAs(ovRoot, otWarehouse, rootOutsideRole), rack)

	res, err := svc.RackHistory(ctxUser(1), connect.NewRequest(&inventoryv1.RackHistoryRequest{
		TeamId: otWarehouse, Filter: &inventoryv1.RackHistoryFilter{RackId: rack}, Page: page1(),
	}))
	if err != nil {
		t.Fatalf("RackHistory: %v", err)
	}

	var (
		actors    []uint64
		overrides []bool
	)

	for _, m := range rackHistoryRows(res.Msg) {
		actors = append(actors, m.GetActorUserId())
		overrides = append(overrides, m.GetIsOverride())
	}

	wantOverrideByActor(t, "RackHistory", actors, overrides)
}
