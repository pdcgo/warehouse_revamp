package inventory_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

const (
	warehouseA = 100
	warehouseB = 200
	productX   = 300
)

// #135 — stock is located ON a rack, and a warehouse total is a SUM across a product's places.
//
// Nothing places stock yet (that is #136/#137), so this seeds the rows directly: the point is to prove
// the READS are right the moment placed stock exists, rather than to discover it later through a
// warehouse total that quietly went wrong.
func TestStockList_SumsAcrossRacksAsOneProduct(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	rackA := insertRack(t, db, warehouseA, "A-01-3")
	rackB := insertRack(t, db, warehouseA, "A-02-1")

	// The same product in three places: two shelves and the unplaced pile.
	place := func(rackID *uint64, onHand int64) {
		t.Helper()

		err := db.Exec(`
			INSERT INTO stock_levels (warehouse_id, product_id, rack_id, on_hand, updated_at)
			VALUES (?, ?, ?, ?, NOW())`,
			warehouseA, productX, rackID, onHand,
		).Error
		if err != nil {
			t.Fatalf("seed place: %v", err)
		}
	}

	place(&rackA, 40)
	place(&rackB, 60)
	place(nil, 7) // arrived, not yet shelved

	got, err := svc.StockList(ctx, connect.NewRequest(&inventoryv1.StockListRequest{
		WarehouseId: warehouseA, Page: page1(),
	}))
	if err != nil {
		t.Fatalf("StockList: %v", err)
	}

	// ONE line, not three. A product on two shelves is one product — "how much of X is here?" has
	// never meant "on which shelf". Three lines here would also make the page size count PLACES.
	if len(got.Msg.GetLevels()) != 1 {
		t.Fatalf("a product across 3 places must read as ONE line, got %d: %+v",
			len(got.Msg.GetLevels()), got.Msg.GetLevels())
	}

	if on := got.Msg.GetLevels()[0].GetOnHand(); on != 107 {
		t.Fatalf("warehouse total = %d, want 107 (40 + 60 + 7 unplaced)", on)
	}

	// The paged total counts PRODUCTS, not places — else a warehouse spreading one product over more
	// shelves would silently shrink its own page.
	if total := got.Msg.GetPageInfo().GetTotalItems(); total != 1 {
		t.Fatalf("page total = %d, want 1 product", total)
	}
}

// #135 — one product may have only ONE unplaced pile. The unique index carries NULLS NOT DISTINCT
// precisely because Postgres would otherwise treat every NULL rack as a different place, and a
// warehouse would accumulate several "somewhere" rows for one product, double-counting it on read.
func TestStockLevels_OnlyOneUnplacedPilePerProduct(t *testing.T) {
	db := san_testdb.DB(t)

	insert := func() error {
		return db.Exec(`
			INSERT INTO stock_levels (warehouse_id, product_id, rack_id, on_hand, updated_at)
			VALUES (?, ?, NULL, 5, NOW())`,
			warehouseB, productX,
		).Error
	}

	err := insert()
	if err != nil {
		t.Fatalf("first unplaced row: %v", err)
	}

	err = insert()
	if err == nil {
		t.Fatal("a SECOND unplaced row for the same (warehouse, product) must be refused — " +
			"without NULLS NOT DISTINCT the same goods count twice")
	}
}

// Receiving lands stock UNPLACED (#135): a receive says what arrived, not which shelf it went on.
// "Unplaced" must be a real, findable state — it is the put-away queue (#136) — and not a null that
// reads as missing.
func TestStockReceive_LandsUnplaced(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	_, err := svc.StockReceive(ctx, connect.NewRequest(&inventoryv1.StockReceiveRequest{
		WarehouseId: warehouseB, ProductId: productX, Quantity: 12,
	}))
	if err != nil {
		t.Fatalf("StockReceive: %v", err)
	}

	var unplacedRows int64

	err = db.Raw(`
		SELECT COUNT(*) FROM stock_levels
		WHERE warehouse_id = ? AND product_id = ? AND rack_id IS NULL AND on_hand = 12`,
		warehouseB, productX,
	).Scan(&unplacedRows).Error
	if err != nil {
		t.Fatalf("count: %v", err)
	}

	if unplacedRows != 1 {
		t.Fatalf("a receive must land as exactly one UNPLACED row, got %d", unplacedRows)
	}

	// And the ledger row says the same — the movement happened "somewhere in this warehouse".
	var movementRacks int64

	err = db.Raw(`
		SELECT COUNT(*) FROM stock_movements
		WHERE warehouse_id = ? AND product_id = ? AND rack_id IS NOT NULL`,
		warehouseB, productX,
	).Scan(&movementRacks).Error
	if err != nil {
		t.Fatalf("count movements: %v", err)
	}

	if movementRacks != 0 {
		t.Fatalf("a receive must not invent a rack, got %d placed movements", movementRacks)
	}
}

// Receive raises on-hand, and StockList reads the derived snapshot back.
func TestStockReceive_ThenList(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	_, err := svc.StockReceive(ctx, connect.NewRequest(&inventoryv1.StockReceiveRequest{
		WarehouseId: warehouseA, ProductId: productX, Quantity: 100,
	}))
	if err != nil {
		t.Fatalf("StockReceive: %v", err)
	}

	_, err = svc.StockReceive(ctx, connect.NewRequest(&inventoryv1.StockReceiveRequest{
		WarehouseId: warehouseA, ProductId: productX, Quantity: 40,
	}))
	if err != nil {
		t.Fatalf("StockReceive 2: %v", err)
	}

	res, err := svc.StockList(ctx, connect.NewRequest(&inventoryv1.StockListRequest{
		WarehouseId: warehouseA, Page: page1(),
	}))
	if err != nil {
		t.Fatalf("StockList: %v", err)
	}

	if len(res.Msg.GetLevels()) != 1 {
		t.Fatalf("levels = %d, want 1", len(res.Msg.GetLevels()))
	}

	if got := res.Msg.GetLevels()[0].GetOnHand(); got != 140 {
		t.Errorf("on_hand = %d, want 140", got)
	}
}

// The ledger records every movement newest-first with a running balance.
func TestStockHistory_RunningBalance(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	receive(t, svc, ctx, warehouseA, productX, 100)
	receive(t, svc, ctx, warehouseA, productX, 25)

	res, err := svc.StockHistory(ctx, connect.NewRequest(&inventoryv1.StockHistoryRequest{
		WarehouseId: warehouseA, ProductId: productX, Page: page1(),
	}))
	if err != nil {
		t.Fatalf("StockHistory: %v", err)
	}

	movements := res.Msg.GetMovements()
	if len(movements) != 2 {
		t.Fatalf("movements = %d, want 2", len(movements))
	}

	// Newest first: the +25 with balance 125, then the +100 with balance 100.
	if movements[0].GetDelta() != 25 || movements[0].GetBalance() != 125 {
		t.Errorf("latest = (delta %d, balance %d), want (25, 125)", movements[0].GetDelta(), movements[0].GetBalance())
	}

	if movements[1].GetDelta() != 100 || movements[1].GetBalance() != 100 {
		t.Errorf("first = (delta %d, balance %d), want (100, 100)", movements[1].GetDelta(), movements[1].GetBalance())
	}
}

// Adjust corrects on-hand to a counted figure and records the difference. A receive lands unplaced
// (#135), so counting the unplaced pile is what corrects it — said explicitly (#139).
func TestStockAdjust_ToCountedFigure(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	receive(t, svc, ctx, warehouseA, productX, 100)

	res, err := svc.StockAdjust(ctx, connect.NewRequest(&inventoryv1.StockAdjustRequest{
		WarehouseId: warehouseA, ProductId: productX, OnHand: 90, Reason: "cycle count",
		Place: &inventoryv1.StockAdjustRequest_Unplaced{Unplaced: true},
	}))
	if err != nil {
		t.Fatalf("StockAdjust: %v", err)
	}

	if got := res.Msg.GetLevel().GetOnHand(); got != 90 {
		t.Errorf("level on_hand = %d, want 90", got)
	}

	// The correction is recorded as a −10 movement.
	if got := res.Msg.GetMovement().GetDelta(); got != -10 {
		t.Errorf("adjust delta = %d, want -10", got)
	}
}

// #139 — a stock-take counts a SHELF. Correcting one shelf must leave the product's OTHER shelves
// exactly as they were: the whole reason a warehouse-level adjust was rejected is that it would have
// had to spread a correction across shelves by a rule that invents a fact nobody observed.
func TestStockAdjust_CountsOneShelfAndLeavesTheOthers(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	rackA := insertRack(t, db, warehouseA, "A-01-3")
	rackB := insertRack(t, db, warehouseA, "A-02-1")

	place := func(rackID *uint64, onHand int64) {
		t.Helper()

		err := db.Exec(`
			INSERT INTO stock_levels (warehouse_id, product_id, rack_id, on_hand, updated_at)
			VALUES (?, ?, ?, ?, NOW())`,
			warehouseA, productX, rackID, onHand,
		).Error
		if err != nil {
			t.Fatalf("seed place: %v", err)
		}
	}

	place(&rackA, 40)
	place(&rackB, 60)
	place(nil, 7)

	// Someone stands at A-01-3 and counts 37 — four short of what the system believed.
	res, err := svc.StockAdjust(ctx, connect.NewRequest(&inventoryv1.StockAdjustRequest{
		WarehouseId: warehouseA, ProductId: productX, OnHand: 37, Reason: "cycle count A-01-3",
		Place: &inventoryv1.StockAdjustRequest_RackId{RackId: rackA},
	}))
	if err != nil {
		t.Fatalf("StockAdjust: %v", err)
	}

	// The movement is about the SHELF: -3, and that shelf now holds 37.
	if delta := res.Msg.GetMovement().GetDelta(); delta != -3 {
		t.Fatalf("adjust delta = %d, want -3 (40 believed, 37 counted)", delta)
	}
	if bal := res.Msg.GetMovement().GetBalance(); bal != 37 {
		t.Fatalf("movement balance = %d, want 37 — the SHELF's new figure", bal)
	}
	if got := res.Msg.GetMovement().GetRackId(); got != rackA {
		t.Fatalf("the ledger must say WHICH shelf was corrected: rack = %d, want %d", got, rackA)
	}

	// The Level is the WAREHOUSE's total, a different question: 37 + 60 + 7.
	if total := res.Msg.GetLevel().GetOnHand(); total != 104 {
		t.Fatalf("warehouse total = %d, want 104 (37 + 60 + 7)", total)
	}

	// And the shelves nobody counted are untouched.
	for rack, want := range map[uint64]int64{rackB: 60} {
		var on int64

		err = db.Raw(`SELECT on_hand FROM stock_levels WHERE warehouse_id = ? AND product_id = ? AND rack_id = ?`,
			warehouseA, productX, rack).Scan(&on).Error
		if err != nil {
			t.Fatalf("read rack %d: %v", rack, err)
		}

		if on != want {
			t.Fatalf("counting one shelf changed another: rack %d = %d, want %d", rack, on, want)
		}
	}

	var unplacedOn int64

	err = db.Raw(`SELECT on_hand FROM stock_levels WHERE warehouse_id = ? AND product_id = ? AND rack_id IS NULL`,
		warehouseA, productX).Scan(&unplacedOn).Error
	if err != nil {
		t.Fatalf("read unplaced: %v", err)
	}

	if unplacedOn != 7 {
		t.Fatalf("counting a shelf changed the unplaced pile: %d, want 7", unplacedOn)
	}
}

// #139 — a stock-take that does not say WHERE it counted is refused, never interpreted. Reading
// silence as "the unplaced pile" is how a stock-take corrects a pile nobody counted, and a stock-take
// is believed.
func TestStockAdjust_RefusesACountWithNoPlace(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	receive(t, svc, ctx, warehouseA, productX, 100)

	_, err := svc.StockAdjust(ctx, connect.NewRequest(&inventoryv1.StockAdjustRequest{
		WarehouseId: warehouseA, ProductId: productX, OnHand: 5, Reason: "no idea where",
	}))
	if code := connect.CodeOf(err); code != connect.CodeInvalidArgument {
		t.Fatalf("a placeless stock-take = %v, want InvalidArgument", code)
	}

	// And it corrected nothing.
	got, err := svc.StockList(ctx, connect.NewRequest(&inventoryv1.StockListRequest{
		WarehouseId: warehouseA, Page: page1(),
	}))
	if err != nil {
		t.Fatalf("StockList: %v", err)
	}
	if on := got.Msg.GetLevels()[0].GetOnHand(); on != 100 {
		t.Fatalf("a refused stock-take still wrote: on_hand = %d, want 100", on)
	}
}

// #139 — the shelf must belong to the warehouse doing the counting. Another warehouse's rack reads as
// NotFound, never PermissionDenied: a permission error would confirm the id exists.
func TestStockAdjust_CrossWarehouseRackIsNotFound(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	theirs := insertRack(t, db, warehouseB, "B-01-1")

	_, err := svc.StockAdjust(ctx, connect.NewRequest(&inventoryv1.StockAdjustRequest{
		WarehouseId: warehouseA, ProductId: productX, OnHand: 5, Reason: "wrong building",
		Place: &inventoryv1.StockAdjustRequest_RackId{RackId: theirs},
	}))
	if code := connect.CodeOf(err); code != connect.CodeNotFound {
		t.Fatalf("another warehouse's rack = %v, want NotFound", code)
	}

	// A rack that exists nowhere is the same NotFound — indistinguishable, on purpose.
	_, err = svc.StockAdjust(ctx, connect.NewRequest(&inventoryv1.StockAdjustRequest{
		WarehouseId: warehouseA, ProductId: productX, OnHand: 5, Reason: "nonexistent",
		Place: &inventoryv1.StockAdjustRequest_RackId{RackId: 999999},
	}))
	if code := connect.CodeOf(err); code != connect.CodeNotFound {
		t.Fatalf("unknown rack = %v, want NotFound", code)
	}
}

// Transfer moves stock between warehouses: source down, destination up, atomically.
func TestStockTransfer_MovesBetweenWarehouses(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	receive(t, svc, ctx, warehouseA, productX, 100)

	_, err := svc.StockTransfer(ctx, connect.NewRequest(&inventoryv1.StockTransferRequest{
		FromWarehouseId: warehouseA, ToWarehouseId: warehouseB, ProductId: productX, Quantity: 30,
	}))
	if err != nil {
		t.Fatalf("StockTransfer: %v", err)
	}

	if got := onHand(t, svc, ctx, warehouseA, productX); got != 70 {
		t.Errorf("source on_hand = %d, want 70", got)
	}

	if got := onHand(t, svc, ctx, warehouseB, productX); got != 30 {
		t.Errorf("dest on_hand = %d, want 30", got)
	}
}

// An over-draw is refused (FailedPrecondition) and nothing moves — the CHECK rolls back the tx.
func TestStockTransfer_OverdrawRefused(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	receive(t, svc, ctx, warehouseA, productX, 10)

	_, err := svc.StockTransfer(ctx, connect.NewRequest(&inventoryv1.StockTransferRequest{
		FromWarehouseId: warehouseA, ToWarehouseId: warehouseB, ProductId: productX, Quantity: 50,
	}))
	if err == nil {
		t.Fatal("StockTransfer over-draw = nil error, want FailedPrecondition")
	}

	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Errorf("code = %v, want FailedPrecondition", connect.CodeOf(err))
	}

	// Neither side moved: source still 10, dest still absent (0).
	if got := onHand(t, svc, ctx, warehouseA, productX); got != 10 {
		t.Errorf("source on_hand = %d, want 10 (unchanged)", got)
	}

	if got := onHand(t, svc, ctx, warehouseB, productX); got != 0 {
		t.Errorf("dest on_hand = %d, want 0 (no move)", got)
	}
}

func TestStockTransfer_SameWarehouseRejected(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	_, err := svc.StockTransfer(ctx, connect.NewRequest(&inventoryv1.StockTransferRequest{
		FromWarehouseId: warehouseA, ToWarehouseId: warehouseA, ProductId: productX, Quantity: 5,
	}))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Errorf("code = %v, want InvalidArgument", connect.CodeOf(err))
	}
}

// --- helpers ---

func receive(
	t *testing.T,
	svc *inventory_v1.Service,
	ctx context.Context,
	warehouseID, productID uint64,
	qty int64,
) {
	t.Helper()

	_, err := svc.StockReceive(ctx, connect.NewRequest(&inventoryv1.StockReceiveRequest{
		WarehouseId: warehouseID, ProductId: productID, Quantity: qty,
	}))
	if err != nil {
		t.Fatalf("receive %d: %v", qty, err)
	}
}

// onHand reads a product's on-hand at a warehouse via StockList (0 if there is no level row).
func onHand(
	t *testing.T,
	svc *inventory_v1.Service,
	ctx context.Context,
	warehouseID, productID uint64,
) int64 {
	t.Helper()

	res, err := svc.StockList(ctx, connect.NewRequest(&inventoryv1.StockListRequest{
		WarehouseId: warehouseID, Page: page1(),
	}))
	if err != nil {
		t.Fatalf("StockList: %v", err)
	}

	for _, level := range res.Msg.GetLevels() {
		if level.GetProductId() == productID {
			return level.GetOnHand()
		}
	}

	return 0
}

// #158 — StockHistory narrows to ONE KIND of movement, server-side.
//
// The ledger is paginated and grows forever, so a client-side filter would narrow the loaded page
// only: "when was this last counted" would read as "never" the moment the last stock-take fell off
// page one — exactly when the question is worth asking.
func TestStockHistory_FiltersByKind(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	// A receive, then a stock-take correction on top of it.
	_, err := svc.StockReceive(ctx, connect.NewRequest(&inventoryv1.StockReceiveRequest{
		WarehouseId: warehouseA, ProductId: productX, Quantity: 10, Reason: "seed",
	}))
	if err != nil {
		t.Fatalf("receive: %v", err)
	}

	_, err = svc.StockAdjust(ctx, connect.NewRequest(&inventoryv1.StockAdjustRequest{
		WarehouseId: warehouseA, ProductId: productX, OnHand: 9, Reason: "opname",
		Place: &inventoryv1.StockAdjustRequest_Unplaced{Unplaced: true},
	}))
	if err != nil {
		t.Fatalf("adjust: %v", err)
	}

	history := func(kind inventoryv1.MovementKind) []*inventoryv1.StockMovement {
		t.Helper()

		res, hErr := svc.StockHistory(ctx, connect.NewRequest(&inventoryv1.StockHistoryRequest{
			WarehouseId: warehouseA, ProductId: productX,
			Page: &commonv1.PageFilter{Page: 1, Limit: 50}, Kind: kind,
		}))
		if hErr != nil {
			t.Fatalf("StockHistory(%v): %v", kind, hErr)
		}

		return res.Msg.GetMovements()
	}

	// UNSPECIFIED means all of them — the filter must not become a requirement.
	if got := history(inventoryv1.MovementKind_MOVEMENT_KIND_UNSPECIFIED); len(got) != 2 {
		t.Fatalf("unfiltered history = %d movements, want 2", len(got))
	}

	adjusts := history(inventoryv1.MovementKind_MOVEMENT_KIND_ADJUST)
	if len(adjusts) != 1 {
		t.Fatalf("ADJUST history = %d movements, want 1", len(adjusts))
	}
	if adjusts[0].GetReason() != "opname" {
		t.Fatalf("ADJUST history returned %q, want the stock-take", adjusts[0].GetReason())
	}

	// A kind that never happened is empty, not an error.
	if got := history(inventoryv1.MovementKind_MOVEMENT_KIND_MOVE); len(got) != 0 {
		t.Fatalf("MOVE history = %d movements, want none", len(got))
	}
}
