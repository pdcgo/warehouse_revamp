package main

import (
	"context"
	"reflect"
	"regexp"
	"slices"
	"strings"
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/proto"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_v1"
)

// DISCOVER'S GUDANG, STOK SIAP, HARGA CROSS AND KATEGORI THROUGH THE REAL WIRING (discovers-warehouse-keeps-ready-stock-
// there, discover-ranges-are-picked, a-cross-band-keeps-a-range-that-touches-it, a-picked-branch-keeps-its-whole-
// subtree): ProductDiscover asks inventory's own batches through productStockNarrower and category_service's tree through
// productCategoryTree, and the cards' DiscoverStockByIds reads the same batches — on one database.
//
// Categories: Makanan › Snack › Keripik, and Pakaian. Two selling teams, two warehouses; ready units @ unit cost:
//
//	product    owner    markup  category  Gudang 1          Gudang 2        every warehouse         cross (every / G1 / G2)
//	Kaos       Melati   10%     Pakaian   10 @ 10 000       5 @ 20 000      15                      11–22rb / 11rb / 22rb
//	Keripik    Melati   0%      Keripik   1 @ 25 000        —               1                       25rb / 25rb / —
//	Snack      Melati   25%     Snack     —                 11 @ 8 000      11                      10rb / — / 10rb
//	Kosong     Melati   0%      Makanan   an emptied batch @ 9 000          0 — no cross price
//	Baru       Melati   0%      Makanan   never stocked                     0 — no cross price
//	Jaket      Sinar    10%     Pakaian   100 001 @ 550 000 —               100 001 (past the ceiling)  605rb / 605rb / —
//	Sinar      Sinar    10%     Snack     10 @ 30 000       40 @ 40 000     50                      33–44rb / 33rb / 44rb
//
// Sinar also holds 500 units @ Rp 1 under Keripik's id: not Melati's stock, so they neither add to Keripik's ready nor
// price it.
type discoverFiltersFixture struct {
	db                                                *gorm.DB
	products                                          *product_v1.Service
	inventory                                         *inventory_v1.Service
	kaos, keripik, snack, kosong, baru, jaket, sinars uint64
	makanan, snackCat, keripikCat, pakaian            uint64
}

const (
	dfMelati  uint64 = 9_000_501
	dfSinar   uint64 = 9_000_502
	dfGudang1 uint64 = 9_000_511
	dfGudang2 uint64 = 9_000_512
)

func newDiscoverFiltersFixture(t *testing.T) discoverFiltersFixture {
	t.Helper()

	db := san_testdb.DB(t)
	products := product_v1.NewService(db, nil, nil, NewProductStockNarrower(db), NewProductCategoryTree(db))

	category := func(name string, parent uint64) uint64 {
		var id uint64

		var parentID any
		if parent > 0 {
			parentID = parent
		}

		err := db.Raw(`INSERT INTO categories (name, parent_id) VALUES (?, ?) RETURNING id`, name, parentID).Scan(&id).Error
		if err != nil {
			t.Fatalf("category %s: %v", name, err)
		}

		return id
	}

	f := discoverFiltersFixture{
		db:        db,
		products:  products,
		inventory: inventory_v1.NewService(db, nil, nil, nil, nil, NewInventoryProductReader(products), nil, nil),
	}

	f.makanan = category("Makanan DF", 0)
	f.snackCat = category("Snack DF", f.makanan)
	f.keripikCat = category("Keripik DF", f.snackCat)
	f.pakaian = category("Pakaian DF", 0)

	product := func(team uint64, code, name string, bps int, categoryID uint64) uint64 {
		id := insertCatalogue(t, db, team, code, name, false)

		err := db.Exec(`UPDATE products SET cross_markup_bps = ?, category_id = ? WHERE id = ?`, bps, categoryID, id).Error
		if err != nil {
			t.Fatalf("product %s: %v", code, err)
		}

		return id
	}

	f.kaos = product(dfMelati, "DF-KAOS", "Kaos DF", 1000, f.pakaian)
	f.keripik = product(dfMelati, "DF-KRP", "Keripik DF", 0, f.keripikCat)
	f.snack = product(dfMelati, "DF-SNK", "Snack DF", 2500, f.snackCat)
	f.kosong = product(dfMelati, "DF-KSG", "Kosong DF", 0, f.makanan)
	f.baru = product(dfMelati, "DF-BARU", "Baru DF", 0, f.makanan)
	f.jaket = product(dfSinar, "DF-JKT", "Jaket DF", 1000, f.pakaian)
	f.sinars = product(dfSinar, "DF-SNR", "Sinar DF", 1000, f.snackCat)

	var tx uint64

	err := db.Raw(`INSERT INTO inventory_transactions (warehouse_id, team_id, tx_type, create_by_user_id, description)
		VALUES (?, ?, 'restock', 1, 'discover-filters') RETURNING id`, dfGudang1, dfMelati).Scan(&tx).Error
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

	batch(dfGudang1, dfMelati, f.kaos, 10, 10000)
	batch(dfGudang2, dfMelati, f.kaos, 5, 20000)
	batch(dfGudang1, dfMelati, f.keripik, 1, 25000)
	batch(dfGudang2, dfMelati, f.snack, 11, 8000)
	batch(dfGudang1, dfMelati, f.kosong, 0, 9000)
	batch(dfGudang1, dfSinar, f.jaket, 100001, 550000)
	batch(dfGudang1, dfSinar, f.sinars, 10, 30000)
	batch(dfGudang2, dfSinar, f.sinars, 40, 40000)
	batch(dfGudang1, dfSinar, f.keripik, 500, 1)

	return f
}

// discover runs ProductDiscover as Melati over both teams' catalogues, shaped by `set`; the page's ids, sorted, and the
// total — and the answer, for the cost check.
func (f discoverFiltersFixture) discover(t *testing.T, set func(*productv1.ProductDiscoverRequest)) ([]uint64, uint64, *productv1.ProductDiscoverResponse) {
	t.Helper()

	req := &productv1.ProductDiscoverRequest{
		TeamId:        dfMelati,
		OwnerTeamIds:  []uint64{dfMelati, dfSinar},
		IncludeLocked: true,
		Page:          &commonv1.CommonPagination{Page: 1, Limit: 50},
	}
	set(req)

	res, err := f.products.ProductDiscover(context.Background(), connect.NewRequest(req))
	if err != nil {
		t.Fatalf("ProductDiscover(%v): %v", req, err)
	}

	ids := slices.Clone(res.Msg.GetIds())
	slices.Sort(ids)

	return ids, res.Msg.GetPageInfo().GetTotalItems(), res.Msg
}

func dfIDs(ids ...uint64) []uint64 {
	out := slices.Clone(ids)
	slices.Sort(out)

	return out
}

func dfReady(min int64, max ...int64) *productv1.DiscoverReadyRange {
	r := &productv1.DiscoverReadyRange{Min: min}
	if len(max) > 0 {
		r.Max = &max[0]
	}

	return r
}

func dfCross(min float64, max ...float64) *productv1.DiscoverPriceRange {
	r := &productv1.DiscoverPriceRange{Min: min}
	if len(max) > 0 {
		r.Max = &max[0]
	}

	return r
}

type dfCase struct {
	name string
	set  func(*productv1.ProductDiscoverRequest)
	want []uint64
}

func (f discoverFiltersFixture) run(t *testing.T, cases []dfCase) {
	t.Helper()

	for _, c := range cases {
		ids, total, _ := f.discover(t, c.set)
		if len(ids) != len(c.want) || (len(ids) > 0 && !reflect.DeepEqual(ids, c.want)) || total != uint64(len(c.want)) {
			t.Fatalf("%s: %v (total %d), want %v", c.name, ids, total, c.want)
		}
	}
}

func TestProductDiscover_GudangOverRealStock(t *testing.T) {
	f := newDiscoverFiltersFixture(t)

	f.run(t, []dfCase{
		{"no warehouse — the whole grid, the never-stocked included", func(*productv1.ProductDiscoverRequest) {},
			dfIDs(f.kaos, f.keripik, f.snack, f.kosong, f.baru, f.jaket, f.sinars)},
		{"Gudang 1 — ready there now; the emptied batch is not stock, Sinar's units are not Keripik's", func(r *productv1.ProductDiscoverRequest) {
			r.WarehouseId = dfGudang1
		}, dfIDs(f.kaos, f.keripik, f.jaket, f.sinars)},
		{"Gudang 2", func(r *productv1.ProductDiscoverRequest) { r.WarehouseId = dfGudang2 }, dfIDs(f.kaos, f.snack, f.sinars)},
	})
}

// The page passes its warehouse to the cards: the same product reads that warehouse's ready and cross price, and the
// every-warehouse total the lock reads whatever is picked.
func TestDiscoverStockByIds_TheWarehouseChangesTheFigures(t *testing.T) {
	f := newDiscoverFiltersFixture(t)

	card := func(warehouse uint64) *inventoryv1.DiscoverStockItem {
		res, err := f.inventory.DiscoverStockByIds(context.Background(), connect.NewRequest(&inventoryv1.DiscoverStockByIdsRequest{
			TeamId: dfSinar, ProductIds: []uint64{f.kaos}, WarehouseId: warehouse,
		}))
		if err != nil {
			t.Fatalf("DiscoverStockByIds(warehouse %d): %v", warehouse, err)
		}

		return res.Msg.GetItems()[0]
	}

	for _, c := range []struct {
		warehouse          uint64
		ready, total       int64
		crossMin, crossMax float64
	}{
		{0, 15, 15, 11000, 22000},
		{dfGudang1, 10, 15, 11000, 11000},
		{dfGudang2, 5, 15, 22000, 22000},
	} {
		got := card(c.warehouse)
		if got.GetReadyQty() != c.ready || got.GetTotalReadyQty() != c.total || !got.GetCrossKnown() ||
			got.GetCrossMin() != c.crossMin || got.GetCrossMax() != c.crossMax {
			t.Fatalf("Kaos in warehouse %d: %+v, want ready %d (total %d), cross %v–%v", c.warehouse, got, c.ready, c.total,
				c.crossMin, c.crossMax)
		}
	}
}

func TestProductDiscover_StokSiapOverRealStock(t *testing.T) {
	f := newDiscoverFiltersFixture(t)

	ready := func(r *productv1.DiscoverReadyRange, warehouse uint64) func(*productv1.ProductDiscoverRequest) {
		return func(req *productv1.ProductDiscoverRequest) {
			req.Ready = r
			req.WarehouseId = warehouse
		}
	}

	f.run(t, []dfCase{
		{"1–10 — Keripik is exactly 1 (Sinar's 500 under its id are not its)", ready(dfReady(1, 10), 0), dfIDs(f.keripik)},
		{"11–50 — Snack exactly 11, Sinar exactly 50", ready(dfReady(11, 50), 0), dfIDs(f.kaos, f.snack, f.sinars)},
		{"10.001 and up, the open top band — Jaket's 100 001 is past the ceiling", ready(dfReady(10001), 0), dfIDs(f.jaket)},
		{"Kosong 0–0 — the emptied one AND the never-stocked one", ready(dfReady(0, 0), 0), dfIDs(f.kosong, f.baru)},
		{"0–10 — from 0 keeps the no-stock products too", ready(dfReady(0, 10), 0), dfIDs(f.keripik, f.kosong, f.baru)},
		{"Gudang 1 + 0–10 — ready there: Kaos exactly 10, Sinar 10; no stock there is no product there",
			ready(dfReady(0, 10), dfGudang1), dfIDs(f.kaos, f.keripik, f.sinars)},
		{"Gudang 2 + 11–50 — Kaos is only 5 there", ready(dfReady(11, 50), dfGudang2), dfIDs(f.snack, f.sinars)},
		{"Gudang 1 + Kosong — ready there and empty there is nobody", ready(dfReady(0, 0), dfGudang1), []uint64{}},
	})
}

func TestProductDiscover_HargaCrossOverRealStock(t *testing.T) {
	f := newDiscoverFiltersFixture(t)

	cross := func(r *productv1.DiscoverPriceRange, warehouse uint64) func(*productv1.ProductDiscoverRequest) {
		return func(req *productv1.ProductDiscoverRequest) {
			req.CrossPrice = r
			req.WarehouseId = warehouse
		}
	}

	f.run(t, []dfCase{
		{"≤ 10rb — Snack's cross is exactly 10 000 (8 000 + 25%); Sinar's Rp 1 units never price Keripik; nothing for the no-stock ones",
			cross(dfCross(0, 10000), 0), dfIDs(f.snack)},
		{"10–25rb — Kaos 11–22rb, Keripik exactly 25 000, Snack exactly 10 000", cross(dfCross(10000, 25000), 0),
			dfIDs(f.kaos, f.keripik, f.snack)},
		{"20–30rb — Kaos's 11–22rb straddles the lower edge", cross(dfCross(20000, 30000), 0), dfIDs(f.kaos, f.keripik)},
		{"25–50rb", cross(dfCross(25000, 50000), 0), dfIDs(f.keripik, f.sinars)},
		{"500rb and up, the open top band", cross(dfCross(500000), 0), dfIDs(f.jaket)},
		{"Gudang 1 + 20–30rb — Kaos is 11rb there", cross(dfCross(20000, 30000), dfGudang1), dfIDs(f.keripik)},
		{"Gudang 2 + 20–30rb — Kaos is 22rb there", cross(dfCross(20000, 30000), dfGudang2), dfIDs(f.kaos)},
	})
}

func TestProductDiscover_KategoriOverTheRealTree(t *testing.T) {
	f := newDiscoverFiltersFixture(t)

	category := func(id uint64) func(*productv1.ProductDiscoverRequest) {
		return func(r *productv1.ProductDiscoverRequest) { r.CategoryId = id }
	}

	f.run(t, []dfCase{
		{"Makanan — the whole branch, both teams", category(f.makanan), dfIDs(f.keripik, f.snack, f.kosong, f.baru, f.sinars)},
		{"Snack — itself and Keripik below it", category(f.snackCat), dfIDs(f.keripik, f.snack, f.sinars)},
		{"Keripik — an end category, itself alone", category(f.keripikCat), dfIDs(f.keripik)},
		{"Pakaian", category(f.pakaian), dfIDs(f.kaos, f.jaket)},
	})
}

// Every filter at once, and with Kunci: they intersect.
func TestProductDiscover_TheFiltersTogether(t *testing.T) {
	f := newDiscoverFiltersFixture(t)

	err := f.db.Exec(`UPDATE products SET reserved_stock = 20 WHERE id IN (?, ?)`, f.keripik, f.sinars).Error
	if err != nil {
		t.Fatalf("minimums: %v", err)
	}

	f.run(t, []dfCase{
		{"Gudang 1 + 1–10 + 10–25rb + Makanan — Keripik; Sinar is 33rb there", func(r *productv1.ProductDiscoverRequest) {
			r.WarehouseId = dfGudang1
			r.Ready = dfReady(1, 10)
			r.CrossPrice = dfCross(10000, 25000)
			r.CategoryId = f.makanan
		}, dfIDs(f.keripik)},
		{"Makanan + Terkunci — Keripik (1 under its 20); Sinar holds 50 of its 20, open", func(r *productv1.ProductDiscoverRequest) {
			r.CategoryId = f.makanan
			r.Filter = &productv1.ProductListFilter{Lock: productv1.ProductLockFilter_PRODUCT_LOCK_FILTER_CLOSED}
		}, dfIDs(f.keripik)},
		{"Gudang 2 + Terbuka — the lock reads every warehouse, the grid that warehouse", func(r *productv1.ProductDiscoverRequest) {
			r.WarehouseId = dfGudang2
			r.Filter = &productv1.ProductListFilter{Lock: productv1.ProductLockFilter_PRODUCT_LOCK_FILTER_ORDERABLE}
		}, dfIDs(f.kaos, f.snack, f.sinars)},
	})
}

// NO COST IN ANY ANSWER (discover-shows-the-cross-price): the shelves' cost spread crosses only the in-process seam —
// neither ProductDiscover nor the cards' DiscoverStockByIds carries a cost field or a cost figure.
func TestDiscover_NoCostInAnyAnswer(t *testing.T) {
	f := newDiscoverFiltersFixture(t)

	// Kaos's and Sinar's unit costs as a JSON NUMBER — none of them is any figure these answers should carry (their cross
	// prices are 11 000 – 22 000 and 33 000 – 44 000). Ids are uint64, quoted strings in JSON, so they never match.
	costs := regexp.MustCompile(`[:\[,](10000|20000|30000|40000)[,\]}]`)

	check := func(name string, m proto.Message) {
		raw, err := protojson.Marshal(m)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}

		text := string(raw)
		if strings.Contains(strings.ToLower(text), "cost") || costs.MatchString(text) {
			t.Fatalf("%s carries a cost: %s", name, text)
		}
	}

	for _, set := range []func(*productv1.ProductDiscoverRequest){
		func(r *productv1.ProductDiscoverRequest) { r.WarehouseId = dfGudang1 },
		func(r *productv1.ProductDiscoverRequest) { r.CrossPrice = dfCross(10000, 50000) },
		func(r *productv1.ProductDiscoverRequest) {
			r.CrossPrice = dfCross(10000, 50000)
			r.Ready = dfReady(1, 50)
			r.WarehouseId = dfGudang2
		},
	} {
		_, _, res := f.discover(t, set)
		check("ProductDiscover", res)
	}

	for _, warehouse := range []uint64{0, dfGudang1, dfGudang2} {
		res, err := f.inventory.DiscoverStockByIds(context.Background(), connect.NewRequest(&inventoryv1.DiscoverStockByIdsRequest{
			TeamId: dfSinar, ProductIds: []uint64{f.kaos, f.sinars}, WarehouseId: warehouse,
		}))
		if err != nil {
			t.Fatalf("DiscoverStockByIds: %v", err)
		}

		check("DiscoverStockByIds", res.Msg)
	}
}
