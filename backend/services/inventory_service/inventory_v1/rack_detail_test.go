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

// A WAREHOUSE READS A RACK'S VALUE (docs/acceptances/inventory/placement.md given 11 — `warehouse:all` opens a rack and
// reads each product with its units and value; the 🔄 2026-11-20 line of a-warehouse-sees-ready-value-but-a-shelf-only-units,
// docs/business/analytic/rpc_provide_decision.md, backlog #109): every reader of a shelf is given what it is worth — the
// warehouse's own three roles as Root, the Administrator and the admin team's monitor are. SET, a 0 included: an empty
// shelf is worth Rp 0.

// warehouseReaders are the three roles a warehouse team holds — each reads the shelf the same way.
var warehouseReaders = []role_basev1.Role{
	role_basev1.Role_ROLE_WAREHOUSE_OWNER,
	role_basev1.Role_ROLE_WAREHOUSE_ADMIN,
	role_basev1.Role_ROLE_WAREHOUSE_STAFF,
}

// shelfReaders are everybody who reads a rack: the warehouse's three roles, Root or the Administrator from outside the
// warehouse (in by the root-team bypass, so they hold no role there) and the admin team monitoring it.
func shelfReaders() map[string]context.Context {
	readers := map[string]context.Context{
		"root from outside": asRole(1, role_basev1.Role_ROLE_UNSPECIFIED),
		"the admin monitor": san_auth.WithMonitor(asRole(1, role_basev1.Role_ROLE_UNSPECIFIED)),
	}

	for _, role := range warehouseReaders {
		readers[role.String()] = asRole(1, role)
	}

	return readers
}

func TestRackDetail_EveryReaderIsGivenTheShelfsValue(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	rackID, _, _ := aRackWithGoods(t, svc, db)

	for who, ctx := range shelfReaders() {
		res, err := svc.RackDetail(ctx, connect.NewRequest(&inventoryv1.RackDetailRequest{
			TeamId: rackWarehouse, RackId: rackID,
		}))
		if err != nil {
			t.Fatalf("%s: RackDetail: %v", who, err)
		}

		summary := res.Msg.GetSummary()

		if summary.GetTotalOnHand() != 14 {
			t.Fatalf("%s: total on hand = %d, want 14", who, summary.GetTotalOnHand())
		}

		// 10 × 50.000 + 4 × 1.000, and nothing of unknown cost — both SET, the 0 included.
		if summary.TotalValue == nil || summary.GetTotalValue() != 504000 {
			t.Fatalf("%s: total value = %v, want 504000 set", who, summary.TotalValue)
		}

		if summary.UnknownCostProducts == nil || summary.GetUnknownCostProducts() != 0 {
			t.Fatalf("%s: unknown-cost products = %v, want 0 set", who, summary.UnknownCostProducts)
		}
	}
}

// An empty shelf is worth Rp 0 to every reader — a SET 0, the warehouse's staff's too.
func TestRackDetail_AnEmptyShelfIsAZeroForEveryReader(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	rack, err := svc.RackCreate(ctxUser(1), connect.NewRequest(&inventoryv1.RackCreateRequest{
		TeamId: rackWarehouse, Code: "B-02-1",
	}))
	if err != nil {
		t.Fatalf("create rack: %v", err)
	}

	for who, ctx := range shelfReaders() {
		res, readErr := svc.RackDetail(ctx, connect.NewRequest(&inventoryv1.RackDetailRequest{
			TeamId: rackWarehouse, RackId: rack.Msg.GetRack().GetId(),
		}))
		if readErr != nil {
			t.Fatalf("%s: RackDetail: %v", who, readErr)
		}

		summary := res.Msg.GetSummary()
		if summary.TotalValue == nil || summary.GetTotalValue() != 0 || summary.UnknownCostProducts == nil {
			t.Fatalf("%s: empty shelf = %+v, want a set value of 0 and a set unknown-cost count", who, summary)
		}
	}
}
