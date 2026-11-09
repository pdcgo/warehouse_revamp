package inventory_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

func sessionList(t *testing.T, f *opnameFixture, staff bool, status inventoryv1.OpnameSessionStatus) *inventoryv1.OpnameSessionListResponse {
	t.Helper()

	ctx := opAdmin(opBudi)
	if staff {
		ctx = opStaff(opAni)
	}

	res, err := f.svc.OpnameSessionList(ctx, connect.NewRequest(&inventoryv1.OpnameSessionListRequest{
		TeamId: otWarehouse, Filter: &inventoryv1.OpnameSessionListFilter{Status: status}, Page: page1(),
	}))
	if err != nil {
		t.Fatalf("session list: %v", err)
	}

	return res.Msg
}

// Newest first, one status at a time; a counter's read of the active count carries no difference count — it would leak
// the book — while the admin's does.
func TestOpnameSessionList_NewestFirstAndBlindToACounter(t *testing.T) {
	f := opnameStocked(t)

	old := f.create(t, inventoryv1.OpnamePlan_OPNAME_PLAN_PRODUCT, 0, otKaosPolos, 0)

	_, err := f.svc.OpnameSessionCancel(opAdmin(opBudi), connect.NewRequest(&inventoryv1.OpnameSessionCancelRequest{
		TeamId: otWarehouse, SessionId: old.GetId(),
	}))
	if err != nil {
		t.Fatalf("cancel: %v", err)
	}

	active := f.create(t, inventoryv1.OpnamePlan_OPNAME_PLAN_PRODUCT, 0, otKaosHitam, 0)
	f.countRow(t, opAni, active.GetId(), otKaosHitam, f.rakA, 4, 0)

	all := sessionList(t, f, false, inventoryv1.OpnameSessionStatus_OPNAME_SESSION_STATUS_UNSPECIFIED)
	if ids := all.GetIds(); len(ids) != 2 || ids[0] != active.GetId() || ids[1] != old.GetId() {
		t.Fatalf("ids %v, want the active count then the cancelled one", ids)
	}

	if all.GetPageInfo().GetTotalItems() != 2 {
		t.Fatalf("total %d, want 2", all.GetPageInfo().GetTotalItems())
	}

	admin := all.GetItems()[0].GetSession().GetMapData()[active.GetId()]
	if admin.GetCountedRowCount() != 1 || admin.GetDifferenceRowCount() != 1 {
		t.Fatalf("admin's read %+v, want 1 counted, 1 differing", admin)
	}

	staff := sessionList(t, f, true, inventoryv1.OpnameSessionStatus_OPNAME_SESSION_STATUS_ACTIVE)
	if ids := staff.GetIds(); len(ids) != 1 || ids[0] != active.GetId() {
		t.Fatalf("active only: %v", ids)
	}

	if got := staff.GetItems()[0].GetSession().GetMapData()[active.GetId()].GetDifferenceRowCount(); got != 0 {
		t.Fatalf("a counter reads %d differing rows, want 0 — the figure leaks the book", got)
	}
}
