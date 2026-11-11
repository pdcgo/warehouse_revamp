package inventory_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// THE RESTOCK'S TIMELINE READS THE OVERRIDE STAMP (an-override-shows-a-platform-badge): Root raising it for a seller they
// are not in reads is_override on the create row; the warehouse staff's accept row beside it does not.
func TestRestockRequestDetail_ReadsTheOverrideStamp(t *testing.T) {
	db := san_testdb.DB(t)
	svc := inventory_v1.NewService(db, nil, nil, nil, nil, otFacts(), nil, nil)
	rack := newRack(t, svc, otWarehouse, "rak-a")

	id := restockAs(t, svc, ctxAs(ovRoot, otMelati, rootOutsideRole), ctxAs(31, otWarehouse, staffRole), rack)

	res, err := svc.RestockRequestDetail(ctxUser(8), connect.NewRequest(&inventoryv1.RestockRequestDetailRequest{
		TeamId: otMelati, RequestId: id,
	}))
	if err != nil {
		t.Fatalf("RestockRequestDetail: %v", err)
	}

	logs := res.Msg.GetRequest().GetLogs()
	if len(logs) != 2 {
		t.Fatalf("%d trail rows, want 2 (create, accept)", len(logs))
	}

	for _, l := range logs {
		want := l.GetActorUserId() == ovRoot
		if l.GetIsOverride() != want {
			t.Errorf("trail row %d by %d: is_override = %v, want %v", l.GetId(), l.GetActorUserId(), l.GetIsOverride(), want)
		}
	}
}
