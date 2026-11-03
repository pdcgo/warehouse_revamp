package inventory_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

func addFound(f *opnameFixture, sessionID, rack, product uint64) (*inventoryv1.OpnameRowAddFoundResponse, error) {
	res, err := f.svc.OpnameRowAddFound(opStaff(opAni), connect.NewRequest(&inventoryv1.OpnameRowAddFoundRequest{
		TeamId: otWarehouse, SessionId: sessionID, PlacementId: rack, ProductId: product,
	}))
	if err != nil {
		return nil, err
	}

	return res.Msg, nil
}

// Kaos Polos found on Rak B in a count of Rak B: a row at 0 there, and its Rak A joins so the netting sees the move. The
// found row is locked like any other; adding it twice is AlreadyExists; a product its team never had here is refused —
// taken out and restocked by the team (a-unit-never-stocked-here-comes-in-by-restock).
func TestOpnameRowAddFound_JoinsWithItsOtherRacks(t *testing.T) {
	f := opnameStocked(t)
	s := f.create(t, inventoryv1.OpnamePlan_OPNAME_PLAN_PLACEMENT, 0, 0, f.rakB)

	res, err := addFound(f, s.GetId(), f.rakB, otKaosPolos)
	if err != nil {
		t.Fatalf("add found: %v", err)
	}

	rows := res.GetRows()
	if len(rows) != 2 || !rows[0].GetFoundHere() || rows[0].GetPlacementId() != f.rakB || rows[0].GetProductName() != "Kaos Polos" ||
		rows[1].GetPlacementId() != f.rakA || rows[1].GetFoundHere() {
		t.Fatalf("rows %+v, want the found row on Rak B, then Rak A joining", rows)
	}

	if rows[1].GetSystemStockCount() != 0 {
		t.Fatalf("a counter's answer carries Rak A's book %d before it is counted", rows[1].GetSystemStockCount())
	}

	if book := f.row(t, s.GetId(), otKaosPolos, f.rakA).GetSystemStockCount(); book != 4 {
		t.Fatalf("Rak A joins at a book of %d, want 4", book)
	}

	_, err = addFound(f, s.GetId(), f.rakB, otKaosPolos)
	if connect.CodeOf(err) != connect.CodeAlreadyExists {
		t.Fatalf("twice: err = %v, want AlreadyExists", err)
	}

	_, err = addFound(f, s.GetId(), f.rakB, opKaosUngu)
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("never stocked here: err = %v, want FailedPrecondition", err)
	}

	err = f.moveOne(otKaosPolos, f.rakA, f.rakC)
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("Kaos Polos on Rak A joined the count and must not move: err = %v", err)
	}

	// Counted: Rak A 3, Rak B 1 — a move, no money.
	f.countRow(t, opAni, s.GetId(), otKaosPolos, f.rakA, 3, 0)
	f.countRow(t, opAni, s.GetId(), otKaosPolos, f.rakB, 1, 0)
	f.countRest(t, opAni, s.GetId())

	done, err := f.finalize(opAdmin(opBudi), s.GetId())
	if err != nil {
		t.Fatalf("finalize: %v", err)
	}

	if got := txTypesOf(done); len(got) != 1 || got[0] != inventoryv1.OpnameTransactionType_OPNAME_TRANSACTION_TYPE_MOVE {
		t.Fatalf("transactions %v, want one move", got)
	}

	if a, b := rackCount(t, f.db, otKaosPolos, f.rakA), rackCount(t, f.db, otKaosPolos, f.rakB); a != 3 || b != 1 {
		t.Fatalf("Rak A %d, Rak B %d, want 3 and 1", a, b)
	}
}
