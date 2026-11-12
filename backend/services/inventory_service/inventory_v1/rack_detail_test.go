package inventory_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// A WAREHOUSE READS A SHELF IN UNITS ONLY (docs/business/analytic/rpc_provide_decision.md —
// a-warehouse-sees-ready-value-but-a-shelf-only-units): at the placement level a caller acting with a warehouse role is
// given the units on the rack and when it was last counted, never what they cost. The money is UNSET, not 0 — a 0 would
// tell a person at the shelf that it is worth nothing.

// warehouseReaders are the three roles a warehouse team holds — each reads the shelf the same way.
var warehouseReaders = []role_basev1.Role{
	role_basev1.Role_ROLE_WAREHOUSE_OWNER,
	role_basev1.Role_ROLE_WAREHOUSE_ADMIN,
	role_basev1.Role_ROLE_WAREHOUSE_STAFF,
}

// valueReaders are the callers who keep the shelf's money: Root or the Administrator from outside the warehouse (in by
// the root-team bypass, so they hold no role there) and the admin team monitoring it.
func valueReaders() map[string]context.Context {
	return map[string]context.Context{
		"root from outside": asRole(1, role_basev1.Role_ROLE_UNSPECIFIED),
		"the admin monitor": san_auth.WithMonitor(asRole(1, role_basev1.Role_ROLE_UNSPECIFIED)),
	}
}

func TestRackDetail_AWarehouseReadsTheShelfInUnitsOnly(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	rackID, _, _ := aRackWithGoods(t, svc, db)

	for _, role := range warehouseReaders {
		res, err := svc.RackDetail(asRole(1, role), connect.NewRequest(&inventoryv1.RackDetailRequest{
			TeamId: rackWarehouse, RackId: rackID,
		}))
		if err != nil {
			t.Fatalf("%s: RackDetail: %v", role, err)
		}

		summary := res.Msg.GetSummary()

		// The units stay — they are what somebody at the shelf counts.
		if summary.GetTotalOnHand() != 14 {
			t.Fatalf("%s: total on hand = %d, want 14", role, summary.GetTotalOnHand())
		}

		if summary.TotalValue != nil {
			t.Fatalf("%s: total value = %v, want it unset for a warehouse", role, summary.GetTotalValue())
		}

		if summary.UnknownCostProducts != nil {
			t.Fatalf("%s: unknown-cost products = %d, want it unset for a warehouse", role, summary.GetUnknownCostProducts())
		}
	}
}

func TestRackDetail_RootAndTheMonitorKeepTheValue(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	rackID, _, _ := aRackWithGoods(t, svc, db)

	for who, ctx := range valueReaders() {
		res, err := svc.RackDetail(ctx, connect.NewRequest(&inventoryv1.RackDetailRequest{
			TeamId: rackWarehouse, RackId: rackID,
		}))
		if err != nil {
			t.Fatalf("%s: RackDetail: %v", who, err)
		}

		summary := res.Msg.GetSummary()

		// 10 × 50.000 + 4 × 1.000, and nothing of unknown cost — both SET, the 0 included.
		if summary.TotalValue == nil || summary.GetTotalValue() != 504000 {
			t.Fatalf("%s: total value = %v, want 504000 set", who, summary.TotalValue)
		}

		if summary.UnknownCostProducts == nil || summary.GetUnknownCostProducts() != 0 {
			t.Fatalf("%s: unknown-cost products = %v, want 0 set", who, summary.UnknownCostProducts)
		}
	}
}

// An empty shelf is worth Rp 0 to whoever is given its money — a SET 0 — and is still nothing at all to a warehouse.
func TestRackDetail_AnEmptyShelfIsAZeroOnlyForWhoReadsTheValue(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	rack, err := svc.RackCreate(ctxUser(1), connect.NewRequest(&inventoryv1.RackCreateRequest{
		TeamId: rackWarehouse, Code: "B-02-1",
	}))
	if err != nil {
		t.Fatalf("create rack: %v", err)
	}

	read := func(ctx context.Context) *inventoryv1.RackSummary {
		t.Helper()

		res, readErr := svc.RackDetail(ctx, connect.NewRequest(&inventoryv1.RackDetailRequest{
			TeamId: rackWarehouse, RackId: rack.Msg.GetRack().GetId(),
		}))
		if readErr != nil {
			t.Fatalf("RackDetail: %v", readErr)
		}

		return res.Msg.GetSummary()
	}

	root := read(asRole(1, role_basev1.Role_ROLE_UNSPECIFIED))
	if root.TotalValue == nil || root.GetTotalValue() != 0 {
		t.Fatalf("root's empty shelf value = %v, want a set 0", root.TotalValue)
	}

	staff := read(asRole(1, role_basev1.Role_ROLE_WAREHOUSE_STAFF))
	if staff.TotalValue != nil || staff.UnknownCostProducts != nil {
		t.Fatalf("staff's empty shelf = %+v, want no money at all", staff)
	}
}
