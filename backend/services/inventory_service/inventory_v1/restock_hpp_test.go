package inventory_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// WHAT A PIECE COST, FROZEN AT THE MOMENT IT LANDED (#209).
//
// StockCost's own tests cover the number a screen READS. These cover the number a batch KEEPS: its `price_unit`,
// written by the accept's ledger write (one-batch-per-line). A batch is a cost layer and must still say what THIS
// delivery cost after the next one arrives at a different price.
//
// The arithmetic (unit-price-is-line-price-plus-costs-per-unit, all-qty-is-every-unit-ordered):
//
//	unit price = line total ÷ THAT LINE's units ordered        (the goods)
//	           + (freight + courier's charge) ÷ EVERY unit ordered   (the shipping, spread by piece)
//
// Kept as float — a fraction of a rupiah is stored as is (stock-money-is-float64-compared-at-4-digits), and never
// written back over the line total a person typed off the invoice (#140).

const (
	hppSellingTeam uint64 = 2
	hppWarehouse   uint64 = 5
)

// batchCost reads back the price of the batch the accept minted for one restock line — found through the restock's
// transaction and the line's product (a-product-appears-once-per-restock).
func batchCost(t *testing.T, db *gorm.DB, itemID uint64) float64 {
	t.Helper()

	var prices []float64

	err := db.Raw(`
		SELECT b.price_unit FROM batches b
		JOIN restocks r ON r.transaction_id = b.transaction_id
		JOIN restock_items i ON i.restock_id = r.id AND i.product_id = b.product_id
		WHERE i.id = ?`, itemID).Scan(&prices).Error
	if err != nil || len(prices) != 1 {
		t.Fatalf("read the batch of line %d: %v (%d batches)", itemID, err, len(prices))
	}

	return prices[0]
}

func wantCost(t *testing.T, db *gorm.DB, itemID uint64, want float64, why string) {
	t.Helper()

	if got := batchCost(t, db, itemID); !san_money.Equal(got, want) {
		t.Fatalf("batch price = %v, want %v — %s", got, want, why)
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

// FREIGHT IS SPREAD OVER EVERY UNIT ORDERED (all-qty-is-every-unit-ordered), broken ones included: the crushed pair
// carries its own share on its problem row, priced at the same landed price (the-problem-price-is-filled-by-the-system).
func TestRestockAccept_FreightIsSpreadOverEveryUnitOrdered(t *testing.T) {
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

	// goods 400.000 / 10 = 40.000 ; freight 16.000 / 10 = 1.600 ; price 41.600 — the same for the 8 good and the 2 broken.
	wantCost(t, db, itemID, 41600, "every unit ordered carries the freight")
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

	// freight (10.000 + 10.000) over the 10 pieces ordered = 2.000 each, on BOTH lines.
	// cheap: 40.000 / 4 = 10.000 → 12.000 ; dear: 600.000 / 6 = 100.000 → 102.000.
	// Splitting the freight per LINE instead (10.000 each) would give 14.500 and 103.666.
	wantCost(t, db, req.GetItems()[0].GetId(), 12000, "the cheap line carries 2.000 a piece, not half the shipment")
	wantCost(t, db, req.GetItems()[1].GetId(), 102000, "the dear line carries the same 2.000 a piece")
}

// ⚠ NO ROUNDING, AND THE LINE TOTAL NEVER MOVES. 10.000 over 3 pieces is 3.333,33… a piece, stored as is; the 10.000
// somebody typed off the invoice is never rewritten to fit a per-piece figure (#140).
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

	// goods 10.000 / 3 + freight 1.000 / 3 = 11.000 / 3 = 3.666,67, as a fraction.
	wantCost(t, db, itemID, 11000.0/3, "the goods and the freight per piece, unrounded")

	var stored inventory_service_models.RestockItem

	err = db.Where("id = ?", itemID).Take(&stored).Error
	if err != nil {
		t.Fatalf("read line: %v", err)
	}

	if stored.Total != 10000 {
		t.Fatalf("the line total is now %v — the invoice said 10000, and a per-piece rounding must "+
			"never be written back over it", stored.Total)
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
		ShipmentCost: float64(freight),
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: productX, Sku: "SKU1", Name: "Widget", Count: qty, Total: float64(total)},
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
