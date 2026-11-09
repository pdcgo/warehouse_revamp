package inventory_v1_test

import (
	"slices"
	"testing"

	"buf.build/go/protovalidate"
	"connectrpc.com/connect"
	"google.golang.org/protobuf/reflect/protoreflect"
	"google.golang.org/protobuf/reflect/protoregistry"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// takeTx takes qty of product under key and returns the take's inventory transaction — the id an order keeps and the
// pick page reads its racks by (the-placement-page-reads-racks-by-transaction-id).
func takeTx(t *testing.T, svc *inventory_v1.Service, warehouse, product uint64, qty int64, key string) uint64 {
	t.Helper()

	res, err := svc.OrderTransactionCreate(ctxUser(1), connect.NewRequest(&inventoryv1.OrderTransactionCreateRequest{
		TeamId: seedOwner, IdempotencyKey: key, WarehouseId: warehouse,
		Lines: []*inventoryv1.OrderTransactionLine{{ProductId: product, Quantity: qty}},
	}))
	if err != nil {
		t.Fatalf("take %d for %s: %v", qty, key, err)
	}

	if res.Msg.GetTransactionId() == 0 {
		t.Fatalf("take %s returned no transaction id", key)
	}

	return res.Msg.GetTransactionId()
}

func pickLocationsIn(t *testing.T, svc *inventory_v1.Service, warehouse, txID uint64) []*inventoryv1.StockPickLocation {
	t.Helper()

	res, err := svc.StockPickLocations(ctxUser(1), connect.NewRequest(&inventoryv1.StockPickLocationsRequest{
		WarehouseId: warehouse, TransactionId: txID,
	}))
	if err != nil {
		t.Fatalf("StockPickLocations(warehouse %d, tx %d): %v", warehouse, txID, err)
	}

	return res.Msg.GetLocations()
}

func pickLocations(t *testing.T, svc *inventory_v1.Service, txID uint64) []*inventoryv1.StockPickLocation {
	t.Helper()

	return pickLocationsIn(t, svc, warehouseA, txID)
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

	txID := takeTx(t, svc, warehouseA, productX, 10, "pick-key-42")

	got := pickLocations(t, svc, txID)
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

// #151 — the locations belong to ONE transaction. Another order's take from the same rack must not appear in this
// order's walk, or a picker collects twice what the order needs.
func TestStockPickLocations_AreScopedToTheirOwnTake(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	rack := insertRack(t, db, warehouseA, "A-01-1")
	seedLevel(t, db, warehouseA, productX, &rack, 50)

	first := takeTx(t, svc, warehouseA, productX, 2, "pick-key-1")
	second := takeTx(t, svc, warehouseA, productX, 7, "pick-key-2")

	if got := pickLocations(t, svc, first); len(got) != 1 || got[0].GetQuantity() != 2 {
		t.Fatalf("the first take's walk = %+v, want a single stop for 2", got)
	}

	if got := pickLocations(t, svc, second); len(got) != 1 || got[0].GetQuantity() != 7 {
		t.Fatalf("the second take's walk = %+v, want a single stop for 7", got)
	}

	// An unknown transaction is an empty walk, not an error — nothing was ever taken under it.
	if none := pickLocations(t, svc, second+1_000_000); len(none) != 0 {
		t.Fatalf("an unknown transaction reported %d stops, want none", len(none))
	}
}

// ONE BUILDING NEVER READS ANOTHER'S TAKE: `warehouse_id` is the scoped field, so a caller who names a transaction
// taken in another warehouse gets an empty walk — not that building's racks.
func TestStockPickLocations_AnotherWarehousesTakeIsEmpty(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	rack := insertRack(t, db, warehouseB, "C-01-1")
	seedLevel(t, db, warehouseB, productX, &rack, 20)

	theirs := takeTx(t, svc, warehouseB, productX, 4, "pick-key-b")

	if got := pickLocationsIn(t, svc, warehouseB, theirs); len(got) != 1 || got[0].GetQuantity() != 4 {
		t.Fatalf("warehouse B's own walk = %+v, want a single stop for 4", got)
	}

	if got := pickLocationsIn(t, svc, warehouseA, theirs); len(got) != 0 {
		t.Fatalf("warehouse A read %d stops of warehouse B's take: %+v", len(got), got)
	}
}

// #151/#70 — a RELEASED take leaves no walk. The goods went back on the rack, so sending a picker after them would be
// sending them after stock that is available to everybody else. The take's rows are still in the log beside their
// reversal (a-rollback-reverses-its-log-rows); the two NET to zero, so the walk is empty.
func TestStockPickLocations_AReleasedTakeHasNoWalk(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	rack := insertRack(t, db, warehouseA, "A-01-1")
	seedLevel(t, db, warehouseA, productX, &rack, 20)

	txID := takeTx(t, svc, warehouseA, productX, 5, "pick-key-7")

	if got := pickLocations(t, svc, txID); len(got) != 1 {
		t.Fatalf("before the release the walk had %d stops, want 1", len(got))
	}

	_, err := svc.OrderTransactionRelease(ctxUser(1), connect.NewRequest(&inventoryv1.OrderTransactionReleaseRequest{
		TeamId: seedOwner, IdempotencyKey: "pick-key-7",
	}))
	if err != nil {
		t.Fatalf("release: %v", err)
	}

	if got := pickLocations(t, svc, txID); len(got) != 0 {
		t.Fatalf("a released take still lists %d stops to walk to: %+v", len(got), got)
	}
}

// The transaction is REQUIRED: 0 names nothing, and the validation interceptor refuses it before the handler runs.
func TestStockPickLocations_ATransactionIsRequired(t *testing.T) {
	err := protovalidate.Validate(&inventoryv1.StockPickLocationsRequest{WarehouseId: warehouseA})
	if err == nil {
		t.Fatalf("a request with no transaction id passed validation")
	}

	err = protovalidate.Validate(&inventoryv1.StockPickLocationsRequest{WarehouseId: warehouseA, TransactionId: 9})
	if err != nil {
		t.Fatalf("a request with a transaction id was refused: %v", err)
	}
}

// The policy is unchanged by the switch to a transaction id: the warehouse crew walks to the shelf, and the
// WAREHOUSE is the scoped field — never the transaction.
func TestStockPickLocations_PolicyIsTheWarehouseCrew(t *testing.T) {
	desc, err := protoregistry.GlobalFiles.FindDescriptorByName(protoreflect.FullName("warehouse.inventory.v1.StockPickLocationsRequest"))
	if err != nil {
		t.Fatalf("descriptor: %v", err)
	}

	policy := san_auth.PolicyOf(desc.(protoreflect.MessageDescriptor))
	if policy == nil {
		t.Fatalf("StockPickLocationsRequest has no policy")
	}

	want := []role_basev1.Role{
		role_basev1.Role_ROLE_ROOT,
		role_basev1.Role_ROLE_ADMINISTRATOR,
		role_basev1.Role_ROLE_WAREHOUSE_OWNER,
		role_basev1.Role_ROLE_WAREHOUSE_ADMIN,
		role_basev1.Role_ROLE_WAREHOUSE_STAFF,
	}

	got := policy.GetRoles()
	if len(got) != len(want) {
		t.Fatalf("policy roles = %v, want %v", got, want)
	}

	for _, role := range want {
		if !slices.Contains(got, role) {
			t.Errorf("StockPickLocations is closed to %s", role)
		}
	}

	scope, ok := san_auth.ScopeOf(&inventoryv1.StockPickLocationsRequest{WarehouseId: 77, TransactionId: 9})
	if !ok || scope != 77 {
		t.Fatalf("scope = %d (ok %v), want the warehouse 77", scope, ok)
	}
}
