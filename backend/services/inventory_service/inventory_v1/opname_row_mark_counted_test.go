package inventory_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

func markWith(f *opnameFixture, rowID uint64, broken int64, brokenNote, lostNote, surplusNote string) (*inventoryv1.OpnameRow, error) {
	res, err := f.svc.OpnameRowMarkCounted(opStaff(opAni), connect.NewRequest(&inventoryv1.OpnameRowMarkCountedRequest{
		TeamId: otWarehouse, RowId: rowID, BrokenCount: broken, BrokenNote: brokenNote, LostNote: lostNote, SurplusNote: surplusNote,
	}))
	if err != nil {
		return nil, err
	}

	return res.Msg.GetRow(), nil
}

// A short rack splits into broken (the counter's) and lost (the shortage less the broken, the system's); every draft
// needs its reason; and only a revealed row is closed.
func TestOpnameRowMarkCounted_DraftsWithTheirReasons(t *testing.T) {
	f := opnameStocked(t)
	s := f.create(t, inventoryv1.OpnamePlan_OPNAME_PLAN_PRODUCT, 0, otKaosHitam, 0)
	r := f.row(t, s.GetId(), otKaosHitam, f.rakA)

	_, err := markWith(f, r.GetId(), 0, "", "", "")
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("closing an uncounted row: err = %v, want FailedPrecondition", err)
	}

	_, err = f.count(opStaff(opAni), r.GetId(), 2)
	if err != nil {
		t.Fatalf("count: %v", err)
	}

	_, err = markWith(f, r.GetId(), 1, "torn", "", "")
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("a lost draft with no reason: err = %v, want InvalidArgument", err)
	}

	closed, err := markWith(f, r.GetId(), 1, "torn", "not found", "")
	if err != nil {
		t.Fatalf("mark counted: %v", err)
	}

	if closed.GetStatus() != inventoryv1.OpnameRowStatus_OPNAME_ROW_STATUS_COUNTED || len(closed.GetDrafts()) != 2 {
		t.Fatalf("row %+v, want counted with two drafts", closed)
	}

	broken, lost := closed.GetDrafts()[0], closed.GetDrafts()[1]
	if broken.GetType() != inventoryv1.OpnameDraftType_OPNAME_DRAFT_TYPE_BROKEN || broken.GetStockCount() != 1 || broken.GetNote() != "torn" ||
		lost.GetType() != inventoryv1.OpnameDraftType_OPNAME_DRAFT_TYPE_LOST || lost.GetStockCount() != 2 || lost.GetNote() != "not found" {
		t.Fatalf("drafts %+v, want broken 1 (torn) then lost 3 − 1 = 2 (not found)", closed.GetDrafts())
	}

	_, err = markWith(f, r.GetId(), 0, "", "x", "")
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("closing it twice: err = %v, want FailedPrecondition", err)
	}
}

// Broken has no cap (broken-posts-as-written-the-rest-nets): a torn unit in hand on a rack that is not short is still
// written, and the over rack's surplus draft needs its reason too.
func TestOpnameRowMarkCounted_BrokenHasNoCap(t *testing.T) {
	f := opnameStocked(t)
	s := f.create(t, inventoryv1.OpnamePlan_OPNAME_PLAN_PRODUCT, 0, otKaosHitam, 0)
	r := f.row(t, s.GetId(), otKaosHitam, f.rakB)

	_, err := f.count(opStaff(opAni), r.GetId(), 6)
	if err != nil {
		t.Fatalf("count: %v", err)
	}

	_, err = markWith(f, r.GetId(), 1, "torn", "", "")
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("a surplus with no reason: err = %v, want InvalidArgument", err)
	}

	closed, err := markWith(f, r.GetId(), 1, "torn", "", "behind the box")
	if err != nil {
		t.Fatalf("mark counted: %v", err)
	}

	if d := closed.GetDrafts(); len(d) != 2 || d[0].GetType() != inventoryv1.OpnameDraftType_OPNAME_DRAFT_TYPE_BROKEN ||
		d[1].GetType() != inventoryv1.OpnameDraftType_OPNAME_DRAFT_TYPE_SURPLUS || d[1].GetStockCount() != 1 {
		t.Fatalf("drafts %+v, want broken 1 and surplus 1", d)
	}
}
