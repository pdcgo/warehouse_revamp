package inventory_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// WHAT A PIECE COST, FROZEN AT THE MOMENT IT LANDED (#209).
//
// StockCost's own tests cover the number a screen READS. These cover the number a batch KEEPS: the
// unit cost written onto `stock_batches.unit_cost` as the delivery is accepted. The two are computed
// by the same arithmetic and are not the same fact — a read recomputes from today's rows, a batch is a
// cost layer and must still say what THIS delivery cost after the next one arrives at a different
// price. Nothing else in the system can restate it once the layer is written, which is exactly why it
// gets tested where it is written rather than only where it is displayed.
//
// The arithmetic, in one place so every case below can be read against it:
//
//	unit cost = line total ÷ THAT LINE's sellable units   (the goods)
//	          + (freight + COD fee) ÷ ALL sellable units   (the shipping, spread by piece)
//
// Integer floor, both terms. A rupiah lost to division is never written back over the line total a
// person typed off the invoice (#140) — see TheRoundingNeverRewritesTheLineTotal.

const (
	hppSellingTeam uint64 = 2
	hppWarehouse   uint64 = 5
)

// batchCost reads back the frozen unit cost of the batch minted for one received line.
//
// nil is a REAL answer here and is reported as such: `unit_cost` is nullable and nil means UNKNOWN,
// never 0 (#74). A test that coerced it would turn "we do not know what this cost" into "it was free".
func batchCost(t *testing.T, db *gorm.DB, itemID uint64) *int64 {
	t.Helper()

	var batch inventory_service_models.StockBatch

	err := db.Where("restock_request_item_id = ?", itemID).Take(&batch).Error
	if err != nil {
		t.Fatalf("read batch for line %d: %v", itemID, err)
	}

	return batch.UnitCost
}

func wantCost(t *testing.T, db *gorm.DB, itemID uint64, want int64, why string) {
	t.Helper()

	got := batchCost(t, db, itemID)
	if got == nil {
		t.Fatalf("the batch for line %d froze NO unit cost — nil is 'unknown', and a layer that does "+
			"not know what it cost cannot be valued (%s)", itemID, why)
	}

	if *got != want {
		t.Fatalf("frozen HPP = %d, want %d — %s", *got, want, why)
	}
}

// The plain case, and the one that pins the shape of the formula: goods per piece plus this delivery's
// freight per piece, with the COD fee counted as freight because it is (#155).
func TestRestockAccept_FreezesTheHPPOfWhatArrived(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	created, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: hppSellingTeam, WarehouseId: hppWarehouse,
		ShipmentCost: 15000,
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: productX, Sku: "SKU1", Name: "Widget", Count: 10, Total: 500000},
		},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	req := created.Msg.GetRequest()

	_, err = svc.RestockRequestAccept(ctx, connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: hppWarehouse, RequestId: req.GetId(),
		WarehouseAdditionalCost: 25000, WarehouseAdditionalCostNote: courierNote,
		Lines: allArrived(t, db, req),
	}))
	if err != nil {
		t.Fatalf("accept: %v", err)
	}

	// goods 500.000 / 10 = 50.000 ; freight (15.000 + 25.000) / 10 = 4.000 ; HPP = 54.000.
	// Dropping the COD fee gives 51.500, which is the failure this case exists to catch.
	wantCost(t, db, req.GetItems()[0].GetId(), 54000,
		"goods 50.000 a piece plus 4.000 of freight, and the COD fee IS freight")
}

// FREIGHT IS SPREAD OVER WHAT CAN BE SOLD, not over what turned up. You paid to ship the crushed ones
// too, and that cost has to land somewhere: on the good units, so a damaged delivery honestly reads as
// more expensive per piece. Spread over all 10 instead, the freight paid on the broken pair is
// absorbed by nobody and the margin is quietly optimistic.
func TestRestockAccept_FrozenHPPSpreadsFreightOverSellableUnitsOnly(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	created, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: hppSellingTeam, WarehouseId: hppWarehouse,
		ShipmentCost: 16000,
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: productX, Sku: "SKU1", Name: "Widget", Count: 10, Total: 400000},
		},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	req := created.Msg.GetRequest()
	itemID := req.GetItems()[0].GetId()

	// 10 shipped, all 10 in the box, 2 crushed: 8 sellable, onto the staging placement (there-is-no-unplaced-pile).
	_, err = svc.RestockRequestAccept(ctx, connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: hppWarehouse, RequestId: req.GetId(),
		Lines: []*inventoryv1.RestockRequestReceivedLine{
			{
				ItemId: itemID, ReceivedCount: 10,
				BrokenCount: 2, BrokenNote: "crushed in transit",
				Placements: placedOn(stagingPlacement(t, db, hppWarehouse), 8),
			},
		},
	}))
	if err != nil {
		t.Fatalf("accept: %v", err)
	}

	// goods 400.000 / 8 = 50.000 ; freight 16.000 / 8 = 2.000 ; HPP = 52.000.
	// Over all 10 it would be 40.000 + 1.600 = 41.600 — a cheaper piece than the delivery bought.
	wantCost(t, db, itemID, 52000, "8 sellable units carry the freight of all 10")
}

// ONE SHIPMENT, SEVERAL LINES. Every piece carries the same freight whichever line it is on, while the
// goods stay on their own line — a delivery does not make a cheap product expensive by travelling with
// an expensive one.
func TestRestockAccept_FrozenHPPSplitsFreightAcrossLinesByPiece(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	created, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: hppSellingTeam, WarehouseId: hppWarehouse,
		ShipmentCost: 10000,
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: productX, Sku: "SKU1", Name: "Cheap", Count: 4, Total: 40000},
			{ProductId: productX + 1, Sku: "SKU2", Name: "Dear", Count: 6, Total: 600000},
		},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	req := created.Msg.GetRequest()

	_, err = svc.RestockRequestAccept(ctx, connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: hppWarehouse, RequestId: req.GetId(),
		WarehouseAdditionalCost: 10000, WarehouseAdditionalCostNote: courierNote,
		Lines: allArrived(t, db, req),
	}))
	if err != nil {
		t.Fatalf("accept: %v", err)
	}

	// freight (10.000 + 10.000) over the 10 pieces that arrived = 2.000 each, on BOTH lines.
	// cheap: 40.000 / 4 = 10.000 → 12.000 ; dear: 600.000 / 6 = 100.000 → 102.000.
	// Splitting the freight per LINE instead (10.000 each) would give 14.500 and 103.666.
	wantCost(t, db, req.GetItems()[0].GetId(), 12000, "the cheap line carries 2.000 a piece, not half the shipment")
	wantCost(t, db, req.GetItems()[1].GetId(), 102000, "the dear line carries the same 2.000 a piece")
}

// ⚠ THE ROUNDING IS A FLOOR AND IT NEVER TRAVELS BACK. 10.000 over 3 pieces is 3.333 a piece and one
// rupiah has nowhere to go; what must not happen is that rupiah being reconciled by rewriting the
// 10.000 somebody typed off the invoice (#140). The line total is what a human entered; the per-piece
// figure is openly derived.
func TestRestockAccept_TheRoundingNeverRewritesTheLineTotal(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	created, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: hppSellingTeam, WarehouseId: hppWarehouse,
		ShipmentCost: 1000,
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: productX, Sku: "SKU1", Name: "Widget", Count: 3, Total: 10000},
		},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	req := created.Msg.GetRequest()
	itemID := req.GetItems()[0].GetId()

	_, err = svc.RestockRequestAccept(ctx, connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: hppWarehouse, RequestId: req.GetId(),
		Lines: allArrived(t, db, req),
	}))
	if err != nil {
		t.Fatalf("accept: %v", err)
	}

	// goods 10.000 / 3 = 3.333 (floor) ; freight 1.000 / 3 = 333 (floor) ; HPP = 3.666.
	wantCost(t, db, itemID, 3666, "3.333 + 333, each floored on its own")

	var stored inventory_service_models.RestockRequestItem

	err = db.Where("id = ?", itemID).Take(&stored).Error
	if err != nil {
		t.Fatalf("read line: %v", err)
	}

	if stored.TotalPrice != 10000 {
		t.Fatalf("the line total is now %d — the invoice said 10000, and a per-piece rounding must "+
			"never be written back over it", stored.TotalPrice)
	}
}

// FROZEN MEANS FROZEN (#209). The next delivery of the same product at a different price mints its OWN
// layer; the first one still says what the first one cost. A recomputed-on-read cost would have the
// older stock silently revalued by whatever was bought most recently, and every margin already
// reported against it would change after the fact.
func TestRestockAccept_ALaterDeliveryDoesNotRewriteAnEarlierLayer(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := ctxUser(1)

	first := acceptOneLine(t, db, svc, ctx, 10, 500000, 0)
	second := acceptOneLine(t, db, svc, ctx, 10, 900000, 0)

	wantCost(t, db, first, 50000, "the first delivery cost 50.000 a piece and still does")
	wantCost(t, db, second, 90000, "the second is its own layer at its own price")
}

// acceptOneLine raises and accepts a single-line restock, everything arriving, and returns the
// received line's id — the key the batch it minted is found by.
func acceptOneLine(
	t *testing.T,
	db *gorm.DB,
	svc *inventory_v1.Service,
	ctx context.Context,
	qty, total, freight int64,
) uint64 {
	t.Helper()

	created, err := svc.RestockRequestCreate(ctx, connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: hppSellingTeam, WarehouseId: hppWarehouse,
		ShipmentCost: freight,
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: productX, Sku: "SKU1", Name: "Widget", Count: qty, Total: total},
		},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	req := created.Msg.GetRequest()

	_, err = svc.RestockRequestAccept(ctx, connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: hppWarehouse, RequestId: req.GetId(),
		Lines: allArrived(t, db, req),
	}))
	if err != nil {
		t.Fatalf("accept: %v", err)
	}

	return req.GetItems()[0].GetId()
}
