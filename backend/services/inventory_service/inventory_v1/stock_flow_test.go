package inventory_v1_test

import (
	"testing"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_ledgers"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

const (
	warehouseA = 100
	warehouseB = 200
	productX   = 300
)

// #135 — stock sits ON a rack, and a warehouse total is a SUM across a product's racks: one line per product.
func TestStockList_SumsAcrossRacksAsOneProduct(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	rackA := insertRack(t, db, warehouseA, "A-01-3")
	rackB := insertRack(t, db, warehouseA, "A-02-1")

	seedLevel(t, db, warehouseA, productX, &rackA, 40)
	seedLevel(t, db, warehouseA, productX, &rackB, 60)

	got, err := svc.StockList(ctxUser(1), connect.NewRequest(&inventoryv1.StockListRequest{
		WarehouseId: warehouseA, Page: page1(),
	}))
	if err != nil {
		t.Fatalf("StockList: %v", err)
	}

	// ONE line, not two. A product on two shelves is one product — "how much of X is here?" has never meant "on which
	// shelf". Two lines here would also make the page size count PLACES.
	rows := stockLevelRows(got.Msg)
	if len(rows) != 1 || rows[0].GetOnHand() != 100 {
		t.Fatalf("rows = %+v, want one line of 100 (40 + 60)", rows)
	}

	if total := got.Msg.GetPageInfo().GetTotalItems(); total != 1 {
		t.Fatalf("page total = %d, want 1 product", total)
	}
}

// The product's history is its rack rows, newest first, each with the rack's count after it.
func TestStockHistory_RunningBalancePerRack(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	rack := insertRack(t, db, warehouseA, "A-01-1")
	receiveOn(t, svc, ctx, warehouseA, productX, rack, 100)
	receiveOn(t, svc, ctx, warehouseA, productX, rack, 25)

	res, err := svc.StockHistory(ctx, connect.NewRequest(&inventoryv1.StockHistoryRequest{
		WarehouseId: warehouseA, Filter: &inventoryv1.StockHistoryFilter{ProductId: productX}, Page: page1(),
	}))
	if err != nil {
		t.Fatalf("StockHistory: %v", err)
	}

	movements := stockHistoryRows(res.Msg)
	if len(movements) != 2 {
		t.Fatalf("movements = %d, want 2", len(movements))
	}

	if m := movements[0]; m.GetDelta() != 25 || m.GetBalance() != 125 || m.GetRackId() != rack ||
		m.GetKind() != inventoryv1.MovementKind_MOVEMENT_KIND_RECEIVE {
		t.Errorf("latest = %+v, want +25 received, 125 on the rack", m)
	}

	if m := movements[1]; m.GetDelta() != 100 || m.GetBalance() != 100 {
		t.Errorf("first = (delta %d, balance %d), want (100, 100)", m.GetDelta(), m.GetBalance())
	}
}

// A recount corrects ONE rack to the counted figure: the shortfall leaves the rack and the owner's oldest batch, as a
// provisional `adjustment` (old-shelf-corrections-move-onto-the-ledgers-provisionally).
func TestStockAdjust_RecountCorrectsTheRackToTheCount(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	rack := receive(t, svc, ctx, warehouseA, productX, 100)

	res, err := svc.StockAdjust(ctx, connect.NewRequest(&inventoryv1.StockAdjustRequest{
		WarehouseId: warehouseA, ProductId: productX, OnHand: 90, Reason: "cycle count",
		Place: &inventoryv1.StockAdjustRequest_RackId{RackId: rack},
	}))
	if err != nil {
		t.Fatalf("StockAdjust: %v", err)
	}

	if got := res.Msg.GetLevel().GetOnHand(); got != 90 {
		t.Errorf("level on_hand = %d, want 90", got)
	}

	if m := res.Msg.GetMovement(); m.GetDelta() != -10 || m.GetBalance() != 90 || m.GetRackId() != rack {
		t.Errorf("movement = %+v, want -10 leaving 90 on the rack", m)
	}

	var tx models.InventoryTransaction
	db.First(&tx, res.Msg.GetMovement().GetId())

	if tx.TxType != models.TxAdjustment || tx.TeamID != seedOwner {
		t.Fatalf("transaction = %+v, want the owner's adjustment", tx)
	}

	err = inventory_ledgers.Verify(db, tx.ID)
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}

	if b, r := unitsAt(t, db, warehouseA, productX); b != 90 || r != 90 {
		t.Fatalf("ledgers hold %d / %d, want 90 in both", b, r)
	}
}

// #139 — a stock-take counts a SHELF. Correcting one rack leaves the product's OTHER racks exactly as they were.
func TestStockAdjust_CountsOneShelfAndLeavesTheOthers(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	rackA := insertRack(t, db, warehouseA, "A-01-3")
	rackB := insertRack(t, db, warehouseA, "A-02-1")

	seedLevel(t, db, warehouseA, productX, &rackA, 40)
	seedLevel(t, db, warehouseA, productX, &rackB, 60)

	res, err := svc.StockAdjust(ctxUser(1), connect.NewRequest(&inventoryv1.StockAdjustRequest{
		WarehouseId: warehouseA, ProductId: productX, OnHand: 37, Reason: "cycle count A-01-3",
		Place: &inventoryv1.StockAdjustRequest_RackId{RackId: rackA},
	}))
	if err != nil {
		t.Fatalf("StockAdjust: %v", err)
	}

	if m := res.Msg.GetMovement(); m.GetDelta() != -3 || m.GetBalance() != 37 || m.GetRackId() != rackA {
		t.Fatalf("movement = %+v, want -3 leaving 37 on rack %d", m, rackA)
	}

	// The level is the WAREHOUSE's total: 37 + 60.
	if total := res.Msg.GetLevel().GetOnHand(); total != 97 {
		t.Fatalf("warehouse total = %d, want 97", total)
	}

	if on := placeOnHand(t, db, warehouseA, productX, &rackB); on != 60 {
		t.Fatalf("counting one rack changed another: rack B = %d, want 60", on)
	}
}

// A surplus is minted as a batch at the owner's newest price here (adjustment Q1) and goes on the counted rack.
func TestStockAdjust_SurplusMintsAtTheNewestPrice(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	rack := insertRack(t, db, warehouseA, "A-01-3")
	stockOnLedger(t, db, warehouseA, seedOwner, productX, rack, 5, 1000)
	stockOnLedger(t, db, warehouseA, seedOwner, productX, rack, 5, 1200)

	res, err := svc.StockAdjust(ctxUser(1), connect.NewRequest(&inventoryv1.StockAdjustRequest{
		WarehouseId: warehouseA, ProductId: productX, OnHand: 12, Reason: "found two",
		Place: &inventoryv1.StockAdjustRequest_RackId{RackId: rack},
	}))
	if err != nil {
		t.Fatalf("StockAdjust: %v", err)
	}

	var minted models.Batch
	db.Where("transaction_id = ?", res.Msg.GetMovement().GetId()).First(&minted)

	if minted.StockCount != 2 || !san_money.Equal(minted.PriceUnit, 1200) || minted.TeamID != seedOwner {
		t.Fatalf("minted = %+v, want 2 at the newest 1200, the owner's", minted)
	}

	err = inventory_ledgers.Verify(db, res.Msg.GetMovement().GetId())
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}
}

// A correct count writes a 0 rack row, so the rack reads as counted (adjustment Q4) — and moves nothing.
func TestStockAdjust_AnExactCountIsStillACount(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	rack := insertRack(t, db, warehouseA, "A-01-3")
	seedLevel(t, db, warehouseA, productX, &rack, 8)

	res, err := svc.StockAdjust(ctxUser(1), connect.NewRequest(&inventoryv1.StockAdjustRequest{
		WarehouseId: warehouseA, ProductId: productX, OnHand: 8, Reason: "all there",
		Place: &inventoryv1.StockAdjustRequest_RackId{RackId: rack},
	}))
	if err != nil {
		t.Fatalf("StockAdjust: %v", err)
	}

	var rows int64
	db.Model(&models.ProductPlacementLog{}).
		Where("placement_id = ? AND change_type = ? AND stock_change = 0", rack, models.TxAdjustment).Count(&rows)

	if rows != 1 || res.Msg.GetMovement().GetDelta() != 0 {
		t.Fatalf("%d zero rows, delta %d — want one 0 row and no change", rows, res.Msg.GetMovement().GetDelta())
	}
}

// #139 — a stock-take that does not say WHERE it counted is refused, never interpreted; and the unplaced pile is no
// place, since every unit is on a rack (there-is-no-unplaced-pile).
func TestStockAdjust_RefusesNoPlaceAndTheUnplacedPile(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	receive(t, svc, ctx, warehouseA, productX, 100)

	_, err := svc.StockAdjust(ctx, connect.NewRequest(&inventoryv1.StockAdjustRequest{
		WarehouseId: warehouseA, ProductId: productX, OnHand: 5, Reason: "no idea where",
	}))
	wantCode(t, err, connect.CodeInvalidArgument, "a placeless stock-take")

	_, err = svc.StockAdjust(ctx, connect.NewRequest(&inventoryv1.StockAdjustRequest{
		WarehouseId: warehouseA, ProductId: productX, OnHand: 5, Reason: "the pile",
		Place: &inventoryv1.StockAdjustRequest_Unplaced{Unplaced: true},
	}))
	wantCode(t, err, connect.CodeInvalidArgument, "a stock-take of the unplaced pile")

	if on := onHand(t, svc, ctx, warehouseA, productX); on != 100 {
		t.Fatalf("a refused stock-take still wrote: on_hand = %d, want 100", on)
	}
}

// #139 — the rack must belong to the warehouse doing the counting. Another warehouse's rack reads as NotFound, never
// PermissionDenied — and a rack that exists nowhere reads the same.
func TestStockAdjust_CrossWarehouseRackIsNotFound(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	theirs := insertRack(t, db, warehouseB, "B-01-1")

	for _, rack := range []uint64{theirs, 999999} {
		_, err := svc.StockAdjust(ctx, connect.NewRequest(&inventoryv1.StockAdjustRequest{
			WarehouseId: warehouseA, ProductId: productX, OnHand: 5, Reason: "wrong building",
			Place: &inventoryv1.StockAdjustRequest_RackId{RackId: rack},
		}))
		wantCode(t, err, connect.CodeNotFound, "a rack that is not this warehouse's")
	}
}

// #158 — StockHistory narrows to ONE KIND server-side, so "when was this last counted" survives the count falling off
// page one.
func TestStockHistory_FiltersByKind(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	rack := receive(t, svc, ctx, warehouseA, productX, 10)

	_, err := svc.StockAdjust(ctx, connect.NewRequest(&inventoryv1.StockAdjustRequest{
		WarehouseId: warehouseA, ProductId: productX, OnHand: 9, Reason: "opname",
		Place: &inventoryv1.StockAdjustRequest_RackId{RackId: rack},
	}))
	if err != nil {
		t.Fatalf("adjust: %v", err)
	}

	history := func(kind inventoryv1.MovementKind) []*inventoryv1.StockMovement {
		t.Helper()

		res, hErr := svc.StockHistory(ctx, connect.NewRequest(&inventoryv1.StockHistoryRequest{
			WarehouseId: warehouseA,
			Filter:      &inventoryv1.StockHistoryFilter{ProductId: productX, Kind: kind},
			Page:        &commonv1.CommonPagination{Page: 1, Limit: 50},
		}))
		if hErr != nil {
			t.Fatalf("StockHistory(%v): %v", kind, hErr)
		}

		return stockHistoryRows(res.Msg)
	}

	// UNSPECIFIED means all of them — the filter must not become a requirement.
	if got := history(inventoryv1.MovementKind_MOVEMENT_KIND_UNSPECIFIED); len(got) != 2 {
		t.Fatalf("unfiltered history = %d movements, want 2", len(got))
	}

	adjusts := history(inventoryv1.MovementKind_MOVEMENT_KIND_ADJUST)
	if len(adjusts) != 1 || adjusts[0].GetReason() != "opname" {
		t.Fatalf("ADJUST history = %+v, want the one stock-take", adjusts)
	}

	// A kind that never happened is empty, not an error.
	if got := history(inventoryv1.MovementKind_MOVEMENT_KIND_MOVE); len(got) != 0 {
		t.Fatalf("MOVE history = %d movements, want none", len(got))
	}
}
