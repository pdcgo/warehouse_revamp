package inventory_v1_test

import (
	"context"
	"testing"
	"time"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// THE PRODUK TAB'S FIGURES (SupplierStoreProductGoods): Terjual and Siap per store AND product, for one page's rows only —
// SupplierGoods' figures, keyed finer (the-detail-tabs-show-sold-and-ready).

type spWant struct {
	sold, orders, ready int64
	ordered             bool
}

func spByPair(rows []inventory_v1.StoreProductGoods) map[inventory_v1.StoreProduct]inventory_v1.StoreProductGoods {
	out := map[inventory_v1.StoreProduct]inventory_v1.StoreProductGoods{}
	for _, row := range rows {
		out[row.StoreProduct] = row
	}

	return out
}

func spCheck(t *testing.T, name string, rows map[inventory_v1.StoreProduct]inventory_v1.StoreProductGoods, pair inventory_v1.StoreProduct, want spWant) {
	t.Helper()

	row, found := rows[pair]
	if !found {
		t.Fatalf("%s: no row, want %+v", name, want)
	}

	got := spWant{sold: row.Sold, orders: row.Orders, ready: row.Ready, ordered: row.LastOrder != nil}
	if got != want {
		t.Fatalf("%s = %+v, want %+v", name, got, want)
	}
}

// Only the asked pairs come back, each with its own store's and product's goods — every team's, both warehouses — a cancel
// counted back, a pair with no goods absent, another supplier's goods of the same product never mixed in. Each figure
// equals SupplierGoods' for the store when the store holds that one product.
func TestSupplierStoreProductGoods_TheAskedPairsWithTheirOwnGoods(t *testing.T) {
	f := sgStocked(t)
	ctx := context.Background()

	// Melati's Kaos bought at Sumber's store A (10 at Gudang 5, 4 at Gudang 6): 3 sold, a second order of 2 cancelled.
	sgSell(t, f, sgMelati, sgGudang5, sgKaos, 3, "sp-1")
	sgSell(t, f, sgMelati, sgGudang5, sgKaos, 2, "sp-2")
	sgCancel(t, f, sgMelati, "sp-2")

	kaosA := inventory_v1.StoreProduct{StoreID: sgStoreA, ProductID: sgKaos}
	celanaB := inventory_v1.StoreProduct{StoreID: sgStoreB, ProductID: sgCelana}
	kaosB := inventory_v1.StoreProduct{StoreID: sgStoreB, ProductID: sgKaos} // never bought there
	celanaNone := inventory_v1.StoreProduct{StoreID: 0, ProductID: sgCelana} // Sinar Jaya's, not Sumber's
	topiNone := inventory_v1.StoreProduct{StoreID: 0, ProductID: sgTopi}     // bought from nobody

	got, err := inventory_v1.SupplierStoreProductGoods(ctx, f.db, sgSumber, 0, []inventory_v1.StoreProduct{kaosA, celanaB, kaosB, celanaNone, topiNone})
	if err != nil {
		t.Fatal(err)
	}

	rows := spByPair(got)
	spCheck(t, "Kaos at store A", rows, kaosA, spWant{sold: 3, orders: 1, ready: 11, ordered: true})
	spCheck(t, "Celana at store B", rows, celanaB, spWant{sold: 0, orders: 0, ready: 8, ordered: false})

	if len(rows) != 2 {
		t.Fatalf("got %d rows (%v), want 2 — a pair with no goods of THIS supplier is absent", len(rows), rows)
	}

	// The same figures SupplierGoods reads for each store, which holds one product.
	stores := sgGoods(t, f, sgMelati, inventoryv1.SupplierGoodsGroup_SUPPLIER_GOODS_GROUP_STORE, sgSumber)
	for _, pair := range []inventory_v1.StoreProduct{kaosA, celanaB} {
		store := stores[[2]uint64{sgSumber, pair.StoreID}]
		if store.GetSoldUnits() != rows[pair].Sold || store.GetReadyUnits() != rows[pair].Ready || store.GetOrders() != rows[pair].Orders {
			t.Fatalf("store %d: SupplierGoods %+v, per product %+v — they must agree", pair.StoreID, store, rows[pair])
		}
	}

	// A line naming the supplier alone: store 0.
	stall, err := inventory_v1.SupplierStoreProductGoods(ctx, f.db, sgSinarJaya, 0, []inventory_v1.StoreProduct{celanaNone})
	if err != nil {
		t.Fatal(err)
	}

	spCheck(t, "Celana at Sinar Jaya's stall", spByPair(stall), celanaNone, spWant{sold: 0, orders: 0, ready: 6, ordered: false})
}

// UNDER A WAREHOUSE CHIP (a-supplier-page-is-scoped-by-its-warehouses) each figure counts only the batches in that
// warehouse: Kaos bought at store A sits in Gudang 5 (10, 3 sold) and Gudang 6 (4) — Gudang 5 reads 3 sold · 7 ready,
// Gudang 6 nothing sold · 4 ready; Celana at store B was never received at Gudang 6, so it is absent there. The two
// warehouses add up to the all-warehouse row.
func TestSupplierStoreProductGoods_UnderAChipOnlyThatWarehouse(t *testing.T) {
	f := sgStocked(t)
	ctx := context.Background()

	sgSell(t, f, sgMelati, sgGudang5, sgKaos, 3, "sp-w5")

	kaosA := inventory_v1.StoreProduct{StoreID: sgStoreA, ProductID: sgKaos}
	celanaB := inventory_v1.StoreProduct{StoreID: sgStoreB, ProductID: sgCelana}
	asked := []inventory_v1.StoreProduct{kaosA, celanaB}

	read := func(warehouse uint64) map[inventory_v1.StoreProduct]inventory_v1.StoreProductGoods {
		t.Helper()

		got, err := inventory_v1.SupplierStoreProductGoods(ctx, f.db, sgSumber, warehouse, asked)
		if err != nil {
			t.Fatalf("warehouse %d: %v", warehouse, err)
		}

		return spByPair(got)
	}

	all, at5, at6 := read(0), read(sgGudang5), read(sgGudang6)

	spCheck(t, "Kaos at A, Gudang 5", at5, kaosA, spWant{sold: 3, orders: 1, ready: 7, ordered: true})
	spCheck(t, "Celana at B, Gudang 5", at5, celanaB, spWant{ready: 8})
	spCheck(t, "Kaos at A, Gudang 6", at6, kaosA, spWant{ready: 4})

	if _, found := at6[celanaB]; found || len(at6) != 1 {
		t.Fatalf("Gudang 6 = %v — Celana at store B was never received there", at6)
	}

	spCheck(t, "Kaos at A, every warehouse", all, kaosA, spWant{sold: 3, orders: 1, ready: 11, ordered: true})
}

// The last order is the newest take still netting below 0 — a later cancelled order does not move it.
func TestSupplierStoreProductGoods_TheLastOrderSkipsACancelledOne(t *testing.T) {
	f := sgStocked(t)
	ctx := context.Background()

	kept := sgSell(t, f, sgMelati, sgGudang5, sgKaos, 1, "sp-kept")
	sgStamp(t, f.db, kept, time.Date(2026, 10, 1, 9, 0, 0, 0, sgJakarta))

	gone := sgSell(t, f, sgMelati, sgGudang5, sgKaos, 1, "sp-gone")
	sgCancel(t, f, sgMelati, "sp-gone")
	sgStamp(t, f.db, gone, time.Date(2026, 10, 5, 9, 0, 0, 0, sgJakarta))

	pair := inventory_v1.StoreProduct{StoreID: sgStoreA, ProductID: sgKaos}

	got, err := inventory_v1.SupplierStoreProductGoods(ctx, f.db, sgSumber, 0, []inventory_v1.StoreProduct{pair})
	if err != nil {
		t.Fatal(err)
	}

	row := spByPair(got)[pair]
	if row.LastOrder == nil || !row.LastOrder.Equal(time.Date(2026, 10, 1, 9, 0, 0, 0, sgJakarta)) {
		t.Fatalf("last order = %v, want 1 Oct 09:00 WIB — the cancelled order of 5 Oct is not an order", row.LastOrder)
	}

	if row.Sold != 1 || row.Orders != 1 {
		t.Fatalf("sold %d on %d orders, want 1 on 1", row.Sold, row.Orders)
	}
}

// No pairs, or no supplier: nothing asked of the database, nothing answered.
func TestSupplierStoreProductGoods_NothingAskedNothingRead(t *testing.T) {
	f := sgStocked(t)

	for _, c := range []struct {
		supplier uint64
		pairs    []inventory_v1.StoreProduct
	}{
		{sgSumber, nil},
		{0, []inventory_v1.StoreProduct{{StoreID: sgStoreA, ProductID: sgKaos}}},
	} {
		got, err := inventory_v1.SupplierStoreProductGoods(context.Background(), f.db, c.supplier, 0, c.pairs)
		if err != nil || len(got) != 0 {
			t.Fatalf("supplier %d, %d pairs = %v, %v — want nothing", c.supplier, len(c.pairs), got, err)
		}
	}
}
