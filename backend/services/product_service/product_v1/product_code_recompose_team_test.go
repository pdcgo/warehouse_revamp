package product_v1_test

import (
	"context"
	"errors"
	"slices"
	"strings"
	"testing"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_service_models"
	product_v1 "github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_v1"
)

// THE TEAM CODE CHANGE'S RECOMPOSE (backlog #149, a-team-code-change-recomposes-its-product-codes): the products' side,
// called by team_service's TeamCodeUpdate inside its own transaction. The shelves come from the fake stock seam here;
// cmd/app_development tests the real one over inventory's placements.

const (
	rcTeam  = 7101
	rcOther = 7102
	rcWhA   = 7111
	rcWhB   = 7112
)

var rcActor = product_v1.RecomposeActor{UserID: 41, IsOverride: true}

func rcService(db *gorm.DB, stock *fakeStock) *product_v1.Service {
	return product_v1.NewService(db, history, teamCodes, stock, nil)
}

// rcArchive archives a product directly — an archived product keeps its code, and takes the new one too (⚠2).
func rcArchive(t *testing.T, db *gorm.DB, id uint64) {
	t.Helper()

	err := db.Model(&product_service_models.Product{}).Where("id = ?", id).Update("archived", true).Error
	if err != nil {
		t.Fatal(err)
	}
}

func rcCode(t *testing.T, db *gorm.DB, id uint64) string {
	t.Helper()

	var code string

	err := db.Model(&product_service_models.Product{}).Where("id = ?", id).Pluck("product_code", &code).Error
	if err != nil {
		t.Fatal(err)
	}

	return code
}

func rcLogs(t *testing.T, db *gorm.DB, id uint64) []product_service_models.ProductLog {
	t.Helper()

	var logs []product_service_models.ProductLog

	err := db.Where("product_id = ?", id).Order("id").Find(&logs).Error
	if err != nil {
		t.Fatal(err)
	}

	return logs
}

func rcWaits(t *testing.T, db *gorm.DB, id uint64) []uint64 {
	t.Helper()

	var warehouses []uint64

	err := db.Model(&product_service_models.ProductReprintWait{}).Where("product_id = ?", id).Order("warehouse_id").
		Pluck("warehouse_id", &warehouses).Error
	if err != nil {
		t.Fatal(err)
	}

	return warehouses
}

func rcTagged(t *testing.T, db *gorm.DB, id uint64) bool {
	t.Helper()

	app := ptAppTag(t, db)

	var n int64

	err := db.Model(&product_service_models.ProductTagLink{}).Where("product_id = ? AND tag_id = ?", id, app.ID).Count(&n).Error
	if err != nil {
		t.Fatal(err)
	}

	return n == 1
}

// ABC → XYZ: every product under `ABC-` takes `XYZ-` — the ARCHIVED one too (⚠2) — and each gets its history line (old →
// new, who, an override). Another team's product, and one of the team's own under no old prefix (a row from before codes
// were composed), are left as they were — the latter named in the report.
func TestRecomposeTeamCodes_EveryProductUnderTheOldCodeTakesTheNew(t *testing.T) {
	db := san_testdb.DB(t)
	svc := rcService(db, &fakeStock{})

	a := insertProduct(t, db, rcTeam, "RC-ABC-SHOE-42", "Sepatu")
	b := insertProduct(t, db, rcTeam, "RC-ABC-TAS-01", "Tas")
	bare := insertProduct(t, db, rcTeam, "BARE-PART-9", "Lama")
	theirs := insertProduct(t, db, rcOther, "RC-ABC-SHOE-43", "Bukan kita")

	rcArchive(t, db, b)

	report, err := svc.RecomposeTeamCodes(context.Background(), db, rcTeam, "RC-ABC", "RC-XYZ", rcActor)
	if err != nil {
		t.Fatalf("RecomposeTeamCodes: %v", err)
	}

	for id, want := range map[uint64]string{a: "RC-XYZ-SHOE-42", b: "RC-XYZ-TAS-01", bare: "BARE-PART-9", theirs: "RC-ABC-SHOE-43"} {
		if got := rcCode(t, db, id); got != want {
			t.Errorf("product %d's code = %q, want %q", id, got, want)
		}
	}

	if report.Recomposed != 2 || report.LeftAlone != 1 || !slices.Equal(report.LeftAloneCodes, []string{"BARE-PART-9"}) {
		t.Errorf("report = %+v, want 2 recomposed, BARE-PART-9 left alone", report)
	}

	logs := rcLogs(t, db, a)
	if len(logs) != 1 || logs[0].Kind != "code_changed" || logs[0].OldCode != "RC-ABC-SHOE-42" || logs[0].NewCode != "RC-XYZ-SHOE-42" ||
		logs[0].ActorID != 41 || !logs[0].IsOverride {
		t.Errorf("history of %d = %+v, want one code_changed RC-ABC-SHOE-42 → RC-XYZ-SHOE-42 by 41 (override)", a, logs)
	}

	if len(rcLogs(t, db, bare)) != 0 || len(rcLogs(t, db, theirs)) != 0 {
		t.Error("a product left alone got a history line")
	}
}

// `need_reprint_code` and a reprint wait ONLY where stock sits: a product two warehouses hold units of waits for both and
// is tagged once; one with nothing on a shelf anywhere takes the new code and is never tagged (⚠4). The tag is the app's
// (added by 0).
func TestRecomposeTeamCodes_TagsAndWaitsOnlyWhereStockSits(t *testing.T) {
	db := san_testdb.DB(t)

	held := insertProduct(t, db, rcTeam, "RC2-ABC-A", "Dipegang")
	empty := insertProduct(t, db, rcTeam, "RC2-ABC-B", "Kosong")

	stock := &fakeStock{onShelves: []product_v1.ShelvedIn{
		{ProductID: held, WarehouseID: rcWhA},
		{ProductID: held, WarehouseID: rcWhB},
	}}
	svc := rcService(db, stock)

	report, err := svc.RecomposeTeamCodes(context.Background(), db, rcTeam, "RC2-ABC", "RC2-XYZ", rcActor)
	if err != nil {
		t.Fatal(err)
	}

	if report.Recomposed != 2 || report.Tagged != 1 || report.Waits != 2 {
		t.Errorf("report = %+v, want 2 recomposed, 1 tagged, 2 waits", report)
	}

	if got := rcWaits(t, db, held); !slices.Equal(got, []uint64{rcWhA, rcWhB}) {
		t.Errorf("waits of the held product = %v, want both warehouses", got)
	}

	if !rcTagged(t, db, held) {
		t.Error("the held product is not tagged need_reprint_code")
	}

	if rcTagged(t, db, empty) || len(rcWaits(t, db, empty)) != 0 {
		t.Error("a product with nothing on a shelf was tagged or waits")
	}

	var link product_service_models.ProductTagLink

	err = db.Where("product_id = ? AND tag_id = ?", held, ptAppTag(t, db).ID).Take(&link).Error
	if err != nil {
		t.Fatal(err)
	}

	if link.AddedByUserID != 0 || link.AddedByIsOverride {
		t.Errorf("the tag was put on by %d (override %v), want the app (0)", link.AddedByUserID, link.AddedByIsOverride)
	}
}

// A second change before the reprint (⚠7): one more history line, the waits RE-SET to the warehouses holding stock now
// (an old wait for a warehouse that holds none any more goes), one tag — and a product that holds stock nowhere now loses
// the tag, since no warehouse has anything to reprint. A custom tag is never touched.
func TestRecomposeTeamCodes_ASecondChangeResetsTheWaits(t *testing.T) {
	db := san_testdb.DB(t)

	moved := insertProduct(t, db, rcTeam, "RC3-ABC-A", "Pindah")
	gone := insertProduct(t, db, rcTeam, "RC3-ABC-B", "Habis")

	laris := ptSeed(t, db, "rc3 laris", "custom")

	err := db.Create(&product_service_models.ProductTagLink{ProductID: gone, TagID: laris, AddedByUserID: 5}).Error
	if err != nil {
		t.Fatal(err)
	}

	stock := &fakeStock{onShelves: []product_v1.ShelvedIn{{ProductID: moved, WarehouseID: rcWhA}, {ProductID: gone, WarehouseID: rcWhA}}}
	svc := rcService(db, stock)

	_, err = svc.RecomposeTeamCodes(context.Background(), db, rcTeam, "RC3-ABC", "RC3-XYZ", rcActor)
	if err != nil {
		t.Fatal(err)
	}

	// Before any reprint: the units of `moved` went to B, and `gone` sold out.
	stock.onShelves = []product_v1.ShelvedIn{{ProductID: moved, WarehouseID: rcWhB}}

	report, err := svc.RecomposeTeamCodes(context.Background(), db, rcTeam, "RC3-XYZ", "RC3-QWE", rcActor)
	if err != nil {
		t.Fatal(err)
	}

	if report.Recomposed != 2 || report.Tagged != 1 {
		t.Errorf("report = %+v, want 2 recomposed, 1 tagged", report)
	}

	if got := rcCode(t, db, moved); got != "RC3-QWE-A" {
		t.Errorf("code = %q, want RC3-QWE-A", got)
	}

	if logs := rcLogs(t, db, moved); len(logs) != 2 || logs[1].OldCode != "RC3-XYZ-A" || logs[1].NewCode != "RC3-QWE-A" {
		t.Errorf("history = %+v, want two lines, the second RC3-XYZ-A → RC3-QWE-A", logs)
	}

	if got := rcWaits(t, db, moved); !slices.Equal(got, []uint64{rcWhB}) || !rcTagged(t, db, moved) {
		t.Errorf("moved: waits %v tagged %v, want [B] and tagged", got, rcTagged(t, db, moved))
	}

	if len(rcWaits(t, db, gone)) != 0 || rcTagged(t, db, gone) {
		t.Error("a product holding stock nowhere still waits or carries need_reprint_code")
	}

	if ptLinks(t, db, gone) != 1 {
		t.Error("want the custom tag, and only it, left on the sold-out product")
	}
}

// A CLASH refuses the whole change before anything is written: only a dash makes one — team Q's Q-1 would become AB-C-1
// under the new code AB-C, which another team's product already carries (team AB's part C-1). Both are named.
func TestRecomposeTeamCodes_AClashRefusesTheWholeChange(t *testing.T) {
	db := san_testdb.DB(t)
	svc := rcService(db, &fakeStock{onShelves: nil})

	first := insertProduct(t, db, rcTeam, "RC4Q-A", "Satu")
	mine := insertProduct(t, db, rcTeam, "RC4Q-1", "Dua")
	theirs := insertProduct(t, db, rcOther, "RC4AB-C-1", "Punya mereka")

	_, err := svc.RecomposeTeamCodes(context.Background(), db, rcTeam, "RC4Q", "RC4AB-C", rcActor)
	if !errors.Is(err, product_v1.ErrTeamRecomposeClash) {
		t.Fatalf("err = %v, want the clash", err)
	}

	if !strings.Contains(err.Error(), "RC4Q-1") || !strings.Contains(err.Error(), "RC4AB-C-1") {
		t.Errorf("the refusal %q does not name both products", err)
	}

	if rcCode(t, db, first) != "RC4Q-A" || rcCode(t, db, mine) != "RC4Q-1" || rcCode(t, db, theirs) != "RC4AB-C-1" {
		t.Error("a code was written before the refusal")
	}

	if len(rcLogs(t, db, first)) != 0 {
		t.Error("a history line was written before the refusal")
	}
}

// When one prefix begins with the other (AB → AB-X), a row's new code can be ANOTHER row's old code inside the one
// statement — AB-1 becomes AB-X-1 while AB-X-1 (part X-1) is still there, about to become AB-X-X-1. The rows are parked
// first, so the swap lands; the back move (AB-X → AB) too.
func TestRecomposeTeamCodes_ADashInTheNewCodeStillLands(t *testing.T) {
	db := san_testdb.DB(t)
	svc := rcService(db, &fakeStock{})

	plain := insertProduct(t, db, rcTeam, "RC5AB-1", "Satu")
	dashed := insertProduct(t, db, rcTeam, "RC5AB-X-1", "Dua")

	_, err := svc.RecomposeTeamCodes(context.Background(), db, rcTeam, "RC5AB", "RC5AB-X", rcActor)
	if err != nil {
		t.Fatalf("AB → AB-X: %v", err)
	}

	if rcCode(t, db, plain) != "RC5AB-X-1" || rcCode(t, db, dashed) != "RC5AB-X-X-1" {
		t.Errorf("codes = %q, %q, want RC5AB-X-1, RC5AB-X-X-1", rcCode(t, db, plain), rcCode(t, db, dashed))
	}

	if logs := rcLogs(t, db, dashed); len(logs) != 1 || logs[0].OldCode != "RC5AB-X-1" || logs[0].NewCode != "RC5AB-X-X-1" {
		t.Errorf("history of the dashed one = %+v", logs)
	}

	_, err = svc.RecomposeTeamCodes(context.Background(), db, rcTeam, "RC5AB-X", "RC5AB", rcActor)
	if err != nil {
		t.Fatalf("AB-X → AB: %v", err)
	}

	if rcCode(t, db, plain) != "RC5AB-1" || rcCode(t, db, dashed) != "RC5AB-X-1" {
		t.Errorf("codes back = %q, %q, want RC5AB-1, RC5AB-X-1", rcCode(t, db, plain), rcCode(t, db, dashed))
	}
}

// No shelves to read → nothing can say which products to tag, so the change is refused before anything is written. And a
// "change" to the same code is no change.
func TestRecomposeTeamCodes_RefusesWithoutTheShelvesOrAChange(t *testing.T) {
	db := san_testdb.DB(t)

	id := insertProduct(t, db, rcTeam, "RC6-ABC-A", "Satu")

	_, err := product_v1.NewService(db, history, teamCodes, nil, nil).RecomposeTeamCodes(context.Background(), db, rcTeam, "RC6-ABC", "RC6-XYZ", rcActor)
	if err == nil || rcCode(t, db, id) != "RC6-ABC-A" {
		t.Errorf("no stock seam: err %v, code %q — want refused, untouched", err, rcCode(t, db, id))
	}

	_, err = rcService(db, &fakeStock{}).RecomposeTeamCodes(context.Background(), db, rcTeam, "RC6-ABC", "RC6-ABC", rcActor)
	if err == nil {
		t.Error("a change to the same code was not refused")
	}
}
