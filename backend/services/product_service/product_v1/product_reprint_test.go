package product_v1_test

import (
	"context"
	"slices"
	"testing"
	"time"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_service_models"
	product_v1 "github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_v1"
)

// THE REPRINT OF CHANGED CODES — product_service's half (backlog #151; products-have-their-own-tag-list, its 🔄 *what
// clears*): the waits #149 writes are read per warehouse, cleared by that warehouse's recorded print for the products
// printed with their LIVE code — the tag off after the last — and added for a warehouse a tagged product arrives in.
// The rows are seeded directly here; cmd/app_development drives the real code change, shelves and transfers.

const (
	rpTeam uint64 = 7201
	rpWhA  uint64 = 7211
	rpWhB  uint64 = 7212
	rpWhC  uint64 = 7213
)

func rpService(db *gorm.DB) *product_v1.Service {
	return product_v1.NewService(db, history, teamCodes, nil, nil)
}

// rpWaiting tags the product `need_reprint_code` and makes it wait for the warehouses — as the code change leaves it.
func rpWaiting(t *testing.T, db *gorm.DB, product uint64, warehouses ...uint64) {
	t.Helper()

	for _, w := range warehouses {
		err := db.Create(&product_service_models.ProductReprintWait{ProductID: product, WarehouseID: w, Since: time.Now()}).Error
		if err != nil {
			t.Fatal(err)
		}
	}

	err := db.Exec(`INSERT INTO product_tag_links (product_id, tag_id, added_by_user_id, added_by_is_override, added_at)
		SELECT ?, id, 0, false, NOW() FROM product_tags WHERE app_task = ?`, product, product_v1.AppTaskReprintCode).Error
	if err != nil {
		t.Fatal(err)
	}
}

func rpCodeChanged(t *testing.T, db *gorm.DB, product uint64, oldCode, newCode string) {
	t.Helper()

	err := db.Create(&product_service_models.ProductLog{
		ProductID: product, Kind: product_service_models.ProductLogCodeChanged, OldCode: oldCode, NewCode: newCode,
	}).Error
	if err != nil {
		t.Fatal(err)
	}
}

func rpTagged(t *testing.T, db *gorm.DB, product uint64) bool {
	t.Helper()

	var n int64

	err := db.Raw(`SELECT COUNT(*) FROM product_tag_links l JOIN product_tags g ON g.id = l.tag_id
		WHERE l.product_id = ? AND g.app_task = ?`, product, product_v1.AppTaskReprintCode).Scan(&n).Error
	if err != nil {
		t.Fatal(err)
	}

	return n > 0
}

func rpWaitsOf(t *testing.T, db *gorm.DB, product uint64) []uint64 {
	t.Helper()

	var ws []uint64

	err := db.Raw("SELECT warehouse_id FROM product_reprint_waits WHERE product_id = ? ORDER BY warehouse_id", product).Scan(&ws).Error
	if err != nil {
		t.Fatal(err)
	}

	return ws
}

func rpRecord(t *testing.T, db *gorm.DB, svc *product_v1.Service, warehouse uint64, printed ...product_v1.ReprintPrinted) product_v1.ReprintRecorded {
	t.Helper()

	got, err := svc.RecordReprint(context.Background(), db, warehouse, printed)
	if err != nil {
		t.Fatalf("RecordReprint: %v", err)
	}

	return got
}

// THE LIST — one warehouse's waits only, by live code then id, paged, each with its FORMER code: the newest
// `code_changed` line's old code (two changes before a reprint name the one before the last). A page past the end still
// says how many wait.
func TestReprintWaitsOf_OneWarehousesWaitsByCodeWithTheFormerCode(t *testing.T) {
	db := san_testdb.DB(t)
	svc := rpService(db)

	b := insertProduct(t, db, rpTeam, "RP-XYZ-B", "Bravo")
	a := insertProduct(t, db, rpTeam, "RP-XYZ-A", "Alfa")
	c := insertProduct(t, db, rpTeam, "RP-XYZ-C", "Charlie")
	elsewhere := insertProduct(t, db, rpTeam, "RP-XYZ-D", "Delta")

	rpWaiting(t, db, b, rpWhA)
	rpWaiting(t, db, a, rpWhA, rpWhB)
	rpWaiting(t, db, c, rpWhA)
	rpWaiting(t, db, elsewhere, rpWhB)

	rpCodeChanged(t, db, a, "RP-ABC-A", "RP-QWE-A")
	rpCodeChanged(t, db, a, "RP-QWE-A", "RP-XYZ-A")
	rpCodeChanged(t, db, b, "RP-ABC-B", "RP-XYZ-B")

	page, total, err := svc.ReprintWaitsOf(context.Background(), rpWhA, 0, 2)
	if err != nil {
		t.Fatal(err)
	}

	want := []product_v1.ReprintWait{
		{ProductID: a, ProductCode: "RP-XYZ-A", Name: "Alfa", FormerCode: "RP-QWE-A"},
		{ProductID: b, ProductCode: "RP-XYZ-B", Name: "Bravo", FormerCode: "RP-ABC-B"},
	}
	if total != 3 || !slices.Equal(page, want) {
		t.Fatalf("page 1 = %+v (total %d), want %+v of 3", page, total, want)
	}

	page, total, err = svc.ReprintWaitsOf(context.Background(), rpWhA, 2, 2)
	if err != nil {
		t.Fatal(err)
	}

	// No code_changed line: the former code is empty.
	if total != 3 || len(page) != 1 || page[0].ProductID != c || page[0].FormerCode != "" {
		t.Fatalf("page 2 = %+v (total %d), want Charlie with no former code", page, total)
	}

	past, total, err := svc.ReprintWaitsOf(context.Background(), rpWhA, 10, 2)
	if err != nil || len(past) != 0 || total != 3 {
		t.Fatalf("past the end = %+v, total %d, err %v — want none of 3", past, total, err)
	}

	n, err := svc.ReprintWaitingCount(context.Background(), rpWhB)
	if err != nil || n != 2 {
		t.Fatalf("B's count = %d (%v), want 2", n, err)
	}
}

// THE RECORD — this warehouse's wait cleared for a product printed with its live code; the tag off only once no
// warehouse waits; a product printed with an older code untouched and named; an unknown product and a duplicate entry
// harmless; a second record changes nothing.
func TestRecordReprint_ClearsThisWarehouseAndTakesTheTagOffAfterTheLast(t *testing.T) {
	db := san_testdb.DB(t)
	svc := rpService(db)

	both := insertProduct(t, db, rpTeam, "RP-XYZ-BOTH", "Dua gudang")
	alone := insertProduct(t, db, rpTeam, "RP-XYZ-ALONE", "Satu gudang")
	moved := insertProduct(t, db, rpTeam, "RP-QWE-MOVED", "Berganti lagi")

	rpWaiting(t, db, both, rpWhA, rpWhB)
	rpWaiting(t, db, alone, rpWhA)
	rpWaiting(t, db, moved, rpWhA)

	got := rpRecord(t, db, svc, rpWhA,
		product_v1.ReprintPrinted{ProductID: both, ProductCode: "RP-XYZ-BOTH"},
		product_v1.ReprintPrinted{ProductID: alone, ProductCode: "RP-XYZ-ALONE"},
		product_v1.ReprintPrinted{ProductID: alone, ProductCode: "RP-XYZ-ALONE"},
		product_v1.ReprintPrinted{ProductID: moved, ProductCode: "RP-XYZ-MOVED"},
		product_v1.ReprintPrinted{ProductID: 99_999_999, ProductCode: "NOPE"},
	)

	if !slices.Equal(got.Cleared, []uint64{both, alone}) || !slices.Equal(got.Untagged, []uint64{alone}) ||
		!slices.Equal(got.CodeChanged, []uint64{moved}) {
		t.Fatalf("record = %+v, want cleared both+alone, untagged alone, code changed moved", got)
	}

	if !rpTagged(t, db, both) || !slices.Equal(rpWaitsOf(t, db, both), []uint64{rpWhB}) {
		t.Errorf("both: tagged %v waits %v, want tagged, B waiting", rpTagged(t, db, both), rpWaitsOf(t, db, both))
	}

	if rpTagged(t, db, alone) || len(rpWaitsOf(t, db, alone)) != 0 {
		t.Errorf("alone: still tagged or waiting")
	}

	if !rpTagged(t, db, moved) || !slices.Equal(rpWaitsOf(t, db, moved), []uint64{rpWhA}) {
		t.Errorf("moved: tagged %v waits %v, want untouched", rpTagged(t, db, moved), rpWaitsOf(t, db, moved))
	}

	again := rpRecord(t, db, svc, rpWhA, product_v1.ReprintPrinted{ProductID: alone, ProductCode: "RP-XYZ-ALONE"})
	if len(again.Cleared) != 0 || len(again.Untagged) != 0 || len(again.CodeChanged) != 0 {
		t.Errorf("a second record = %+v, want nothing", again)
	}
}

// THE ARRIVAL — a product some warehouse still waits for makes the receiving warehouse wait too, once; one nobody waits
// for is left alone; the tag is untouched (it is on already).
func TestAddArrivalReprintWaits_OnlyForProductsStillWaitedFor(t *testing.T) {
	db := san_testdb.DB(t)
	svc := rpService(db)

	waited := insertProduct(t, db, rpTeam, "RP-XYZ-W", "Ditunggu")
	there := insertProduct(t, db, rpTeam, "RP-XYZ-T", "Sudah di sana")
	free := insertProduct(t, db, rpTeam, "RP-XYZ-F", "Bebas")

	rpWaiting(t, db, waited, rpWhA)
	rpWaiting(t, db, there, rpWhA, rpWhC)

	added, err := svc.AddArrivalReprintWaits(context.Background(), db, rpWhC, []uint64{waited, there, free, waited})
	if err != nil {
		t.Fatal(err)
	}

	if added != 1 {
		t.Errorf("added %d waits, want 1 (waited at C)", added)
	}

	if !slices.Equal(rpWaitsOf(t, db, waited), []uint64{rpWhA, rpWhC}) || !slices.Equal(rpWaitsOf(t, db, there), []uint64{rpWhA, rpWhC}) ||
		len(rpWaitsOf(t, db, free)) != 0 || rpTagged(t, db, free) {
		t.Errorf("waits: waited %v, there %v, free %v", rpWaitsOf(t, db, waited), rpWaitsOf(t, db, there), rpWaitsOf(t, db, free))
	}

	again, err := svc.AddArrivalReprintWaits(context.Background(), db, rpWhC, []uint64{waited})
	if err != nil || again != 0 {
		t.Errorf("a second arrival added %d (%v), want 0", again, err)
	}
}
