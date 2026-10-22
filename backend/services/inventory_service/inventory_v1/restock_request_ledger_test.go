package inventory_v1_test

import (
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_ledgers"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// THE ACCEPT ON THE DECIDED LEDGERS (the-decided-ledgers-come-before-the-restock-accept): one `restock` transaction owned
// by the requesting team, one batch per line with good units at the landed price over every unit ORDERED, the good units
// on the racks named, one item per product — and the restock remembers its transaction.

const (
	ledgerSellingTeam uint64 = 2
	ledgerWarehouse   uint64 = 5
	ledgerKaosHitam   uint64 = 501
	ledgerKaosPolos   uint64 = 502
)

func ledgerRestock(t *testing.T, svc *inventory_v1.Service, shipment int64) *inventoryv1.RestockRequest {
	t.Helper()

	created, err := svc.RestockRequestCreate(ctxUser(1), connect.NewRequest(&inventoryv1.RestockRequestCreateRequest{
		TeamId: ledgerSellingTeam, WarehouseId: ledgerWarehouse,
		ShipmentCost: float64(shipment),
		Items: []*inventoryv1.RestockRequestItem{
			{ProductId: ledgerKaosHitam, Sku: "KH", Name: "Kaos Hitam", Count: 10, Total: 100000},
			{ProductId: ledgerKaosPolos, Sku: "KP", Name: "Kaos Polos", Count: 5, Total: 60000},
		},
	}))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	return created.Msg.GetRequest()
}

func itemFor(r *inventoryv1.RestockRequest, product uint64) *inventoryv1.RestockRequestItem {
	for _, item := range r.GetItems() {
		if item.GetProductId() == product {
			return item
		}
	}

	return nil
}

func restockTransactionID(t *testing.T, db *gorm.DB, restockID uint64) uint64 {
	t.Helper()

	var id uint64

	err := db.Raw(`SELECT transaction_id FROM restocks WHERE id = ?`, restockID).Scan(&id).Error
	if err != nil {
		t.Fatalf("restock %d: %v", restockID, err)
	}

	return id
}

// Kaos Hitam: 10 ordered, 10 in the box, 1 broken → 9 good on Rak A. Kaos Polos: 5 ordered, 4 in the box → 4 good on
// Rak B, 1 missing. Freight Rp 3.000 over the 15 units ORDERED is Rp 200 a unit (all-qty-is-every-unit-ordered), so
// Kaos Hitam lands at 10.000 + 200 and Kaos Polos at 12.000 + 200 (unit-price-is-line-price-plus-costs-per-unit).
func TestRestockAccept_WritesTheLedgers(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	rakA := newRack(t, svc, ledgerWarehouse, "rak-a")
	rakB := newRack(t, svc, ledgerWarehouse, "rak-b")

	r := ledgerRestock(t, svc, 3000)
	hitam := itemFor(r, ledgerKaosHitam)
	polos := itemFor(r, ledgerKaosPolos)

	_, err := svc.RestockRequestAccept(ctxUser(7), connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: ledgerWarehouse, RequestId: r.GetId(),
		Lines: []*inventoryv1.RestockRequestReceivedLine{
			{ItemId: hitam.GetId(), ReceivedCount: 10, BrokenCount: 1, Placements: placedOn(rakA, 9)},
			{ItemId: polos.GetId(), ReceivedCount: 4, Placements: placedOn(rakB, 4)},
		},
	}))
	if err != nil {
		t.Fatalf("accept: %v", err)
	}

	txID := restockTransactionID(t, db, r.GetId())
	if txID == 0 {
		t.Fatal("the accepted restock names no transaction")
	}

	var tx models.InventoryTransaction
	db.First(&tx, txID)

	if tx.TxType != models.TxRestock || tx.TeamID != ledgerSellingTeam || tx.WarehouseID != ledgerWarehouse || tx.CreateByUserID != 7 {
		t.Fatalf("transaction = %+v, want a restock of team %d in warehouse %d by user 7", tx, ledgerSellingTeam, ledgerWarehouse)
	}

	var batches []models.Batch
	db.Where("transaction_id = ?", txID).Order("product_id").Find(&batches)

	if len(batches) != 2 {
		t.Fatalf("minted %d batches, want one per line with good units: 2", len(batches))
	}

	if b := batches[0]; b.ProductID != ledgerKaosHitam || b.StockCount != 9 || !san_money.Equal(b.PriceUnit, 10200) || b.TeamID != ledgerSellingTeam {
		t.Fatalf("Kaos Hitam batch = %+v, want 9 units at 10200, owned by team %d", b, ledgerSellingTeam)
	}

	if b := batches[1]; b.ProductID != ledgerKaosPolos || b.StockCount != 4 || !san_money.Equal(b.PriceUnit, 12200) {
		t.Fatalf("Kaos Polos batch = %+v, want 4 units at 12200", b)
	}

	var racks []models.ProductPlacement
	db.Where("warehouse_id = ? AND product_id IN ?", ledgerWarehouse, []uint64{ledgerKaosHitam, ledgerKaosPolos}).
		Order("product_id").Find(&racks)

	if len(racks) != 2 || racks[0].PlacementID != rakA || racks[0].StockCount != 9 || racks[1].PlacementID != rakB || racks[1].StockCount != 4 {
		t.Fatalf("rack rows = %+v, want Kaos Hitam 9 on Rak A, Kaos Polos 4 on Rak B", racks)
	}

	var items []models.InventoryTransactionItem
	db.Where("transaction_id = ?", txID).Order("product_id").Find(&items)

	if len(items) != 2 || items[0].Quantity != 9 || !san_money.Equal(items[0].Total, 91800) || !items[0].IsOwned {
		t.Fatalf("items = %+v, want Kaos Hitam 9 worth 91800, owned", items)
	}

	err = inventory_ledgers.Verify(db, txID)
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}
}

// Everything in the box broken: no good unit, so no batch and no rack row — but the act happened, so the transaction
// exists (a-transaction-is-made-when-the-act-happens).
func TestRestockAccept_ALineWithNothingGoodMintsNoBatch(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	r := ledgerRestock(t, svc, 0)

	lines := make([]*inventoryv1.RestockRequestReceivedLine, 0, 2)
	for _, item := range r.GetItems() {
		lines = append(lines, &inventoryv1.RestockRequestReceivedLine{
			ItemId: item.GetId(), ReceivedCount: item.GetCount(), BrokenCount: item.GetCount(),
		})
	}

	_, err := svc.RestockRequestAccept(ctxUser(7), connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: ledgerWarehouse, RequestId: r.GetId(), Lines: lines,
	}))
	if err != nil {
		t.Fatalf("accept: %v", err)
	}

	txID := restockTransactionID(t, db, r.GetId())
	if txID == 0 {
		t.Fatal("an all-broken restock still happened, and names no transaction")
	}

	var batches int64
	db.Model(&models.Batch{}).Where("transaction_id = ?", txID).Count(&batches)
	if batches != 0 {
		t.Fatalf("minted %d batches from an all-broken box, want 0", batches)
	}
}

// A refused accept writes nothing into the ledgers.
func TestRestockAccept_ARefusedAcceptWritesNoTransaction(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	rakA := newRack(t, svc, ledgerWarehouse, "rak-a")
	r := ledgerRestock(t, svc, 0)

	var before int64
	db.Model(&models.InventoryTransaction{}).Count(&before)

	lines := make([]*inventoryv1.RestockRequestReceivedLine, 0, 2)
	for _, item := range r.GetItems() {
		// One more in the box than the line says: refused (accept-refuses-more-than-the-line-says).
		over := item.GetCount() + 1
		lines = append(lines, &inventoryv1.RestockRequestReceivedLine{
			ItemId: item.GetId(), ReceivedCount: over, Placements: placedOn(rakA, over),
		})
	}

	_, err := svc.RestockRequestAccept(ctxUser(7), connect.NewRequest(&inventoryv1.RestockRequestAcceptRequest{
		TeamId: ledgerWarehouse, RequestId: r.GetId(), Lines: lines,
	}))
	if err == nil {
		t.Fatal("an accept of more than the lines say was not refused")
	}

	var after int64
	db.Model(&models.InventoryTransaction{}).Count(&after)
	if after != before {
		t.Fatalf("a refused accept wrote %d transactions", after-before)
	}
}
