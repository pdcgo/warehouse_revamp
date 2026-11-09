package inventory_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// The blind count reveals the row with the system's lost draft for the shortage; the one recount REPLACES it and moves the
// draft — to a surplus here; a third count is refused, and so is a count of a counted row.
func TestOpnameRowCount_BlindThenOneRecount(t *testing.T) {
	f := opnameStocked(t)
	s := f.create(t, inventoryv1.OpnamePlan_OPNAME_PLAN_PRODUCT, 0, otKaosHitam, 0)
	r := f.row(t, s.GetId(), otKaosHitam, f.rakA)

	blind, err := f.count(opStaff(opAni), r.GetId(), 3)
	if err != nil {
		t.Fatalf("blind count: %v", err)
	}

	if !blind.GetRevealed() || blind.GetSystemStockCount() != 5 || blind.GetRecountedStockCount() != 3 || blind.GetRecounted() ||
		blind.GetCountedById() != opAni {
		t.Fatalf("after the blind count %+v, want revealed: book 5, counted 3 by Ani", blind)
	}

	if d := blind.GetDrafts(); len(d) != 1 || d[0].GetType() != inventoryv1.OpnameDraftType_OPNAME_DRAFT_TYPE_LOST || d[0].GetStockCount() != 2 {
		t.Fatalf("drafts %+v, want the system's lost 2", d)
	}

	recount, err := f.count(opStaff(opDodi), r.GetId(), 6)
	if err != nil {
		t.Fatalf("recount: %v", err)
	}

	if !recount.GetRecounted() || recount.GetRecountedStockCount() != 6 || recount.GetCountedById() != opDodi {
		t.Fatalf("after the recount %+v, want 6 standing, entered by Dodi", recount)
	}

	if d := recount.GetDrafts(); len(d) != 1 || d[0].GetType() != inventoryv1.OpnameDraftType_OPNAME_DRAFT_TYPE_SURPLUS || d[0].GetStockCount() != 1 {
		t.Fatalf("drafts %+v, want the lost gone and a surplus of 1", d)
	}

	_, err = f.count(opStaff(opAni), r.GetId(), 5)
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("a third count: err = %v, want FailedPrecondition", err)
	}

	other := f.row(t, s.GetId(), otKaosHitam, f.rakB)
	f.countRow(t, opAni, s.GetId(), otKaosHitam, f.rakB, 5, 0)

	_, err = f.count(opStaff(opAni), other.GetId(), 4)
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("counting a counted row: err = %v, want FailedPrecondition — the admin sends it back", err)
	}
}
