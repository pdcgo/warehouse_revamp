package inventory_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

func rackList(t *testing.T, f *opnameFixture, sessionID uint64, q string) *inventoryv1.OpnameRackListResponse {
	t.Helper()

	res, err := f.svc.OpnameRackList(opStaff(opAni), connect.NewRequest(&inventoryv1.OpnameRackListRequest{
		TeamId: otWarehouse, Filter: &inventoryv1.OpnameRackListFilter{SessionId: sessionID, Q: q}, Page: page1(),
	}))
	if err != nil {
		t.Fatalf("rack list: %v", err)
	}

	return res.Msg
}

// An `all` count visits every rack, the empty Rak C too (an-all-count-visits-every-rack); a product count visits only the
// racks of its rows. Each rack carries its progress.
func TestOpnameRackList_AnAllCountVisitsEveryRack(t *testing.T) {
	f := opnameStocked(t)
	all := f.create(t, inventoryv1.OpnamePlan_OPNAME_PLAN_ALL, 0, 0, 0)

	f.countRow(t, opAni, all.GetId(), otKaosPolos, f.rakA, 4, 0)

	res := rackList(t, f, all.GetId(), "")
	if ids := res.GetIds(); len(ids) != 3 || ids[0] != f.rakA || ids[2] != f.rakC {
		t.Fatalf("racks %v, want rak-a, rak-b, rak-c by code", ids)
	}

	racks := res.GetItems()[0].GetRack().GetMapData()
	if a, c := racks[f.rakA], racks[f.rakC]; a.GetRowCount() != 2 || a.GetCountedRowCount() != 1 || c.GetRowCount() != 0 {
		t.Fatalf("Rak A %+v, Rak C %+v — want 2 rows (1 counted), and Rak C empty but listed", a, c)
	}

	if ids := rackList(t, f, all.GetId(), "RAK-B").GetIds(); len(ids) != 1 || ids[0] != f.rakB {
		t.Fatalf("search rak-b: %v", ids)
	}

	_, err := f.svc.OpnameSessionCancel(opAdmin(opBudi), connect.NewRequest(&inventoryv1.OpnameSessionCancelRequest{
		TeamId: otWarehouse, SessionId: all.GetId(),
	}))
	if err != nil {
		t.Fatalf("cancel: %v", err)
	}

	polos := f.create(t, inventoryv1.OpnamePlan_OPNAME_PLAN_PRODUCT, 0, otKaosPolos, 0)
	if ids := rackList(t, f, polos.GetId(), "").GetIds(); len(ids) != 1 || ids[0] != f.rakA {
		t.Fatalf("a product count's racks %v, want only rak-a", ids)
	}
}
