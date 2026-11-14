package inventory_v1_test

import (
	"context"
	"reflect"
	"testing"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
)

// DISCOVER'S SHELF FILTERS (ShelvedProducts, ProductsReadyAbove): Gudang keeps what holds ready units in that warehouse
// now (discovers-warehouse-keeps-ready-stock-there); Stok siap bounds those units, both ends included
// (discover-ranges-are-picked); the cost spread is DiscoverStockByIds' own — MIN/MAX of the batches holding units.
//
//	product   owner    Gudang 1                 Gudang 2           every warehouse
//	kaos      Melati   10 @ 1 000 · 5 @ 3 000   6 @ 2 000          21 · cost 1 000–3 000
//	celana    Melati   —  (an emptied @ 9 000)  100 @ 50 000       100 · 50 000 (the emptied batch prices nothing)
//	topi      Melati   1 @ 500                  —                  1
//	none      Melati   never stocked                               —
//	sinars    Sinar    40 @ 7 000               —                  40
const (
	snMelati  uint64 = 9_310_001
	snSinar   uint64 = 9_310_002
	snGudang1 uint64 = 9_310_011
	snGudang2 uint64 = 9_310_012

	snKaos   uint64 = 9_310_101
	snCelana uint64 = 9_310_102
	snTopi   uint64 = 9_310_103
	snNone   uint64 = 9_310_104
	snSinars uint64 = 9_310_201
)

func snSeed(t *testing.T, db *gorm.DB) {
	t.Helper()

	var tx uint64

	err := db.Raw(`INSERT INTO inventory_transactions (warehouse_id, team_id, tx_type, create_by_user_id, description)
		VALUES (?, ?, 'restock', 1, 'discover-shelf') RETURNING id`, snGudang1, snMelati).Scan(&tx).Error
	if err != nil {
		t.Fatalf("seed transaction: %v", err)
	}

	batch := func(warehouse, team, product uint64, count int64, cost float64) {
		err := db.Exec(`INSERT INTO batches (warehouse_id, team_id, product_id, transaction_id, price_unit, stock_count,
			stock_valuation, init_stock_count, init_stock_valuation)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			warehouse, team, product, tx, cost, count, float64(count)*cost, count+1, float64(count+1)*cost).Error
		if err != nil {
			t.Fatalf("seed batch of %d: %v", product, err)
		}
	}

	batch(snGudang1, snMelati, snKaos, 10, 1000)
	batch(snGudang1, snMelati, snKaos, 5, 3000)
	batch(snGudang2, snMelati, snKaos, 6, 2000)
	batch(snGudang1, snMelati, snCelana, 0, 9000)
	batch(snGudang2, snMelati, snCelana, 100, 50000)
	batch(snGudang1, snMelati, snTopi, 1, 500)
	batch(snGudang1, snSinar, snSinars, 40, 7000)
}

// ours keeps the fixture's rows — the test database may hold other suites' committed batches.
func ours(rows []inventory_v1.ShelvedProduct) []inventory_v1.ShelvedProduct {
	out := []inventory_v1.ShelvedProduct{}

	for _, r := range rows {
		if r.TeamID == snMelati || r.TeamID == snSinar {
			out = append(out, r)
		}
	}

	return out
}

func i64(v int64) *int64 { return &v }

func f64(v float64) *float64 { return &v }

func TestShelvedProducts_TheWarehouseAndTheReadyRange(t *testing.T) {
	db := san_testdb.DB(t)
	snSeed(t, db)
	ctx := context.Background()

	kaos := inventory_v1.ShelvedProduct{TeamID: snMelati, ProductID: snKaos, CostMin: 1000, CostMax: 3000}
	kaos1 := inventory_v1.ShelvedProduct{TeamID: snMelati, ProductID: snKaos, CostMin: 1000, CostMax: 3000}
	kaos2 := inventory_v1.ShelvedProduct{TeamID: snMelati, ProductID: snKaos, CostMin: 2000, CostMax: 2000}
	celana := inventory_v1.ShelvedProduct{TeamID: snMelati, ProductID: snCelana, CostMin: 50000, CostMax: 50000}
	topi := inventory_v1.ShelvedProduct{TeamID: snMelati, ProductID: snTopi, CostMin: 500, CostMax: 500}
	sinars := inventory_v1.ShelvedProduct{TeamID: snSinar, ProductID: snSinars, CostMin: 7000, CostMax: 7000}

	cases := []struct {
		name string
		ask  inventory_v1.ShelfAsk
		want []inventory_v1.ShelvedProduct
	}{
		{"every warehouse — whatever holds ready units, two teams; never the unstocked one", inventory_v1.ShelfAsk{},
			[]inventory_v1.ShelvedProduct{kaos, celana, topi, sinars}},
		{"Gudang 1 — the emptied celana batch is not stock there", inventory_v1.ShelfAsk{WarehouseID: snGudang1},
			[]inventory_v1.ShelvedProduct{kaos1, topi, sinars}},
		{"Gudang 2 — its own spread for kaos", inventory_v1.ShelfAsk{WarehouseID: snGudang2},
			[]inventory_v1.ShelvedProduct{kaos2, celana}},
		{"1–21, ends included — kaos is exactly 21, topi exactly 1", inventory_v1.ShelfAsk{ReadyMin: i64(1), ReadyMax: i64(21)},
			[]inventory_v1.ShelvedProduct{kaos, topi}},
		{"22 and up, open — the top band", inventory_v1.ShelfAsk{ReadyMin: i64(22)},
			[]inventory_v1.ShelvedProduct{celana, sinars}},
		{"Gudang 1, 11–50: kaos is 15 there", inventory_v1.ShelfAsk{WarehouseID: snGudang1, ReadyMin: i64(11), ReadyMax: i64(50)},
			[]inventory_v1.ShelvedProduct{kaos1, sinars}},
		{"Gudang 2, 11–50: kaos is only 6 there", inventory_v1.ShelfAsk{WarehouseID: snGudang2, ReadyMin: i64(11), ReadyMax: i64(50)},
			[]inventory_v1.ShelvedProduct{}},
	}

	for _, c := range cases {
		got, err := inventory_v1.ShelvedProducts(ctx, db, c.ask)
		if err != nil {
			t.Fatalf("%s: %v", c.name, err)
		}

		if got := ours(got); !reflect.DeepEqual(got, c.want) {
			t.Fatalf("%s:\n got %+v\nwant %+v", c.name, got, c.want)
		}
	}
}

// The cost cut keeps a spread that touches it — MIN <= at most, MAX >= at least, both ends included.
func TestShelvedProducts_TheCostCut(t *testing.T) {
	db := san_testdb.DB(t)
	snSeed(t, db)
	ctx := context.Background()

	ids := func(ask inventory_v1.ShelfAsk) []uint64 {
		got, err := inventory_v1.ShelvedProducts(ctx, db, ask)
		if err != nil {
			t.Fatalf("%+v: %v", ask, err)
		}

		out := []uint64{}
		for _, r := range ours(got) {
			out = append(out, r.ProductID)
		}

		return out
	}

	// kaos 1 000–3 000 straddles 2 500: kept by "at most 2 500" (its cheapest is under) and by "at least 2 500".
	if got := ids(inventory_v1.ShelfAsk{CostAtMost: f64(2500)}); !reflect.DeepEqual(got, []uint64{snKaos, snTopi}) {
		t.Fatalf("at most 2 500: %v", got)
	}

	if got := ids(inventory_v1.ShelfAsk{CostAtLeast: f64(2500)}); !reflect.DeepEqual(got, []uint64{snKaos, snCelana, snSinars}) {
		t.Fatalf("at least 2 500: %v", got)
	}

	// Exactly at the edges: 3 000 at least keeps kaos (its dearest IS 3 000); 500 at most keeps topi.
	if got := ids(inventory_v1.ShelfAsk{CostAtLeast: f64(3000), CostAtMost: f64(7000)}); !reflect.DeepEqual(got, []uint64{snKaos, snSinars}) {
		t.Fatalf("3 000–7 000: %v", got)
	}

	if got := ids(inventory_v1.ShelfAsk{CostAtMost: f64(500)}); !reflect.DeepEqual(got, []uint64{snTopi}) {
		t.Fatalf("at most 500: %v", got)
	}

	// In one warehouse the spread is that warehouse's: kaos in Gudang 2 is 2 000 alone, under 2 500.
	if got := ids(inventory_v1.ShelfAsk{WarehouseID: snGudang2, CostAtLeast: f64(2500)}); !reflect.DeepEqual(got, []uint64{snCelana}) {
		t.Fatalf("Gudang 2, at least 2 500: %v", got)
	}
}

// A Stok siap range from 0 asks the complement: whatever holds MORE than its top, across every warehouse.
func TestProductsReadyAbove(t *testing.T) {
	db := san_testdb.DB(t)
	snSeed(t, db)

	got, err := inventory_v1.ProductsReadyAbove(context.Background(), db, 21)
	if err != nil {
		t.Fatalf("ready above 21: %v", err)
	}

	want := []inventory_v1.ShelvedProduct{
		{TeamID: snMelati, ProductID: snCelana},
		{TeamID: snSinar, ProductID: snSinars},
	}

	if got := ours(got); !reflect.DeepEqual(got, want) {
		t.Fatalf("ready above 21 (kaos is exactly 21, so stays in 0–21): %+v", got)
	}

	got, err = inventory_v1.ProductsReadyAbove(context.Background(), db, 0)
	if err != nil {
		t.Fatalf("ready above 0: %v", err)
	}

	if got := ours(got); len(got) != 4 {
		t.Fatalf("ready above 0 = whatever holds a unit (4 products; never the unstocked one): %+v", got)
	}
}
