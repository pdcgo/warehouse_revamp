package inventory_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// onRack / atUnplaced build the two ends of a move. Both are real PLACES — "unplaced" is where stock
// sits before anyone shelves it, not an absence.
func onRack(id uint64) *inventoryv1.StockPlace {
	return &inventoryv1.StockPlace{Place: &inventoryv1.StockPlace_RackId{RackId: id}}
}

func atUnplaced() *inventoryv1.StockPlace {
	return &inventoryv1.StockPlace{Place: &inventoryv1.StockPlace_Unplaced{Unplaced: true}}
}

// placeOnHand reads ONE place's on-hand straight from the table. `IS NOT DISTINCT FROM`, never `=`:
// `rack_id = NULL` is never true in SQL, so `=` would silently report 0 for the unplaced pile (#135).
func placeOnHand(t *testing.T, db *gorm.DB, warehouse, product uint64, rack *uint64) int64 {
	t.Helper()

	var on int64

	err := db.Raw(`
		SELECT COALESCE(SUM(on_hand), 0) FROM stock_levels
		WHERE warehouse_id = ? AND product_id = ? AND rack_id IS NOT DISTINCT FROM ?`,
		warehouse, product, rack,
	).Scan(&on).Error
	if err != nil {
		t.Fatalf("read place: %v", err)
	}

	return on
}

// warehouseTotal is what StockList reports: the warehouse's total for a product, across its places.
func warehouseTotal(
	t *testing.T,
	svc interface {
		StockList(context.Context, *connect.Request[inventoryv1.StockListRequest]) (*connect.Response[inventoryv1.StockListResponse], error)
	},
	ctx context.Context,
	warehouse, product uint64,
) int64 {
	t.Helper()

	resp, err := svc.StockList(ctx, connect.NewRequest(&inventoryv1.StockListRequest{
		WarehouseId: warehouse, Page: page1(),
	}))
	if err != nil {
		t.Fatalf("StockList: %v", err)
	}

	for _, lvl := range resp.Msg.GetLevels() {
		if lvl.GetProductId() == product {
			return lvl.GetOnHand()
		}
	}

	return 0
}

// #136 — moving stock inside a warehouse changes WHERE it sits, never HOW MUCH there is. That
// invariant is the definition of a move, so it is asserted on the warehouse total directly.
func TestStockMove_ShelvesUnplacedStockWithoutChangingTheTotal(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	shelf := insertRack(t, db, warehouseA, "A-01-3")

	// A receive lands unplaced (#135) — exactly the pile this issue exists to shelve.
	receive(t, svc, ctx, warehouseA, productX, 100)

	before := warehouseTotal(t, svc, ctx, warehouseA, productX)

	res, err := svc.StockMove(ctx, connect.NewRequest(&inventoryv1.StockMoveRequest{
		WarehouseId: warehouseA, ProductId: productX, Quantity: 40, Reason: "put away",
		From: atUnplaced(), To: onRack(shelf),
	}))
	if err != nil {
		t.Fatalf("StockMove: %v", err)
	}

	// THE invariant: the warehouse holds exactly what it held.
	if after := warehouseTotal(t, svc, ctx, warehouseA, productX); after != before {
		t.Fatalf("a move changed the warehouse total: %d -> %d", before, after)
	}

	// Each leg names its own place and carries THAT place's new balance.
	if got := res.Msg.GetFromMovement(); got.GetDelta() != -40 || got.GetRackId() != 0 || got.GetBalance() != 60 {
		t.Fatalf("from leg = %+v, want -40 off the unplaced pile leaving 60", got)
	}
	if got := res.Msg.GetToMovement(); got.GetDelta() != 40 || got.GetRackId() != shelf || got.GetBalance() != 40 {
		t.Fatalf("to leg = %+v, want +40 onto rack %d leaving 40", got, shelf)
	}

	// And the places hold what the legs said.
	if on := placeOnHand(t, db, warehouseA, productX, &shelf); on != 40 {
		t.Fatalf("shelf holds %d, want 40", on)
	}
	if on := placeOnHand(t, db, warehouseA, productX, nil); on != 60 {
		t.Fatalf("unplaced pile holds %d, want 60", on)
	}
}

// #136 — the other job this issue names: re-organising, rack → rack.
func TestStockMove_BetweenTwoShelves(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	rackA := insertRack(t, db, warehouseA, "A-01-3")
	rackB := insertRack(t, db, warehouseA, "A-02-1")

	receive(t, svc, ctx, warehouseA, productX, 50)

	move := func(from, to *inventoryv1.StockPlace, qty int64) {
		t.Helper()

		_, err := svc.StockMove(ctx, connect.NewRequest(&inventoryv1.StockMoveRequest{
			WarehouseId: warehouseA, ProductId: productX, Quantity: qty, From: from, To: to,
		}))
		if err != nil {
			t.Fatalf("StockMove: %v", err)
		}
	}

	move(atUnplaced(), onRack(rackA), 50)
	move(onRack(rackA), onRack(rackB), 50)

	if on := placeOnHand(t, db, warehouseA, productX, &rackB); on != 50 {
		t.Fatalf("rack B holds %d, want all 50", on)
	}
	if on := placeOnHand(t, db, warehouseA, productX, &rackA); on != 0 {
		t.Fatalf("rack A holds %d, want 0 — the goods left it", on)
	}
	if total := warehouseTotal(t, svc, ctx, warehouseA, productX); total != 50 {
		t.Fatalf("warehouse total = %d, want 50 through two moves", total)
	}
}

// #136 — a move that takes more than the source holds is refused, and takes NOTHING. Both legs are one
// transaction: a half-applied move would destroy goods that are physically in the building.
func TestStockMove_OverMoveRefusedAndAtomic(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	shelf := insertRack(t, db, warehouseA, "A-01-3")

	receive(t, svc, ctx, warehouseA, productX, 10)

	_, err := svc.StockMove(ctx, connect.NewRequest(&inventoryv1.StockMoveRequest{
		WarehouseId: warehouseA, ProductId: productX, Quantity: 11,
		From: atUnplaced(), To: onRack(shelf),
	}))
	if code := connect.CodeOf(err); code != connect.CodeFailedPrecondition {
		t.Fatalf("over-move = %v, want FailedPrecondition", code)
	}

	// Nothing was credited to the destination, and the source is untouched.
	if on := placeOnHand(t, db, warehouseA, productX, &shelf); on != 0 {
		t.Fatalf("a refused move credited the destination: %d on the shelf", on)
	}
	if on := placeOnHand(t, db, warehouseA, productX, nil); on != 10 {
		t.Fatalf("a refused move touched the source: %d unplaced, want 10", on)
	}
}

// #136 — a move needs two DIFFERENT places. Moving stock onto the place it already sits is a mistake,
// and honouring it would write a ledger pair saying nothing happened, twice.
func TestStockMove_SamePlaceRefused(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	shelf := insertRack(t, db, warehouseA, "A-01-3")

	receive(t, svc, ctx, warehouseA, productX, 10)

	cases := map[string][2]*inventoryv1.StockPlace{
		"the same shelf":       {onRack(shelf), onRack(shelf)},
		"unplaced to unplaced": {atUnplaced(), atUnplaced()},
	}

	for name, places := range cases {
		_, err := svc.StockMove(ctx, connect.NewRequest(&inventoryv1.StockMoveRequest{
			WarehouseId: warehouseA, ProductId: productX, Quantity: 1,
			From: places[0], To: places[1],
		}))
		if code := connect.CodeOf(err); code != connect.CodeInvalidArgument {
			t.Fatalf("%s: code = %v, want InvalidArgument", name, code)
		}
	}
}

// #136 — both ends must be NAMED, and an unanswered one is refused rather than read as "unplaced".
// The two are indistinguishable by the time they reach the stock primitives (both nil), so without the
// handler's guard an unanswered end would silently become a real answer: goods moved to or from a pile
// nobody named. Proto validation rejects this at the API boundary, but unit tests bypass the
// interceptor — which is precisely why the handler re-checks (cf. StockAdjust, #139).
func TestStockMove_RefusesAnUnnamedPlace(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	shelf := insertRack(t, db, warehouseA, "A-01-3")

	receive(t, svc, ctx, warehouseA, productX, 10)

	cases := map[string][2]*inventoryv1.StockPlace{
		"no source":             {{}, onRack(shelf)},
		"no destination":        {atUnplaced(), {}},
		"neither end named":     {{}, {}},
		"a nil source message":  {nil, onRack(shelf)},
		"a nil destination msg": {atUnplaced(), nil},
	}

	for name, places := range cases {
		_, err := svc.StockMove(ctx, connect.NewRequest(&inventoryv1.StockMoveRequest{
			WarehouseId: warehouseA, ProductId: productX, Quantity: 1,
			From: places[0], To: places[1],
		}))
		if code := connect.CodeOf(err); code != connect.CodeInvalidArgument {
			t.Fatalf("%s: code = %v, want InvalidArgument", name, code)
		}
	}

	// And none of those refusals moved anything.
	if on := placeOnHand(t, db, warehouseA, productX, nil); on != 10 {
		t.Fatalf("a refused move touched the unplaced pile: %d, want 10", on)
	}
	if on := placeOnHand(t, db, warehouseA, productX, &shelf); on != 0 {
		t.Fatalf("a refused move credited the shelf: %d, want 0", on)
	}
}

// #136 — a rack at EITHER end must belong to this warehouse. Another warehouse's reads as NotFound,
// never PermissionDenied, or the error itself would confirm the id exists.
func TestStockMove_CrossWarehouseRackIsNotFound(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	mine := insertRack(t, db, warehouseA, "A-01-3")
	theirs := insertRack(t, db, warehouseB, "B-01-1")

	receive(t, svc, ctx, warehouseA, productX, 10)

	cases := map[string][2]*inventoryv1.StockPlace{
		"their rack as destination": {atUnplaced(), onRack(theirs)},
		"their rack as source":      {onRack(theirs), onRack(mine)},
	}

	for name, places := range cases {
		_, err := svc.StockMove(ctx, connect.NewRequest(&inventoryv1.StockMoveRequest{
			WarehouseId: warehouseA, ProductId: productX, Quantity: 1,
			From: places[0], To: places[1],
		}))
		if code := connect.CodeOf(err); code != connect.CodeNotFound {
			t.Fatalf("%s: code = %v, want NotFound", name, code)
		}
	}
}

// #136 — shelving is what finally empties the unplaced pile #135 left behind, which is also the escape
// hatch for #138's delete guard: a shelf must be emptied before it can be deleted.
func TestStockMove_EmptiesAShelfSoItCanBeDeleted(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	shelf := insertRack(t, db, warehouseA, "A-01-3")

	receive(t, svc, ctx, warehouseA, productX, 10)

	_, err := svc.StockMove(ctx, connect.NewRequest(&inventoryv1.StockMoveRequest{
		WarehouseId: warehouseA, ProductId: productX, Quantity: 10,
		From: atUnplaced(), To: onRack(shelf),
	}))
	if err != nil {
		t.Fatalf("shelve: %v", err)
	}

	// Occupied: the delete guard refuses (#138).
	_, err = svc.RackDelete(ctx, connect.NewRequest(&inventoryv1.RackDeleteRequest{
		TeamId: warehouseA, RackId: shelf,
	}))
	if code := connect.CodeOf(err); code != connect.CodeFailedPrecondition {
		t.Fatalf("deleting an occupied shelf = %v, want FailedPrecondition", code)
	}

	// Move the goods off, and the same delete now succeeds — the guard is a precondition, and this
	// RPC is how a person satisfies it.
	_, err = svc.StockMove(ctx, connect.NewRequest(&inventoryv1.StockMoveRequest{
		WarehouseId: warehouseA, ProductId: productX, Quantity: 10,
		From: onRack(shelf), To: atUnplaced(),
	}))
	if err != nil {
		t.Fatalf("unshelve: %v", err)
	}

	_, err = svc.RackDelete(ctx, connect.NewRequest(&inventoryv1.RackDeleteRequest{
		TeamId: warehouseA, RackId: shelf,
	}))
	if err != nil {
		t.Fatalf("an emptied shelf must delete: %v", err)
	}
}
