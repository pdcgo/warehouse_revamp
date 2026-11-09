package inventory_v1_test

import (
	"strings"
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// PLANNING A COUNT: the plan's shelf rows are snapshotted with their book, and the rows ARE the lock.

func createErr(f *opnameFixture, plan inventoryv1.OpnamePlan, team, product, placement uint64) error {
	_, err := f.svc.OpnameSessionCreate(opAdmin(opBudi), connect.NewRequest(&inventoryv1.OpnameSessionCreateRequest{
		TeamId: otWarehouse, Plan: plan, FilterTeamId: team, FilterProductId: product, FilterPlacementId: placement,
	}))

	return err
}

// An `all` count copies every shelf row with its book and the product's name, and from then on nothing moves those units.
func TestOpnameSessionCreate_SnapshotsTheShelfBookAndLocksIt(t *testing.T) {
	f := opnameStocked(t)
	s := f.create(t, inventoryv1.OpnamePlan_OPNAME_PLAN_ALL, 0, 0, 0)

	if s.GetStatus() != inventoryv1.OpnameSessionStatus_OPNAME_SESSION_STATUS_ACTIVE || s.GetRowCount() != 3 ||
		s.GetProductCount() != 2 || s.GetRackCount() != 3 || s.GetCreatedById() != opBudi {
		t.Fatalf("session %+v, want active, 3 rows of 2 products, every rack of the warehouse (3), planned by Budi", s)
	}

	r := f.row(t, s.GetId(), otKaosHitam, f.rakB)
	if r.GetSystemStockCount() != 5 || r.GetProductName() != "Kaos Hitam" || r.GetProductCode() != "KH-01" || r.GetTeamId() != otMelati {
		t.Fatalf("row %+v, want Melati's Kaos Hitam with a book of 5", r)
	}

	err := f.moveOne(otKaosHitam, f.rakA, f.rakB)
	if connect.CodeOf(err) != connect.CodeFailedPrecondition || !strings.Contains(err.Error(), "being counted") {
		t.Fatalf("a move under the count: err = %v, want FailedPrecondition naming the count", err)
	}
}

// A rack plan widens to every rack of each of its products (a-rack-plan-counts-its-products-everywhere): planning Rak B
// brings Kaos Hitam's Rak A in, and leaves Kaos Polos — not on Rak B — out. Rows at 0 are taken too.
func TestOpnameSessionCreate_ARackPlanCountsItsProductsEverywhere(t *testing.T) {
	f := opnameStocked(t)

	// Kaos Hitam's Rak A emptied into Rak C: the A row stays, at 0.
	_, err := f.svc.RackMove(opStaff(opAni), connect.NewRequest(&inventoryv1.RackMoveRequest{
		TeamId: otWarehouse, FromRackId: f.rakA, Lines: []*inventoryv1.RackMoveLine{{ProductId: otKaosHitam, Quantity: 5, ToRackId: f.rakC}},
	}))
	if err != nil {
		t.Fatalf("move: %v", err)
	}

	s := f.create(t, inventoryv1.OpnamePlan_OPNAME_PLAN_PLACEMENT, 0, 0, f.rakB)
	rows := f.rows(t, s.GetId())

	if len(rows) != 3 {
		t.Fatalf("%d rows, want Kaos Hitam on Rak A (0), B and C", len(rows))
	}

	if rows[[2]uint64{otKaosHitam, f.rakA}].GetSystemStockCount() != 0 {
		t.Fatalf("the emptied Rak A row is not in the count at 0")
	}

	if _, ok := rows[[2]uint64{otKaosPolos, f.rakA}]; ok {
		t.Fatalf("Kaos Polos is not on Rak B and must not be counted")
	}
}

// One active count per warehouse — the second is refused naming the first; a plan with the wrong target, or one that
// selects nothing, is refused too.
func TestOpnameSessionCreate_RefusesASecondCountAndABadPlan(t *testing.T) {
	f := opnameStocked(t)

	err := createErr(f, inventoryv1.OpnamePlan_OPNAME_PLAN_TEAM, 0, 0, 0)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("a team plan with no team: err = %v, want InvalidArgument", err)
	}

	err = createErr(f, inventoryv1.OpnamePlan_OPNAME_PLAN_ALL, otMelati, 0, 0)
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("an all plan with a target: err = %v, want InvalidArgument", err)
	}

	err = createErr(f, inventoryv1.OpnamePlan_OPNAME_PLAN_PLACEMENT, 0, 0, f.rakC)
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("an empty rack: err = %v, want FailedPrecondition — nothing to count", err)
	}

	first := f.create(t, inventoryv1.OpnamePlan_OPNAME_PLAN_TEAM, otSinar, 0, 0)

	err = createErr(f, inventoryv1.OpnamePlan_OPNAME_PLAN_PRODUCT, 0, otKaosHitam, 0)
	if connect.CodeOf(err) != connect.CodeFailedPrecondition || !strings.Contains(err.Error(), "#") {
		t.Fatalf("a second count: err = %v, want FailedPrecondition naming count #%d", err, first.GetId())
	}
}
