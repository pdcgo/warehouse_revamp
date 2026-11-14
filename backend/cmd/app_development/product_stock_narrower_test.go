package main

import (
	"context"
	"reflect"
	"slices"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_v1"
)

// THE PRODUCT LIST'S KUNCI AND UMUR STOK THROUGH THE REAL WIRING (lock-and-stock-age-filter-ahead-of-the-contract):
// product_service's ProductList asks inventory's own batches through the composition root's productStockNarrower — the
// only place the catalogue and the batch ledger meet one database together.
//
// Melati's catalogue (all figures READY units; ages counted from the fixed clock):
//
//	product              lock              Gudang 1        Gudang 2        total   oldest ready   locked now?
//	Kaos Terbuka         open              30 · 40 days    20 · 65 days    50      65 days        —
//	Kaos Min Kurang      min 20            10 · 70 days     9 · 2 days     19      70 days        yes (19 < 20)
//	Celana Min Pas       min 20            20 · 95 days                    20      95 days        no — AT its minimum
//	Celana Min Lebih     min 20            21 · 5 days  (+ an emptied batch 300 days old)  21  5   no
//	Celana Min Kosong    min 5             —                               0       no age         yes (nothing < 5)
//	Kaos Selalu          always, min 3     —                               0       no age         no — always, not a minimum
//	Kaos Arsip           min 7, archived   —                               0       no age         yes, on the archive
//
// Sinar (another selling team) holds 100 units under Kaos Min Kurang's id and a 200-day-old batch under Celana Min
// Lebih's: neither is Melati's stock, so neither opens the one nor ages the other. Sinar's own Kaos Sinar (min 2, none)
// is locked now — in Sinar's list only.
type narrowerFixture struct {
	db                                       *gorm.DB
	svc                                      *product_v1.Service
	open, under, at, over, empty, always, ar uint64
	sinars                                   uint64
}

const (
	nfMelati  uint64 = 9_000_401
	nfSinar   uint64 = 9_000_402
	nfGudang1 uint64 = 9_000_411
	nfGudang2 uint64 = 9_000_412
)

func newNarrowerFixture(t *testing.T) narrowerFixture {
	t.Helper()

	db := san_testdb.DB(t)
	now := time.Date(2026, 11, 14, 9, 0, 0, 0, time.UTC)
	ago := func(days int) time.Time { return now.AddDate(0, 0, -days).Add(-time.Hour) }

	f := narrowerFixture{
		db:     db,
		svc:    product_v1.NewService(db, nil, nil, productStockNarrower{db: db, now: func() time.Time { return now }}, nil),
		open:   insertCatalogue(t, db, nfMelati, "NF-KAOS-1", "Kaos Terbuka", false),
		under:  insertCatalogue(t, db, nfMelati, "NF-KAOS-2", "Kaos Min Kurang", false),
		at:     insertCatalogue(t, db, nfMelati, "NF-CEL-1", "Celana Min Pas", false),
		over:   insertCatalogue(t, db, nfMelati, "NF-CEL-2", "Celana Min Lebih", false),
		empty:  insertCatalogue(t, db, nfMelati, "NF-CEL-3", "Celana Min Kosong", false),
		always: insertCatalogue(t, db, nfMelati, "NF-KAOS-3", "Kaos Selalu", false),
		ar:     insertCatalogue(t, db, nfMelati, "NF-KAOS-4", "Kaos Arsip", true),
		sinars: insertCatalogue(t, db, nfSinar, "NF-SN-1", "Kaos Sinar", false),
	}

	lock := func(id uint64, crossLocked bool, minimum uint32) {
		err := db.Exec(`UPDATE products SET cross_locked = ?, reserved_stock = ? WHERE id = ?`, crossLocked, minimum, id).Error
		if err != nil {
			t.Fatalf("lock %d: %v", id, err)
		}
	}

	lock(f.under, false, 20)
	lock(f.at, false, 20)
	lock(f.over, false, 20)
	lock(f.empty, false, 5)
	lock(f.always, true, 3)
	lock(f.ar, false, 7)
	lock(f.sinars, false, 2)

	tx := nfTransaction(t, db)

	nfBatch(t, db, tx, nfGudang1, nfMelati, f.open, 30, ago(40))
	nfBatch(t, db, tx, nfGudang2, nfMelati, f.open, 20, ago(65))
	nfBatch(t, db, tx, nfGudang1, nfMelati, f.under, 10, ago(70))
	nfBatch(t, db, tx, nfGudang2, nfMelati, f.under, 9, ago(2))
	nfBatch(t, db, tx, nfGudang1, nfMelati, f.at, 20, ago(95))
	nfBatch(t, db, tx, nfGudang1, nfMelati, f.over, 21, ago(5))
	nfBatch(t, db, tx, nfGudang1, nfMelati, f.over, 0, ago(300))
	nfBatch(t, db, tx, nfGudang1, nfSinar, f.under, 100, ago(1))
	nfBatch(t, db, tx, nfGudang1, nfSinar, f.over, 4, ago(200))

	return f
}

func nfTransaction(t *testing.T, db *gorm.DB) uint64 {
	t.Helper()

	var id uint64

	err := db.Raw(`INSERT INTO inventory_transactions (warehouse_id, team_id, tx_type, create_by_user_id, description)
		VALUES (?, ?, 'restock', 1, 'product-list-filters') RETURNING id`, nfGudang1, nfMelati).Scan(&id).Error
	if err != nil {
		t.Fatalf("seed transaction: %v", err)
	}

	return id
}

func nfBatch(t *testing.T, db *gorm.DB, tx, warehouse, team, product uint64, count int64, arrived time.Time) {
	t.Helper()

	err := db.Exec(`INSERT INTO batches (warehouse_id, team_id, product_id, transaction_id, price_unit, stock_count,
		stock_valuation, init_stock_count, init_stock_valuation, created_at)
		VALUES (?, ?, ?, ?, 1000, ?, ?, ?, ?, ?)`,
		warehouse, team, product, tx, count, float64(count)*1000, count+1, float64(count+1)*1000, arrived).Error
	if err != nil {
		t.Fatalf("seed batch of %d: %v", product, err)
	}
}

// list is one ProductList call; it returns the page's ids (sorted by id unless the request sorts) and the total.
func (f narrowerFixture) list(t *testing.T, team uint64, filter *productv1.ProductListFilter, lens uint64) ([]uint64, uint64) {
	t.Helper()

	res, err := f.svc.ProductList(context.Background(), connect.NewRequest(&productv1.ProductListRequest{
		TeamId:           team,
		Filter:           filter,
		StockWarehouseId: lens,
		Page:             &commonv1.CommonPagination{Page: 1, Limit: 50},
	}))
	if err != nil {
		t.Fatalf("ProductList(%v, lens %d): %v", filter, lens, err)
	}

	ids := slices.Clone(res.Msg.GetIds())
	slices.Sort(ids)

	return ids, res.Msg.GetPageInfo().GetTotalItems()
}

func nfIDs(ids ...uint64) []uint64 {
	out := slices.Clone(ids)
	slices.Sort(out)

	return out
}

const (
	nfOpen    = productv1.ProductLockFilter_PRODUCT_LOCK_FILTER_MODE_OPEN
	nfMinimum = productv1.ProductLockFilter_PRODUCT_LOCK_FILTER_MODE_MINIMUM
	nfAlways  = productv1.ProductLockFilter_PRODUCT_LOCK_FILTER_MODE_ALWAYS
	nfNow     = productv1.ProductLockFilter_PRODUCT_LOCK_FILTER_LOCKED_NOW
)

func TestProductStockNarrower_TheListsLockAndAgeFilters(t *testing.T) {
	f := newNarrowerFixture(t)
	archived := productv1.ProductStatus_PRODUCT_STATUS_ARCHIVED

	cases := []struct {
		name   string
		team   uint64
		filter *productv1.ProductListFilter
		lens   uint64
		want   []uint64
	}{
		{"nothing picked", nfMelati, nil, 0, nfIDs(f.open, f.under, f.at, f.over, f.empty, f.always)},

		// Kunci — the three ways.
		{"Terbuka", nfMelati, &productv1.ProductListFilter{Lock: nfOpen}, 0, nfIDs(f.open)},
		{"Stok minimum", nfMelati, &productv1.ProductListFilter{Lock: nfMinimum}, 0, nfIDs(f.under, f.at, f.over, f.empty)},
		{"Selalu dikunci", nfMelati, &productv1.ProductListFilter{Lock: nfAlways}, 0, nfIDs(f.always)},

		// Terkunci sekarang: under the minimum across every warehouse — never AT it, and an empty shelf is under any.
		{"Terkunci sekarang", nfMelati, &productv1.ProductListFilter{Lock: nfNow}, 0, nfIDs(f.under, f.empty)},
		{"Terkunci sekarang + q", nfMelati, &productv1.ProductListFilter{Lock: nfNow, Q: "kaos"}, 0, nfIDs(f.under)},
		{"Terkunci sekarang under a lens — the lens never narrows the lock", nfMelati, &productv1.ProductListFilter{Lock: nfNow}, nfGudang2, nfIDs(f.under, f.empty)},
		{"Terkunci sekarang on the archive", nfMelati, &productv1.ProductListFilter{Lock: nfNow, Status: archived}, 0, nfIDs(f.ar)},

		// Umur stok — the oldest READY batch; an empty shelf has no age.
		{"30 days or more", nfMelati, &productv1.ProductListFilter{StockAgeMinDays: 30}, 0, nfIDs(f.open, f.under, f.at)},
		{"60 days or more", nfMelati, &productv1.ProductListFilter{StockAgeMinDays: 60}, 0, nfIDs(f.open, f.under, f.at)},
		{"90 days or more", nfMelati, &productv1.ProductListFilter{StockAgeMinDays: 90}, 0, nfIDs(f.at)},
		{"60 days in Gudang 1", nfMelati, &productv1.ProductListFilter{StockAgeMinDays: 60}, nfGudang1, nfIDs(f.under, f.at)},
		{"60 days in Gudang 2", nfMelati, &productv1.ProductListFilter{StockAgeMinDays: 60}, nfGudang2, nfIDs(f.open)},
		{"30 days in Gudang 2", nfMelati, &productv1.ProductListFilter{StockAgeMinDays: 30}, nfGudang2, nfIDs(f.open)},
		{"30 days + q", nfMelati, &productv1.ProductListFilter{StockAgeMinDays: 30, Q: "celana"}, 0, nfIDs(f.at)},

		// Both at once.
		{"60 days + Stok minimum", nfMelati, &productv1.ProductListFilter{StockAgeMinDays: 60, Lock: nfMinimum}, 0, nfIDs(f.under, f.at)},
		{"60 days + Terkunci sekarang", nfMelati, &productv1.ProductListFilter{StockAgeMinDays: 60, Lock: nfNow}, 0, nfIDs(f.under)},
		{"90 days + Terkunci sekarang — nothing", nfMelati, &productv1.ProductListFilter{StockAgeMinDays: 90, Lock: nfNow}, 0, nil},
		{"30 days + Terbuka + q — nothing", nfMelati, &productv1.ProductListFilter{StockAgeMinDays: 30, Lock: nfOpen, Q: "celana"}, 0, nil},

		// Another team reads only its own products' facts.
		{"Sinar, Terkunci sekarang", nfSinar, &productv1.ProductListFilter{Lock: nfNow}, 0, nfIDs(f.sinars)},
		{"Sinar, 30 days", nfSinar, &productv1.ProductListFilter{StockAgeMinDays: 30}, 0, nil},
	}

	for _, c := range cases {
		got, total := f.list(t, c.team, c.filter, c.lens)
		if len(got) == 0 && len(c.want) == 0 && total == 0 {
			continue
		}

		if !reflect.DeepEqual(got, c.want) || total != uint64(len(c.want)) {
			t.Errorf("%s: ids %v (total %d), want %v", c.name, got, total, c.want)
		}
	}
}

// One unit received into the product under its minimum opens it — the filter reads the shelf as it is now; one more
// unit in the product AT its minimum changes nothing, and one taken off closes it.
func TestProductStockNarrower_LockedNowFollowsTheShelf(t *testing.T) {
	f := newNarrowerFixture(t)

	err := f.db.Exec(`UPDATE batches SET stock_count = stock_count + 1 WHERE product_id = ? AND team_id = ? AND warehouse_id = ?`,
		f.under, nfMelati, nfGudang2).Error
	if err != nil {
		t.Fatalf("receive one: %v", err)
	}

	err = f.db.Exec(`UPDATE batches SET stock_count = stock_count - 1 WHERE product_id = ? AND team_id = ?`, f.at, nfMelati).Error
	if err != nil {
		t.Fatalf("take one: %v", err)
	}

	got, _ := f.list(t, nfMelati, &productv1.ProductListFilter{Lock: nfNow}, 0)
	if !reflect.DeepEqual(got, nfIDs(f.at, f.empty)) {
		t.Fatalf("after the moves: %v, want Celana Min Pas (19 < 20) and Celana Min Kosong — Kaos Min Kurang opened at 20", got)
	}
}
