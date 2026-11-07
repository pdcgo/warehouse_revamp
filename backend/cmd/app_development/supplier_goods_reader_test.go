package main

import (
	"context"
	"reflect"
	"testing"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
	supplier_v1 "github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_v1"
)

// THE SUPPLIER'S GOODS SEAM: supplier_service's GoodsReader answered by inventory in-process — a take's parts copied
// across field by field, and each figure named to inventory's own (Terjual → sold, Siap → ready).
func TestSupplierGoodsReader_AnswersFromInventory(t *testing.T) {
	db := san_testdb.DB(t)
	reader := NewSupplierGoodsReader(inventory_v1.NewService(db, nil, nil, nil, nil, nil, nil, nil))
	ctx := context.Background()

	restock := inventory_service_models.InventoryTransaction{WarehouseID: 5, TeamID: 12, TxType: inventory_service_models.TxRestock}
	take := inventory_service_models.InventoryTransaction{WarehouseID: 5, TeamID: 12, TxType: inventory_service_models.TxOrder}

	for _, tx := range []*inventory_service_models.InventoryTransaction{&restock, &take} {
		err := db.Create(tx).Error
		if err != nil {
			t.Fatalf("transaction: %v", err)
		}
	}

	// 10 bought from supplier 77 into a batch, 3 taken by an order: 3 sold, 7 ready.
	batch := inventory_service_models.Batch{
		WarehouseID: 5, TeamID: 12, ProductID: 901, TransactionID: restock.ID, PriceUnit: 1000,
		StockCount: 7, StockValuation: 7000, InitStockCount: 10, InitStockValuation: 10000, SupplierID: 77,
	}

	err := db.Create(&batch).Error
	if err != nil {
		t.Fatalf("batch: %v", err)
	}

	err = db.Create(&inventory_service_models.BatchLog{
		WarehouseID: 5, TeamID: 12, BatchID: batch.ID, TransactionID: take.ID,
		ChangeType: string(inventory_service_models.TxOrder), ChangeCount: -3, ChangeValuation: -3000,
		StockCountAfter: 7, StockValuationAfter: 7000, PriceUnitAfter: 1000,
	}).Error
	if err != nil {
		t.Fatalf("batch log: %v", err)
	}

	parts, err := reader.OrderTakeSuppliers(ctx, take.ID)
	if err != nil {
		t.Fatalf("OrderTakeSuppliers: %v", err)
	}

	want := []supplier_v1.SaleTakePart{{ProductID: 901, SupplierID: 77, TeamID: 12, Units: 3}}
	if !reflect.DeepEqual(parts, want) {
		t.Fatalf("take = %+v, want %+v", parts, want)
	}

	sold, err := reader.SupplierIDsByFigure(ctx, supplier_v1.GoodsSold, 3, 4)
	if err != nil || !reflect.DeepEqual(sold, []uint64{77}) {
		t.Fatalf("Terjual [3, 4) = %v, %v — want 77", sold, err)
	}

	ready, err := reader.SupplierIDsByFigure(ctx, supplier_v1.GoodsReady, 7, 8)
	if err != nil || !reflect.DeepEqual(ready, []uint64{77}) {
		t.Fatalf("Siap [7, 8) = %v, %v — want 77", ready, err)
	}

	_, err = reader.SupplierIDsByFigure(ctx, supplier_v1.GoodsFigure(9), 0, 0)
	if err == nil {
		t.Fatalf("an unknown figure was answered")
	}
}
