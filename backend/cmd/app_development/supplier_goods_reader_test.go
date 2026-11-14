package main

import (
	"context"
	"reflect"
	"slices"
	"testing"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_service_models"
	supplier_v1 "github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_v1"
)

// THE SUPPLIER'S GOODS SEAM: supplier_service's GoodsReader answered by inventory in-process — a take's parts copied
// across field by field, and each figure named to inventory's own (Terjual → sold, Siap → ready).
func TestSupplierGoodsReader_AnswersFromInventory(t *testing.T) {
	db := san_testdb.DB(t)
	reader := NewSupplierGoodsReader(inventory_v1.NewService(db, nil, nil, nil, nil, nil, nil, nil), db)
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
		SupplierChannelID: 701,
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

	// The Toko tab's export reads the same goods per STORE: 3 sold, 7 ready at store 701, with the order's and the
	// restock's moments.
	stores, err := reader.StoreGoods(ctx, 77)
	if err != nil {
		t.Fatalf("StoreGoods: %v", err)
	}

	got, found := stores[701]
	if len(stores) != 1 || !found || got.Sold != 3 || got.Ready != 7 || got.LastOrderUnix == 0 || got.LastRestockUnix == 0 {
		t.Fatalf("stores = %+v — want store 701 with 3 sold, 7 ready and both dates", stores)
	}
}

// THE GUDANG FILTER THROUGH THE REAL SEAM (the-warehouse-filters-before-the-team): SupplierList asks inventory's batches,
// in-process, which suppliers were received at the picked warehouse. Two teams restock from team 12's supplier Sumber at
// Gudang 5 (one of them also at Gudang 6); team 12's Sinar only at Gudang 6; its Kosong never — and team 13's own Lain
// at Gudang 5 shows on Discover only.
func TestSupplierGoodsReader_TheWarehouseFilterReadsTheBatches(t *testing.T) {
	db := san_testdb.DB(t)
	ctx := context.Background()

	const (
		melati  uint64 = 12
		sinar   uint64 = 13
		gudang5 uint64 = 9_520_005
		gudang6 uint64 = 9_520_006
	)

	supplier := func(team uint64, name string) uint64 {
		t.Helper()

		row := supplier_service_models.Supplier{TeamID: team, Name: name}

		err := db.Create(&row).Error
		if err != nil {
			t.Fatalf("supplier %s: %v", name, err)
		}

		return row.ID
	}

	sumber := supplier(melati, "Sumber Gudang Lima")
	sinarJaya := supplier(melati, "Sinar Gudang Enam")
	kosong := supplier(melati, "Kosong Belum Datang")
	lain := supplier(sinar, "Lain Gudang Lima")

	restock := func(warehouse, team, supplierID uint64) {
		t.Helper()

		tx := inventory_service_models.InventoryTransaction{WarehouseID: warehouse, TeamID: team, TxType: inventory_service_models.TxRestock}

		err := db.Create(&tx).Error
		if err != nil {
			t.Fatalf("transaction: %v", err)
		}

		err = db.Create(&inventory_service_models.Batch{
			WarehouseID: warehouse, TeamID: team, ProductID: 9_520_901, TransactionID: tx.ID, PriceUnit: 1000,
			StockCount: 4, StockValuation: 4000, InitStockCount: 4, InitStockValuation: 4000, SupplierID: supplierID,
		}).Error
		if err != nil {
			t.Fatalf("batch: %v", err)
		}
	}

	restock(gudang5, melati, sumber)
	restock(gudang5, sinar, sumber)
	restock(gudang6, sinar, sumber)
	restock(gudang6, melati, sinarJaya)
	restock(gudang5, sinar, lain)

	reader := NewSupplierGoodsReader(inventory_v1.NewService(db, nil, nil, nil, nil, nil, nil, nil), db)
	svc := supplier_v1.NewService(db, nil, nil, reader, nil)

	list := func(scope supplierv1.SupplierListScope, warehouse uint64) []uint64 {
		t.Helper()

		resp, err := svc.SupplierList(ctx, connect.NewRequest(&supplierv1.SupplierListRequest{
			TeamId: melati, Filter: &supplierv1.SupplierListFilter{Scope: scope, WarehouseId: warehouse},
			Page: &commonv1.CommonPagination{Page: 1, Limit: 50},
		}))
		if err != nil {
			t.Fatalf("SupplierList(%v, %d): %v", scope, warehouse, err)
		}

		// Only this test's suppliers: the shared database may hold others' rows.
		var ours []uint64

		for _, id := range resp.Msg.GetIds() {
			if slices.Contains([]uint64{sumber, sinarJaya, kosong, lain}, id) {
				ours = append(ours, id)
			}
		}

		return ours
	}

	own := supplierv1.SupplierListScope_SUPPLIER_LIST_SCOPE_OWN
	every := supplierv1.SupplierListScope_SUPPLIER_LIST_SCOPE_EVERY_TEAM

	if got, want := list(own, gudang5), []uint64{sumber}; !slices.Equal(got, want) {
		t.Fatalf("own at Gudang 5 = %v, want %v", got, want)
	}

	if got, want := list(own, gudang6), []uint64{sinarJaya, sumber}; !slices.Equal(got, want) {
		t.Fatalf("own at Gudang 6 = %v, want %v", got, want)
	}

	if got, want := list(every, gudang5), []uint64{lain, sumber}; !slices.Equal(got, want) {
		t.Fatalf("Discover at Gudang 5 = %v, want %v", got, want)
	}

	if got, want := list(own, 0), []uint64{kosong, sinarJaya, sumber}; !slices.Equal(got, want) {
		t.Fatalf("own, any warehouse = %v, want %v", got, want)
	}
}
