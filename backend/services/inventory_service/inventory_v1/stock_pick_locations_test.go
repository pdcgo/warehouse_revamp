package inventory_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

func pickLocations(t *testing.T, svc *inventory_v1.Service, ref string) []*inventoryv1.StockPickLocation {
	t.Helper()

	res, err := svc.StockPickLocations(ctxUser(1), connect.NewRequest(&inventoryv1.StockPickLocationsRequest{
		WarehouseId: warehouseA, Ref: ref,
	}))
	if err != nil {
		t.Fatalf("StockPickLocations(%q): %v", ref, err)
	}

	return res.Msg.GetLocations()
}

// #151 — THE question the pick screen exists to answer: a product drawn from THREE racks is reported as three racks
// with their own quantities. The take chose them, fewest first (an-order-takes-from-the-lowest-shelf-first); the walk
// reads them by label, and the quantity is POSITIVE — a picker is told "take 3", never "take -3".
func TestStockPickLocations_ReportsEveryRackTheGoodsCameFrom(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	rackB := insertRack(t, db, warehouseA, "B-02-1")
	rackA := insertRack(t, db, warehouseA, "A-01-3")
	rack0 := insertRack(t, db, warehouseA, "A-00-9")

	seedLevel(t, db, warehouseA, productX, &rack0, 3)
	seedLevel(t, db, warehouseA, productX, &rackA, 4)
	seedLevel(t, db, warehouseA, productX, &rackB, 100)

	takeForOrder(t, svc, seedOwner, warehouseA, productX, 10, "order:42")

	got := pickLocations(t, svc, "order:42")
	if len(got) != 3 {
		t.Fatalf("the goods came from 3 racks, the screen was told about %d: %+v", len(got), got)
	}

	want := []struct {
		code string
		qty  int64
	}{{"a-00-9", 3}, {"a-01-3", 4}, {"b-02-1", 3}}

	for i, w := range want {
		if got[i].GetRackCode() != w.code || got[i].GetQuantity() != w.qty {
			t.Fatalf("stop %d = %q qty %d, want %q qty %d", i, got[i].GetRackCode(), got[i].GetQuantity(), w.code, w.qty)
		}
	}
}

// #151 — the locations belong to ONE key. Another order's take from the same rack must not appear in this order's
// walk, or a picker collects twice what the order needs.
func TestStockPickLocations_AreScopedToTheirOwnTake(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	rack := insertRack(t, db, warehouseA, "A-01-1")
	seedLevel(t, db, warehouseA, productX, &rack, 50)

	takeForOrder(t, svc, seedOwner, warehouseA, productX, 2, "order:1")
	takeForOrder(t, svc, seedOwner, warehouseA, productX, 7, "order:2")

	if first := pickLocations(t, svc, "order:1"); len(first) != 1 || first[0].GetQuantity() != 2 {
		t.Fatalf("order:1's walk = %+v, want a single stop for 2", first)
	}

	if second := pickLocations(t, svc, "order:2"); len(second) != 1 || second[0].GetQuantity() != 7 {
		t.Fatalf("order:2's walk = %+v, want a single stop for 7", second)
	}

	// An unknown key is an empty walk, not an error — nothing was ever taken under it.
	if none := pickLocations(t, svc, "order:999"); len(none) != 0 {
		t.Fatalf("an untaken key reported %d stops, want none", len(none))
	}
}

// #151/#70 — a RELEASED take leaves no walk. The goods went back on the rack, so sending a picker after them would be
// sending them after stock that is available to everybody else. The take's rows are still in the log beside their
// reversal; what must not survive is the WALK.
func TestStockPickLocations_AReleasedTakeHasNoWalk(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	rack := insertRack(t, db, warehouseA, "A-01-1")
	seedLevel(t, db, warehouseA, productX, &rack, 20)

	takeForOrder(t, svc, seedOwner, warehouseA, productX, 5, "order:7")

	if got := pickLocations(t, svc, "order:7"); len(got) != 1 {
		t.Fatalf("before the release the walk had %d stops, want 1", len(got))
	}

	_, err := svc.OrderTransactionRelease(ctxUser(1), connect.NewRequest(&inventoryv1.OrderTransactionReleaseRequest{
		TeamId: seedOwner, IdempotencyKey: "order:7",
	}))
	if err != nil {
		t.Fatalf("release: %v", err)
	}

	if got := pickLocations(t, svc, "order:7"); len(got) != 0 {
		t.Fatalf("a released take still lists %d stops to walk to: %+v", len(got), got)
	}
}
