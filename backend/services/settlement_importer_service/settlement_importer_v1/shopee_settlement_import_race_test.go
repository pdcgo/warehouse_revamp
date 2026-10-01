//go:build raceaudit

// Concurrency audit for ShopeeSettlementImport (the audit-sql skill).
//
// WHY THIS RPC. The same statement is uploaded twice at once more often than it sounds: two CS of one team
// each download the day's file and import it, or one person double-submits. Nothing in the importer's
// tables is unique but the id (the-row-key-is-the-only-dedupe), so the only thing standing between two
// uploads and a double-posted ledger is settlement's key — and the only thing keeping each upload's
// record straight is that each import writes ONLY its own row and its own lines.
//
// What is proved here:
//
//  1. N uploads of ONE statement at the same instant → N rows, each DONE, each row's tallies exactly its
//     own lines, every line under the file that read it — and each key CREATED once across all of them.
//     Half the watchers close the tab after the first row, so the detached imports race too.
//  2. Two imports never wait on each other: every statement one issues is on its own row (Interleave).
//  3. The row lock is NOT what keeps a tally right — ownership is: a second writer of the same row would
//     block, and then overwrite (Interleave). No second writer exists today; this pins why it matters.
//
// Run it:
//
//	go test -tags raceaudit -run "TestRace_ShopeeSettlementImport|TestInterleave_" -count=20 -v ./backend/services/settlement_importer_service/settlement_importer_v1/
package settlement_importer_v1_test

import (
	"testing"
	"time"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	"github.com/pdcgo/warehouse_revamp/backend/services/settlement_importer_service/settlement_importer_service_models"
)

// ⚠ THE BUG THIS PROVES IS ABSENT: eight uploads of one statement, released together, must leave eight
// separate, internally consistent records — and must not post any line twice.
func TestRace_ShopeeSettlementImport_SameFileEightTimes(t *testing.T) {
	h := san_race.New(t, raceTables...)

	content, rows, found := raceShopeeStatement(t)
	imp := newRaceImporter(t, h.DB(), found)

	// Widen the window: settlement's round trip is where a real import spends its time, so the eight
	// imports' posts overlap for the whole file instead of finishing one after another.
	imp.ledger.delay = 2 * time.Millisecond
	imp.ledger.refuse[shopeeKey(t, content, 5)] = raceRefused

	const uploads = 8

	res := h.Race(t, uploads, func(i int) error {
		leave := uint32(0)
		if i%2 == 1 {
			leave = 1 // half the uploaders close the tab after the first row
		}

		return imp.raceImport(true, shopeeShop, content, rows, leave)
	})
	res.Report(t)

	// The imports whose watcher left are still running, detached.
	imp.svc.Wait()

	if res.Failed() != 0 {
		t.Fatalf("%d of %d uploads failed — every one was a legitimate upload", res.Failed(), uploads)
	}

	_, reached := raceCheckImports(t, h.DB(), shopeeShop, "shopee", uploads, rows)

	// The LEDGER took each key once, however many uploads carried it.
	if got := len(imp.ledger.posted()); got != reached {
		t.Fatalf("the ledger created %d rows for %d keys across %d uploads — a key was posted twice", got, reached, uploads)
	}
}

// PROOF OF NO CONTENTION: two imports, each mid-transaction on its own row, never block each other — not
// on a line, not on a tally, and the import screen's read waits on neither. Every statement an import
// issues names its own file row: a line's FK check takes FOR KEY SHARE on it, saveFile's UPDATE takes FOR
// NO KEY UPDATE — and those two do not conflict even on the SAME row.
func TestInterleave_TwoImportsNeverWaitOnEachOther(t *testing.T) {
	h := san_race.New(t, raceTables...)
	a := raceNewFile(t, h.DB())
	b := raceNewFile(t, h.DB())

	line := func(file uint64, n int) func(tx *gorm.DB) error {
		return func(tx *gorm.DB) error {
			l := settlement_importer_service_models.UploadedFileLine{
				UploadedFileID: file, LineNo: n, Sheet: "Rincian Transaksi",
				UniqueID: "shopee:rincian_transaksi:interleave", Outcome: "posted",
			}

			return tx.Create(&l).Error
		}
	}

	save := func(file uint64, posted int) func(tx *gorm.DB) error {
		return func(tx *gorm.DB) error {
			return tx.Model(&settlement_importer_service_models.UploadedFile{}).
				Where("id = ?", file).
				Updates(map[string]any{"rows_posted": posted, "updated_at": time.Now()}).
				Error
		}
	}

	screen := func(tx *gorm.DB) error {
		var files []settlement_importer_service_models.UploadedFile

		return tx.Where("team_id = ?", team).Order("created_at DESC NULLS LAST, id DESC").Limit(20).Find(&files).Error
	}

	sched := h.Interleave(t,
		san_race.Do("A", "A writes line 1 of its file (FK: KEY SHARE on A's row)", line(a, 1)),
		san_race.Do("A", "A moves its tallies (NO KEY UPDATE on A's row)", save(a, 1)),
		san_race.Do("B", "B writes line 1 of its file", line(b, 1)),
		san_race.Do("B", "B moves its tallies", save(b, 1)),
		san_race.Do("B", "B reads the import screen, both rows mid-write", screen),
		san_race.Do("A", "A writes line 2 under its own still-locked row", line(a, 2)),
		san_race.Do("B", "B writes a line under A's locked row (KEY SHARE vs NO KEY UPDATE)", line(a, 3)),
		san_race.Commit("A"),
		san_race.Commit("B"),
	)
	sched.Report(t)

	for _, step := range sched.Steps {
		if step.Blocked || step.Kind != san_race.None {
			t.Fatalf("step %q: blocked=%v %s — two imports waited on each other", step.Name, step.Blocked, step.Kind)
		}
	}
}

// WHY OWNERSHIP IS LOAD-BEARING. saveFile writes the tallies as ABSOLUTE values from the import's own Go
// counters (rows_posted = 5), not as increments. Against a second writer of the same row the row lock
// HOLDS — the second UPDATE waits — and then overwrites anyway: last writer wins, and the first writer's
// count is gone with no error anywhere.
//
// Not a finding: every uploaded_files row has exactly ONE writer, the goroutine that created it, and no
// handler, sweeper or retry writes another import's row. This pins the property the day one is added —
// and shows the increment form keeps both.
func TestInterleave_TalliesAreKeptByOwnershipNotByTheRowLock(t *testing.T) {
	h := san_race.New(t, raceTables...)
	db := h.DB()

	absolute := func(file uint64, posted int) func(tx *gorm.DB) error {
		return func(tx *gorm.DB) error {
			return tx.Model(&settlement_importer_service_models.UploadedFile{}).
				Where("id = ?", file).
				Updates(map[string]any{"rows_posted": posted, "updated_at": time.Now()}).
				Error
		}
	}

	relative := func(file uint64, posted int) func(tx *gorm.DB) error {
		return func(tx *gorm.DB) error {
			return tx.Exec(`UPDATE uploaded_files SET rows_posted = rows_posted + ?, updated_at = NOW() WHERE id = ?`, posted, file).Error
		}
	}

	read := func(file uint64) int {
		var posted int

		err := db.Raw(`SELECT rows_posted FROM uploaded_files WHERE id = ?`, file).Scan(&posted).Error
		if err != nil {
			t.Fatalf("read file %d: %v", file, err)
		}

		return posted
	}

	// AS BUILT — absolute values.
	one := raceNewFile(t, db)

	sched := h.Interleave(t,
		san_race.Do("A", "A (the import) writes rows_posted = 5", absolute(one, 5)),
		san_race.Block("B", "B (a second writer) writes rows_posted = 3", absolute(one, 3)),
		san_race.Commit("A"),
		san_race.Commit("B"),
	)
	sched.Report(t)

	if !sched.Get("B (a second writer) writes rows_posted = 3").Blocked {
		t.Fatal("B did not wait on A's row lock — the lock this test relies on is not held")
	}

	if got := read(one); got != 3 {
		t.Fatalf("rows_posted = %d, want 3 — expected last-writer-wins", got)
	}

	t.Logf("RACE| absolute tallies: B waited %v on A's row lock, and the row reads 3 — A's 5 is lost",
		sched.Get("B (a second writer) writes rows_posted = 3").Wall.Round(time.Millisecond))

	// THE INCREMENT FORM — both counts survive.
	two := raceNewFile(t, db)

	sched = h.Interleave(t,
		san_race.Do("A", "A adds 5", relative(two, 5)),
		san_race.Block("B", "B adds 3", relative(two, 3)),
		san_race.Commit("A"),
		san_race.Commit("B"),
	)
	sched.Report(t)

	if got := read(two); got != 8 {
		t.Fatalf("rows_posted = %d, want 8 — the increment form must keep both writers", got)
	}

	t.Log("RACE| relative tallies: B waited, then added — the row reads 8")
}
