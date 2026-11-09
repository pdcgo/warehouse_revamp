package inventory_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// The counter's rack is BLIND (a-count-is-blind-then-revealed): no book figure on a row until it is counted — even when
// the admin asks — and a rack the count does not visit is not found.
func TestOpnameRackCount_BlindUntilCounted(t *testing.T) {
	f := opnameStocked(t)
	s := f.create(t, inventoryv1.OpnamePlan_OPNAME_PLAN_PRODUCT, 0, otKaosHitam, 0)

	rack := func() *inventoryv1.OpnameRackCountResponse {
		res, err := f.svc.OpnameRackCount(opAdmin(opBudi), connect.NewRequest(&inventoryv1.OpnameRackCountRequest{
			TeamId: otWarehouse, SessionId: s.GetId(), PlacementId: f.rakA,
		}))
		if err != nil {
			t.Fatalf("rack count: %v", err)
		}

		return res.Msg
	}

	before := rack()
	if len(before.GetRows()) != 1 || before.GetRows()[0].GetSystemStockCount() != 0 || before.GetRows()[0].GetRevealed() {
		t.Fatalf("rows %+v, want one, blind", before.GetRows())
	}

	if before.GetRack().GetCode() != "rak-a" || before.GetRack().GetRowCount() != 1 {
		t.Fatalf("rack %+v", before.GetRack())
	}

	_, err := f.count(opStaff(opAni), before.GetRows()[0].GetId(), 4)
	if err != nil {
		t.Fatalf("count: %v", err)
	}

	if after := rack().GetRows()[0]; after.GetSystemStockCount() != 5 || !after.GetRevealed() || after.GetRecountedStockCount() != 4 {
		t.Fatalf("after the count %+v, want revealed: book 5, counted 4", after)
	}

	_, err = f.svc.OpnameRackCount(opStaff(opAni), connect.NewRequest(&inventoryv1.OpnameRackCountRequest{
		TeamId: otWarehouse, SessionId: s.GetId(), PlacementId: f.rakC,
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("a rack the count does not visit: err = %v, want NotFound", err)
	}
}
