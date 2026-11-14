package main

import (
	"context"
	"slices"
	"testing"
	"time"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	supplierv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/supplier/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_service_models"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_service_models"
	supplier_v1 "github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_v1"
)

// THE PRODUK TAB THROUGH THE REAL WIRING: supplier_service's SupplierProductList over its links, named by product_service
// (supplierProductCatalog → ProductByIds, IDsMatchingAmong) and filled by inventory's batches (supplierGoodsReader →
// inventory_v1.SupplierStoreProductGoods) — real rows in every table, no fake in between.
func TestSupplierProductCatalog_TheProduktabReadsTheRealRows(t *testing.T) {
	db := san_testdb.DB(t)
	ctx := context.Background()

	const (
		melati  uint64 = 12
		kenanga uint64 = 13
		gudang  uint64 = 9_540_005
	)

	product := func(team uint64, code, name, thumb string) uint64 {
		t.Helper()

		row := product_service_models.Product{TeamID: team, ProductCode: code, Name: name, DefaultImageThumbnailURL: thumb}

		err := db.Create(&row).Error
		if err != nil {
			t.Fatalf("product %s: %v", code, err)
		}

		return row.ID
	}

	katun := product(melati, "PC-KTN-01", "Kain Katun Jepang", "https://img.example/ktn.jpg")
	benang := product(kenanga, "PC-BNG-40", "Benang Polyester", "")

	sumber := supplier_service_models.Supplier{TeamID: melati, Name: "PT Sumber Wiring"}

	err := db.Create(&sumber).Error
	if err != nil {
		t.Fatal(err)
	}

	shopee := supplier_service_models.SupplierChannel{SupplierID: sumber.ID, ChannelType: "shopee", Name: "Sumber Wiring Official"}

	err = db.Create(&shopee).Error
	if err != nil {
		t.Fatal(err)
	}

	// Katun bought at the Shopee store (10, an order took 3); Benang at a stall, with no store (6, untouched).
	restock := inventory_service_models.InventoryTransaction{WarehouseID: gudang, TeamID: melati, TxType: inventory_service_models.TxRestock}
	take := inventory_service_models.InventoryTransaction{WarehouseID: gudang, TeamID: melati, TxType: inventory_service_models.TxOrder}

	for _, tx := range []*inventory_service_models.InventoryTransaction{&restock, &take} {
		err = db.Create(tx).Error
		if err != nil {
			t.Fatalf("transaction: %v", err)
		}
	}

	batch := func(team, productID, store uint64, ready int64) uint64 {
		t.Helper()

		row := inventory_service_models.Batch{
			WarehouseID: gudang, TeamID: team, ProductID: productID, TransactionID: restock.ID, PriceUnit: 1000,
			StockCount: ready, StockValuation: float64(ready) * 1000, InitStockCount: 10, InitStockValuation: 10000,
			SupplierID: sumber.ID, SupplierChannelID: store,
		}

		err := db.Create(&row).Error
		if err != nil {
			t.Fatalf("batch: %v", err)
		}

		return row.ID
	}

	katunBatch := batch(melati, katun, shopee.ID, 7)
	batch(kenanga, benang, 0, 6)

	err = db.Create(&inventory_service_models.BatchLog{
		WarehouseID: gudang, TeamID: melati, BatchID: katunBatch, TransactionID: take.ID,
		ChangeType: string(inventory_service_models.TxOrder), ChangeCount: -3, ChangeValuation: -3000,
		StockCountAfter: 7, StockValuationAfter: 7000, PriceUnitAfter: 1000,
	}).Error
	if err != nil {
		t.Fatalf("batch log: %v", err)
	}

	at := time.Date(2026, 11, 10, 3, 0, 0, 0, time.UTC)
	link := func(team, productID uint64, store *uint64, daysAgo int) {
		t.Helper()

		err := db.Create(&supplier_service_models.SupplierChannelProduct{
			TeamID: team, SupplierID: sumber.ID, ChannelID: store, ProductID: productID,
			FirstRestockedAt: at.AddDate(0, 0, -daysAgo-10), LastRestockedAt: at.AddDate(0, 0, -daysAgo), LastRestockID: productID,
		}).Error
		if err != nil {
			t.Fatalf("link: %v", err)
		}
	}

	link(melati, katun, &shopee.ID, 1)
	link(kenanga, benang, nil, 2)

	reader := NewSupplierGoodsReader(inventory_v1.NewService(db, nil, nil, nil, nil, nil, nil, nil), db)
	catalog := NewSupplierProductCatalog(product_v1.NewService(db, nil, nil, nil, nil))
	svc := supplier_v1.NewService(db, nil, nil, reader, nil, catalog)

	list := func(q string) []*supplierv1.SupplierProduct {
		t.Helper()

		resp, err := svc.SupplierProductList(ctx, connect.NewRequest(&supplierv1.SupplierProductListRequest{
			TeamId: kenanga, Filter: &supplierv1.SupplierProductListFilter{SupplierId: sumber.ID, Q: q},
			Page: &commonv1.CommonPagination{Page: 1, Limit: 10},
		}))
		if err != nil {
			t.Fatalf("SupplierProductList(%q): %v", q, err)
		}

		byID := resp.Msg.GetItems()[0].GetProduct().GetMapData()
		rows := make([]*supplierv1.SupplierProduct, 0, len(resp.Msg.GetIds()))

		for _, id := range resp.Msg.GetIds() {
			rows = append(rows, byID[id])
		}

		return rows
	}

	rows := list("")
	if len(rows) != 2 {
		t.Fatalf("%d rows, want 2", len(rows))
	}

	first := rows[0]
	if first.GetProductName() != "Kain Katun Jepang" || first.GetProductCode() != "PC-KTN-01" ||
		first.GetProductThumbnailUrl() != "https://img.example/ktn.jpg" || first.GetChannelName() != "Sumber Wiring Official" {
		t.Fatalf("Katun's row = %+v", first)
	}

	if f := first.GetFigures(); f.GetSoldUnits() != 3 || f.GetOrders() != 1 || f.GetReadyUnits() != 7 || f.GetLastOrderUnix() == 0 {
		t.Fatalf("Katun's figures = %+v, want 3 sold on 1 order, 7 ready", f)
	}

	second := rows[1]
	if second.GetProductName() != "Benang Polyester" || second.GetChannelId() != 0 || second.GetTeamId() != kenanga {
		t.Fatalf("Benang's row = %+v", second)
	}

	if f := second.GetFigures(); f.GetSoldUnits() != 0 || f.GetReadyUnits() != 6 || f.GetLastOrderUnix() != 0 {
		t.Fatalf("Benang's figures = %+v, want 0 sold, 6 ready, never ordered", f)
	}

	// The search reaches product_service's names and SKUs — among this supplier's products.
	if rows := list("bng-40"); len(rows) != 1 || rows[0].GetProductId() != benang {
		t.Fatalf("searched by SKU = %v", rows)
	}

	if rows := list("katun"); len(rows) != 1 || rows[0].GetProductId() != katun {
		t.Fatalf("searched by name = %v", rows)
	}
}

// THE GUDANG TERKAIT CHIP THROUGH THE REAL WIRING (a-supplier-page-is-scoped-by-its-warehouses): the Toko and Produk tabs
// narrowed by inventory's own batches, in-process (supplierGoodsReader → SupplierStoresAtWarehouse,
// SupplierStoreProductsAtWarehouse, SupplierStoreProductGoods and SupplierGoods with the warehouse). Katun bought at the
// Shopee store sits at both warehouses (7 at A after an order took 3, 4 at B); Benang, team Kenanga's from a stall (no
// store), at A; Rayon from the Tokopedia store at B, emptied since — still received there.
func TestSupplierGoodsReader_TheWarehouseChipNarrowsTheTabs(t *testing.T) {
	db := san_testdb.DB(t)
	ctx := context.Background()

	const (
		melati  uint64 = 12
		kenanga uint64 = 13
		gudangA uint64 = 9_560_001
		gudangB uint64 = 9_560_002
		gudangC uint64 = 9_560_003 // never received anything of this supplier
	)

	product := func(team uint64, code, name string) uint64 {
		t.Helper()

		row := product_service_models.Product{TeamID: team, ProductCode: code, Name: name}

		err := db.Create(&row).Error
		if err != nil {
			t.Fatalf("product %s: %v", code, err)
		}

		return row.ID
	}

	katun := product(melati, "WC-KTN-01", "Kain Katun Chip")
	benang := product(kenanga, "WC-BNG-40", "Benang Chip")
	rayon := product(melati, "WC-RYN-01", "Kain Rayon Chip")

	sumber := supplier_service_models.Supplier{TeamID: melati, Name: "PT Sumber Chip"}

	err := db.Create(&sumber).Error
	if err != nil {
		t.Fatal(err)
	}

	shopee := supplier_service_models.SupplierChannel{SupplierID: sumber.ID, ChannelType: "shopee", Name: "Sumber Chip Shopee"}
	tokped := supplier_service_models.SupplierChannel{SupplierID: sumber.ID, ChannelType: "tokopedia", Name: "Sumber Chip Tokopedia"}

	for _, store := range []*supplier_service_models.SupplierChannel{&shopee, &tokped} {
		err = db.Create(store).Error
		if err != nil {
			t.Fatal(err)
		}
	}

	restock := func(warehouse, team, productID, store uint64, ready int64) uint64 {
		t.Helper()

		tx := inventory_service_models.InventoryTransaction{WarehouseID: warehouse, TeamID: team, TxType: inventory_service_models.TxRestock}

		err := db.Create(&tx).Error
		if err != nil {
			t.Fatalf("transaction: %v", err)
		}

		row := inventory_service_models.Batch{
			WarehouseID: warehouse, TeamID: team, ProductID: productID, TransactionID: tx.ID, PriceUnit: 1000,
			StockCount: ready, StockValuation: float64(ready) * 1000, InitStockCount: 10, InitStockValuation: 10000,
			SupplierID: sumber.ID, SupplierChannelID: store,
		}

		err = db.Create(&row).Error
		if err != nil {
			t.Fatalf("batch: %v", err)
		}

		return row.ID
	}

	katunAtA := restock(gudangA, melati, katun, shopee.ID, 7)
	restock(gudangB, melati, katun, shopee.ID, 4)
	restock(gudangA, kenanga, benang, 0, 6)
	restock(gudangB, melati, rayon, tokped.ID, 0)

	take := inventory_service_models.InventoryTransaction{WarehouseID: gudangA, TeamID: melati, TxType: inventory_service_models.TxOrder}

	err = db.Create(&take).Error
	if err != nil {
		t.Fatal(err)
	}

	err = db.Create(&inventory_service_models.BatchLog{
		WarehouseID: gudangA, TeamID: melati, BatchID: katunAtA, TransactionID: take.ID,
		ChangeType: string(inventory_service_models.TxOrder), ChangeCount: -3, ChangeValuation: -3000,
		StockCountAfter: 7, StockValuationAfter: 7000, PriceUnitAfter: 1000,
	}).Error
	if err != nil {
		t.Fatalf("batch log: %v", err)
	}

	at := time.Date(2026, 11, 10, 3, 0, 0, 0, time.UTC)
	link := func(team, productID uint64, store *uint64, daysAgo int) {
		t.Helper()

		err := db.Create(&supplier_service_models.SupplierChannelProduct{
			TeamID: team, SupplierID: sumber.ID, ChannelID: store, ProductID: productID,
			FirstRestockedAt: at.AddDate(0, 0, -daysAgo-10), LastRestockedAt: at.AddDate(0, 0, -daysAgo), LastRestockID: productID,
		}).Error
		if err != nil {
			t.Fatalf("link: %v", err)
		}
	}

	link(melati, katun, &shopee.ID, 1)
	link(kenanga, benang, nil, 2)
	link(melati, rayon, &tokped.ID, 3)

	reader := NewSupplierGoodsReader(inventory_v1.NewService(db, nil, nil, nil, nil, nil, nil, nil), db)
	catalog := NewSupplierProductCatalog(product_v1.NewService(db, nil, nil, nil, nil))
	svc := supplier_v1.NewService(db, nil, nil, reader, nil, catalog)

	stores := func(warehouse uint64) []uint64 {
		t.Helper()

		resp, err := svc.SupplierChannelList(ctx, connect.NewRequest(&supplierv1.SupplierChannelListRequest{
			TeamId: kenanga, Filter: &supplierv1.SupplierChannelListFilter{SupplierId: sumber.ID, WarehouseId: warehouse},
			Page: &commonv1.CommonPagination{Page: 1, Limit: 10},
		}))
		if err != nil {
			t.Fatalf("SupplierChannelList(%d): %v", warehouse, err)
		}

		return resp.Msg.GetIds()
	}

	type row struct {
		product     uint64
		sold, ready int64
	}

	products := func(warehouse uint64) []row {
		t.Helper()

		resp, err := svc.SupplierProductList(ctx, connect.NewRequest(&supplierv1.SupplierProductListRequest{
			TeamId: kenanga, Filter: &supplierv1.SupplierProductListFilter{SupplierId: sumber.ID, WarehouseId: warehouse},
			Page: &commonv1.CommonPagination{Page: 1, Limit: 10},
		}))
		if err != nil {
			t.Fatalf("SupplierProductList(%d): %v", warehouse, err)
		}

		byID := resp.Msg.GetItems()[0].GetProduct().GetMapData()

		var out []row
		for _, id := range resp.Msg.GetIds() {
			p := byID[id]
			out = append(out, row{p.GetProductId(), p.GetFigures().GetSoldUnits(), p.GetFigures().GetReadyUnits()})
		}

		return out
	}

	cases := []struct {
		name      string
		warehouse uint64
		stores    []uint64
		products  []row
	}{
		{"no chip", 0, []uint64{tokped.ID, shopee.ID}, []row{{katun, 3, 11}, {benang, 0, 6}, {rayon, 0, 0}}},
		{"warehouse A", gudangA, []uint64{shopee.ID}, []row{{katun, 3, 7}, {benang, 0, 6}}},
		{"warehouse B", gudangB, []uint64{tokped.ID, shopee.ID}, []row{{katun, 0, 4}, {rayon, 0, 0}}},
		{"warehouse C", gudangC, nil, nil},
	}

	for _, c := range cases {
		if got := stores(c.warehouse); !slices.Equal(got, c.stores) {
			t.Fatalf("%s: the Toko tab lists %v, want %v", c.name, got, c.stores)
		}

		if got := products(c.warehouse); !slices.Equal(got, c.products) {
			t.Fatalf("%s: the Produk tab reads %+v, want %+v", c.name, got, c.products)
		}
	}

	// The Toko tab's figures under the chip — what its export writes and the screen reads (SupplierGoods by STORE).
	goods, err := reader.StoreGoods(ctx, sumber.ID, gudangB)
	if err != nil {
		t.Fatal(err)
	}

	if len(goods) != 2 || goods[shopee.ID].Ready != 4 || goods[shopee.ID].Sold != 0 || goods[tokped.ID].Ready != 0 {
		t.Fatalf("store figures at warehouse B = %+v, want Shopee 4 ready (its 3 sold were at A), Tokopedia 0", goods)
	}
}
