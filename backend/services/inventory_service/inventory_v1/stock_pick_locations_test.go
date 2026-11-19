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

// ── many takes at once: the bulk pick list (the-bulk-pick-list-prototype-is-accepted) ─────────────────────────────

// takeMany takes several lines under one key and returns the take's transaction.
func takeMany(t *testing.T, svc *inventory_v1.Service, warehouse uint64, key string, lines ...*inventoryv1.OrderTransactionLine) uint64 {
	t.Helper()

	res, err := svc.OrderTransactionCreate(ctxUser(1), connect.NewRequest(&inventoryv1.OrderTransactionCreateRequest{
		TeamId: seedOwner, IdempotencyKey: key, WarehouseId: warehouse, Lines: lines,
	}))
	if err != nil {
		t.Fatalf("take for %s: %v", key, err)
	}

	return res.Msg.GetTransactionId()
}

func pickLocationsOfMany(t *testing.T, svc *inventory_v1.Service, warehouse uint64, takes ...uint64) []*inventoryv1.StockPickLocation {
	t.Helper()

	res, err := svc.StockPickLocations(ctxUser(1), connect.NewRequest(&inventoryv1.StockPickLocationsRequest{
		WarehouseId: warehouse, TransactionIds: takes,
	}))
	if err != nil {
		t.Fatalf("StockPickLocations(warehouse %d, takes %v): %v", warehouse, takes, err)
	}

	return res.Msg.GetLocations()
}

// stop is one location as a comparable value.
type stop struct {
	take, product uint64
	code          string
	qty           int64
}

func stopsOf(locs []*inventoryv1.StockPickLocation) []stop {
	out := make([]stop, 0, len(locs))
	for _, l := range locs {
		out = append(out, stop{take: l.GetTransactionId(), product: l.GetProductId(), code: l.GetRackCode(), qty: l.GetQuantity()})
	}

	return out
}

// MANY TAKES IN ONE CALL, EACH STOP NAMED BY ITS TAKE: three orders' takes meeting on the same racks come back as each
// take's own stops — never summed across takes (the screen sums per product itself, and files each rack under its own
// order) — ordered take, then product, then rack, and each take's stops are exactly what its single read answers.
func TestStockPickLocations_ManyTakesNameEachStopByItsTake(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	productY := uint64(productX + 1)
	rackA := insertRack(t, db, warehouseA, "A-01-1")
	rackB := insertRack(t, db, warehouseA, "B-02-1")

	seedLevel(t, db, warehouseA, productX, &rackA, 2)
	seedLevel(t, db, warehouseA, productX, &rackB, 50)
	seedLevel(t, db, warehouseA, productY, &rackB, 50)

	first := takeMany(t, svc, warehouseA, "bulk-1", &inventoryv1.OrderTransactionLine{ProductId: productX, Quantity: 3})
	second := takeMany(t, svc, warehouseA, "bulk-2",
		&inventoryv1.OrderTransactionLine{ProductId: productY, Quantity: 2},
		&inventoryv1.OrderTransactionLine{ProductId: productX, Quantity: 1})
	third := takeMany(t, svc, warehouseA, "bulk-3", &inventoryv1.OrderTransactionLine{ProductId: productY, Quantity: 4})

	got := stopsOf(pickLocationsOfMany(t, svc, warehouseA, third, first, second))

	want := []stop{
		{first, productX, "a-01-1", 2},
		{first, productX, "b-02-1", 1},
		{second, productX, "b-02-1", 1},
		{second, productY, "b-02-1", 2},
		{third, productY, "b-02-1", 4},
	}
	if !slices.Equal(got, want) {
		t.Fatalf("the walk = %+v\nwant %+v", got, want)
	}

	// Each take's stops in the many-take answer are exactly its single read — the single call names its take too.
	for _, take := range []uint64{first, second, third} {
		single := stopsOf(pickLocations(t, svc, take))
		var inMany []stop

		for _, s := range got {
			if s.take == take {
				inMany = append(inMany, s)
			}
		}

		if !slices.Equal(single, inMany) {
			t.Fatalf("take %d: single read %+v, in the many-take read %+v", take, single, inMany)
		}
	}
}

// ONE BUILDING NEVER READS ANOTHER'S TAKES, many at once too: the asked takes of another warehouse add nothing, and a
// released take (netted to zero) and an unknown id drop out — the rest of the walk stands.
func TestStockPickLocations_ManyTakesReadOnlyThisWarehouse(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	rackA := insertRack(t, db, warehouseA, "A-01-1")
	rackB := insertRack(t, db, warehouseB, "C-01-1")
	seedLevel(t, db, warehouseA, productX, &rackA, 30)
	seedLevel(t, db, warehouseB, productX, &rackB, 30)

	mine := takeTx(t, svc, warehouseA, productX, 2, "bulk-mine")
	released := takeTx(t, svc, warehouseA, productX, 5, "bulk-released")
	theirs := takeTx(t, svc, warehouseB, productX, 4, "bulk-theirs")

	_, err := svc.OrderTransactionRelease(ctxUser(1), connect.NewRequest(&inventoryv1.OrderTransactionReleaseRequest{
		TeamId: seedOwner, IdempotencyKey: "bulk-released",
	}))
	if err != nil {
		t.Fatalf("release: %v", err)
	}

	asked := []uint64{theirs, mine, released, theirs + 1_000_000}

	if got := stopsOf(pickLocationsOfMany(t, svc, warehouseA, asked...)); !slices.Equal(got, []stop{{mine, productX, "a-01-1", 2}}) {
		t.Fatalf("warehouse A's walk = %+v, want only its own take %d", got, mine)
	}

	if got := stopsOf(pickLocationsOfMany(t, svc, warehouseB, asked...)); !slices.Equal(got, []stop{{theirs, productX, "c-01-1", 4}}) {
		t.Fatalf("warehouse B's walk = %+v, want only its own take %d", got, theirs)
	}
}

// ONE OR MANY, NEVER NEITHER OR BOTH, AND AT MOST 50: the single pick page names one take, the bulk list 1–50 (the
// warehouse list's largest page). 51 takes, a take named twice, a zero take, or both forms at once are refused before
// the handler runs.
func TestStockPickLocations_OneOrManyTakesAtMostFifty(t *testing.T) {
	takes := func(n int) []uint64 {
		out := make([]uint64, n)
		for i := range out {
			out[i] = uint64(i + 1)
		}

		return out
	}

	for name, ok := range map[string]*inventoryv1.StockPickLocationsRequest{
		"one take":  {WarehouseId: warehouseA, TransactionId: 9},
		"1 of many": {WarehouseId: warehouseA, TransactionIds: takes(1)},
		"50":        {WarehouseId: warehouseA, TransactionIds: takes(50)},
	} {
		err := protovalidate.Validate(ok)
		if err != nil {
			t.Fatalf("%s was refused: %v", name, err)
		}
	}

	for name, bad := range map[string]*inventoryv1.StockPickLocationsRequest{
		"neither":   {WarehouseId: warehouseA},
		"both":      {WarehouseId: warehouseA, TransactionId: 9, TransactionIds: []uint64{10}},
		"51":        {WarehouseId: warehouseA, TransactionIds: takes(51)},
		"twice":     {WarehouseId: warehouseA, TransactionIds: []uint64{7, 7}},
		"a zero id": {WarehouseId: warehouseA, TransactionIds: []uint64{7, 0}},
	} {
		err := protovalidate.Validate(bad)
		if err == nil {
			t.Fatalf("%s passed validation", name)
		}
	}
}
