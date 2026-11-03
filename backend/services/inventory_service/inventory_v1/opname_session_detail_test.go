package inventory_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// One count's header and progress; another warehouse's count reads as not found.
func TestOpnameSessionDetail_ProgressAndScope(t *testing.T) {
	f := opnameStocked(t)
	s := f.create(t, inventoryv1.OpnamePlan_OPNAME_PLAN_PRODUCT, 0, otKaosHitam, 0)

	f.countRow(t, opAni, s.GetId(), otKaosHitam, f.rakA, 5, 0)

	res, err := f.svc.OpnameSessionDetail(opAdmin(opBudi), connect.NewRequest(&inventoryv1.OpnameSessionDetailRequest{
		TeamId: otWarehouse, SessionId: s.GetId(),
	}))
	if err != nil {
		t.Fatalf("detail: %v", err)
	}

	got := res.Msg.GetSession()
	if got.GetRowCount() != 2 || got.GetCountedRowCount() != 1 || got.GetRackCount() != 2 || got.GetProductCount() != 1 ||
		got.GetPlan() != inventoryv1.OpnamePlan_OPNAME_PLAN_PRODUCT {
		t.Fatalf("detail %+v, want a product count of 2 rows on 2 racks, 1 counted", got)
	}

	_, err = f.svc.OpnameSessionDetail(ctxAs(opBudi, 999, 0), connect.NewRequest(&inventoryv1.OpnameSessionDetailRequest{
		TeamId: 999, SessionId: s.GetId(),
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("another warehouse: err = %v, want NotFound", err)
	}
}
