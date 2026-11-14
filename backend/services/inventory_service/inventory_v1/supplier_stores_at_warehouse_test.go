package inventory_v1_test

import (
	"context"
	"slices"
	"testing"

	"connectrpc.com/connect"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// A SUPPLIER PAGE UNDER A WAREHOUSE CHIP (SupplierStoresAtWarehouse, SupplierStoreProductsAtWarehouse): the stores, and
// the (store, product) pairs, of a supplier's goods received at one warehouse — the Gudang terkait set's own test, so the
// Toko and Produk tabs keep exactly what the chip stands for (a-supplier-page-is-scoped-by-its-warehouses).

// swBatch mints a batch of Sumber's goods at `warehouse` by a transaction of `txType`, bought at `store`, holding `ready`.
func swBatch(t *testing.T, f sgFixture, warehouse, team, product, store uint64, txType string, ready int64) uint64 {
	t.Helper()

	var txID uint64

	err := f.db.Raw(`
		INSERT INTO inventory_transactions (warehouse_id, team_id, tx_type, created_at, updated_at)
		VALUES (?, ?, ?, NOW(), NOW()) RETURNING id`, warehouse, team, txType).Scan(&txID).Error
	if err != nil {
		t.Fatalf("seed transaction: %v", err)
	}

	var batchID uint64

	err = f.db.Raw(`
		INSERT INTO batches (warehouse_id, team_id, product_id, transaction_id, price_unit, stock_count, stock_valuation,
		                     init_stock_count, init_stock_valuation, supplier_id, supplier_channel_id, created_at, updated_at)
		VALUES (?, ?, ?, ?, 10000, ?, ?, 3, 30000, ?, ?, NOW(), NOW()) RETURNING id`,
		warehouse, team, product, txID, ready, float64(ready)*10000, sgSumber, store).Scan(&batchID).Error
	if err != nil {
		t.Fatalf("seed batch: %v", err)
	}

	return batchID
}

// Every way a warehouse comes to hold a store's goods, and the one way it holds none. sgStocked: store A's Kaos at Gudang
// 5 AND Gudang 6 (a store with goods at both), store B's Celana at Gudang 5 (another team's restock), Sinar Jaya's Celana
// at a stall (no store) at Gudang 5. Then: store A's Gudang 6 batch written down to 0 (still received there), store B's
// goods by a transfer still on the shelf at Gudang 7, moved on unsold at Gudang 8, sold out of at Gudang 9. For each
// warehouse the stores equal the ones SupplierGoods by STORE answers under that warehouse.
func TestSupplierStoresAtWarehouse_TheStoresOfTheChip(t *testing.T) {
	f := sgStocked(t)
	ctx := context.Background()

	err := f.db.Exec("UPDATE batches SET stock_count = 0, stock_valuation = 0 WHERE warehouse_id = ? AND supplier_id = ?",
		sgGudang6, sgSumber).Error
	if err != nil {
		t.Fatalf("empty Gudang 6: %v", err)
	}

	swBatch(t, f, saGudang7, sgSinar, sgCelana, sgStoreB, "transfer_in", 2)
	swBatch(t, f, saGudang8, sgSinar, sgCelana, sgStoreB, "transfer_in", 0)
	sold := swBatch(t, f, saGudang9, sgSinar, sgCelana, sgStoreB, "transfer_in", 0)
	saSoldFrom(t, f, saGudang9, sgSinar, sold, 3)

	cases := []struct {
		name      string
		warehouse uint64
		stores    []uint64
		pairs     []inventory_v1.StoreProduct
	}{
		{"Gudang 5 — both stores, two teams", sgGudang5, []uint64{sgStoreA, sgStoreB},
			[]inventory_v1.StoreProduct{{StoreID: sgStoreA, ProductID: sgKaos}, {StoreID: sgStoreB, ProductID: sgCelana}}},
		{"Gudang 6 — store A, emptied since", sgGudang6, []uint64{sgStoreA},
			[]inventory_v1.StoreProduct{{StoreID: sgStoreA, ProductID: sgKaos}}},
		{"Gudang 7 — a transfer on the shelf", saGudang7, []uint64{sgStoreB},
			[]inventory_v1.StoreProduct{{StoreID: sgStoreB, ProductID: sgCelana}}},
		{"Gudang 8 — a transfer moved on unsold", saGudang8, nil, nil},
		{"Gudang 9 — a transfer sold out of", saGudang9, []uint64{sgStoreB},
			[]inventory_v1.StoreProduct{{StoreID: sgStoreB, ProductID: sgCelana}}},
	}

	for _, c := range cases {
		stores, err := inventory_v1.SupplierStoresAtWarehouse(ctx, f.db, sgSumber, c.warehouse)
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}

		if !slices.Equal(stores, c.stores) {
			t.Fatalf("%s: stores %v, want %v", c.name, stores, c.stores)
		}

		pairs, err := inventory_v1.SupplierStoreProductsAtWarehouse(ctx, f.db, sgSumber, c.warehouse)
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}

		if !slices.Equal(pairs, c.pairs) {
			t.Fatalf("%s: pairs %v, want %v", c.name, pairs, c.pairs)
		}

		// The chip's own figures: SupplierGoods by STORE under the same warehouse lists the same stores.
		res, err := f.svc.SupplierGoods(ctx, connect.NewRequest(&inventoryv1.SupplierGoodsRequest{
			TeamId: sgMelati, SupplierIds: []uint64{sgSumber}, Group: inventoryv1.SupplierGoodsGroup_SUPPLIER_GOODS_GROUP_STORE,
			WarehouseId: c.warehouse,
		}))
		if err != nil {
			t.Fatalf("%s: SupplierGoods: %v", c.name, err)
		}

		var figured []uint64
		for _, row := range res.Msg.GetRows() {
			figured = append(figured, row.GetStoreId())
		}

		slices.Sort(figured)

		if !slices.Equal(figured, c.stores) {
			t.Fatalf("%s: the tab keeps %v but the figures cover %v", c.name, c.stores, figured)
		}
	}
}

// A line that named the supplier alone is store 0 in the pairs (the Produk tab's "—" row) and never a store of the Toko
// tab; a batch from nobody is no supplier's; no supplier or no warehouse asks nothing.
func TestSupplierStoresAtWarehouse_NoStoreAndNothingAsked(t *testing.T) {
	f := sgStocked(t)
	ctx := context.Background()

	stores, err := inventory_v1.SupplierStoresAtWarehouse(ctx, f.db, sgSinarJaya, sgGudang5)
	if err != nil || len(stores) != 0 {
		t.Fatalf("Sinar Jaya's stores at Gudang 5 = %v, %v — a stall is no store", stores, err)
	}

	pairs, err := inventory_v1.SupplierStoreProductsAtWarehouse(ctx, f.db, sgSinarJaya, sgGudang5)
	if err != nil || !slices.Equal(pairs, []inventory_v1.StoreProduct{{StoreID: 0, ProductID: sgCelana}}) {
		t.Fatalf("Sinar Jaya's pairs at Gudang 5 = %v, %v — want its stall line", pairs, err)
	}

	for _, c := range []struct{ supplier, warehouse uint64 }{{0, sgGudang5}, {sgSumber, 0}} {
		stores, err := inventory_v1.SupplierStoresAtWarehouse(ctx, f.db, c.supplier, c.warehouse)
		if err != nil || stores != nil {
			t.Fatalf("stores of %+v = %v, %v — want nothing", c, stores, err)
		}

		pairs, err := inventory_v1.SupplierStoreProductsAtWarehouse(ctx, f.db, c.supplier, c.warehouse)
		if err != nil || pairs != nil {
			t.Fatalf("pairs of %+v = %v, %v — want nothing", c, pairs, err)
		}
	}
}
