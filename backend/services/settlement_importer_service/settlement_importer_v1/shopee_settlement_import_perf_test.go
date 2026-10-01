//go:build perfaudit

// go test -tags perfaudit -run TestPerf_ShopeeSettlementImport -v -timeout 20m ./backend/services/settlement_importer_service/settlement_importer_v1/
package settlement_importer_v1_test

import (
	"bytes"
	"context"
	"fmt"
	"testing"
	"time"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_excel_readers"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_perf"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_race"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/settlement_importer_service/settlement_importer_service_models"
)

// A full Shopee statement through the REAL streamed handler — the shop check, the store, the detached
// import, every line posted to the (faked) ledger, written down and streamed — at two sizes, so a query
// count that moves with the rows shows. The tables it writes into are seeded at volume first.
//
// The ledger, the shop, the orders and the store are the setup's fakes: what is measured is the
// importer's own work — its SQL, the read, the stream and the log — never settlement's.
func TestPerf_ShopeeSettlementImport(t *testing.T) {
	db, probe := san_perf.Wrap(san_testdb.DB(t))
	perfSeed(t, db)

	ctx := context.Background()

	for _, rows := range []int{150, perfFileLines} {
		content, refs := perfShopeeStatement(t, rows)
		found := perfOrdersFor(refs, shopeeShop)
		name := fmt.Sprintf("ShopeeSettlementImport/rows%d", rows)

		t.Logf("PERF| %s: the statement is %d bytes, %d order refs, read in %v (median of 5, reader only)",
			name, len(content), len(refs), perfReadShopee(t, content))

		// A fresh importer per run — its own ledger, so every run is a first upload that posts. Built
		// before the measured window: warm-up is run -1, the five measured runs 0–4.
		worlds := make([]*world, 6)
		clients := make([]func() (int, message, error), 6)

		for i := range worlds {
			w, client := perfImporter(t, db, found)
			worlds[i] = w
			clients[i] = func() (int, message, error) {
				return perfStreamShopee(ctx, client, shopeeShop, content)
			}
		}

		messages := 0

		median := perfRun(t, probe, name, func(i int) error {
			n, end, err := clients[i+1]()
			if err != nil {
				return err
			}

			worlds[i+1].svc.Wait()
			messages = n

			return perfCheckDone(end, rows)
		})

		count := probe.Count()
		dbTime := probe.DBTotal()

		t.Logf("PERF| %s: %d stream messages, %d queries = %.3f per row, db %v = %.3f ms per row, median wall %v = %.3f ms per row",
			name, messages, count, float64(count)/float64(rows), dbTime, perfMs(dbTime)/float64(rows), median, perfMs(median)/float64(rows))

		perfByStatement(t, probe, name)

		for _, stat := range perfXactStats(t, db) {
			t.Logf("PERF| %s: this transaction so far — %s ins=%d upd=%d hot_upd=%d", name, stat.Relname, stat.NTupIns, stat.NTupUpd, stat.NTupHotUpd)
		}

		if rows == perfFileLines {
			perfExplainShapes(t, db, probe)
		}
	}
}

// TestPerf_ShopeeSettlementImport_Committed is the SAME import on the committing pool, the way production
// runs it: there every GORM write is its own BEGIN … COMMIT (nothing sets SkipDefaultTransaction), so a
// line is two commits. The rolled-back transaction above cannot show that cost — and cannot show whether
// the per-line UPDATE of one row stays HOT, since nothing it supersedes is ever dead to anyone.
//
// ⚠ It COMMITS. It goes through san_race's harness for the cleanup contract, over this service's two
// tables only, which nothing but this package writes.
func TestPerf_ShopeeSettlementImport_Committed(t *testing.T) {
	h := san_race.New(t, "uploaded_file_lines", "uploaded_files")
	db, probe := san_perf.Wrap(h.DB())
	ctx := context.Background()

	// Warm the pool and GORM's schema cache with a small file.
	small, smallRefs := perfShopeeStatement(t, 20)
	w, client := perfImporter(t, db, perfOrdersFor(smallRefs, shopeeShop))

	_, end, err := perfStreamShopee(ctx, client, shopeeShop, small)
	if err != nil {
		t.Fatalf("warm-up: %v", err)
	}

	w.svc.Wait()

	err = perfCheckDone(end, 20)
	if err != nil {
		t.Fatalf("warm-up: %v", err)
	}

	content, refs := perfShopeeStatement(t, perfFileLines)
	found := perfOrdersFor(refs, shopeeShop)

	// Let the warm-up's statistics reach the shared counters before reading them (a backend flushes at
	// most once a second, and an idle one within ten).
	time.Sleep(11 * time.Second)

	before := perfStats(t, h.DB())
	sizesBefore := perfSizes(t, h.DB())

	const runs = 3

	walls := make([]time.Duration, 0, runs)

	for i := range runs {
		w, client := perfImporter(t, db, found)

		probe.Reset()

		var (
			n   int
			end message
		)

		wall, dbTime := probe.Measure(func() {
			n, end, err = perfStreamShopee(ctx, client, shopeeShop, content)
		})
		if err != nil {
			t.Fatalf("run %d: %v", i, err)
		}

		w.svc.Wait()

		err = perfCheckDone(end, perfFileLines)
		if err != nil {
			t.Fatalf("run %d: %v", i, err)
		}

		walls = append(walls, wall)
		t.Logf("PERF| committed run %d: wall=%v db=%v go=%v queries=%d messages=%d — %.3f ms per row, db %.3f ms per row",
			i, wall, dbTime, wall-dbTime, probe.Count(), n, perfMs(wall)/perfFileLines, perfMs(dbTime)/perfFileLines)
	}

	t.Logf("PERF| committed MEDIAN wall=%v (of %d)", san_perf.Median(walls), runs)
	probe.Report(t, "ShopeeSettlementImport/committed")
	perfByStatement(t, probe, "ShopeeSettlementImport/committed")

	// Every run is rows+2 UPDATEs of its own file row: one after the read, one per line, one at the end.
	wantUpdates := int64(runs * (perfFileLines + 2))
	after := perfStatsSettled(t, h.DB(), before, wantUpdates)
	sizesAfter := perfSizes(t, h.DB())

	for name, b := range before {
		a := after[name]
		t.Logf("PERF| committed stats %s: ins +%d, upd +%d, hot_upd +%d (%.1f%% HOT)",
			name, a.NTupIns-b.NTupIns, a.NTupUpd-b.NTupUpd, a.NTupHotUpd-b.NTupHotUpd,
			perfPercent(a.NTupHotUpd-b.NTupHotUpd, a.NTupUpd-b.NTupUpd))
	}

	for name, b := range sizesBefore {
		t.Logf("PERF| committed size %s: %d → %d bytes (+%d pages)", name, b, sizesAfter[name], (sizesAfter[name]-b)/8192)
	}
}

// TestPerf_ImportLineWriteOptions prices the ways ONE line could be written down, on the committing pool,
// 1,500 times each — so the report's options carry measured numbers, not guesses. It does not touch the
// handler: "as built" replays exactly the two calls importLine → saveFile make, and the others are the
// proposals, run as bare SQL.
//
//	baseline     SELECT 1 — one round trip, nothing written
//	as built     Create(line) + Model(file).Updates(map) — each in GORM's default BEGIN … COMMIT
//	no default tx  the same two calls, SkipDefaultTransaction — each its own implicit transaction
//	one statement  INSERT the line and UPDATE the tallies (relative) in ONE statement — a data-modifying CTE
//	line only      the line INSERT alone, no default tx — the row UPDATE moved to a cadence (every ~2 s)
//	batch of 50    50 lines in one multi-row INSERT and one UPDATE, one transaction
func TestPerf_ImportLineWriteOptions(t *testing.T) {
	h := san_race.New(t, "uploaded_file_lines", "uploaded_files")
	db := h.DB()
	ctx := context.Background()

	newFile := func() uint64 {
		file := settlement_importer_service_models.UploadedFile{
			TeamID: team, ShopID: shopeeShop, Platform: "shopee", DocumentID: "doc", ContentSha256: "5e1a",
			Status: "running", CreatedByUserID: uploader, PrimaryUserID: primaryCS,
		}

		err := db.WithContext(ctx).Create(&file).Error
		if err != nil {
			t.Fatalf("create the file row: %v", err)
		}

		return file.ID
	}

	day := time.Date(2026, 9, 2, 0, 0, 0, 0, time.UTC)

	lineOf := func(fileID uint64, i int) settlement_importer_service_models.UploadedFileLine {
		return settlement_importer_service_models.UploadedFileLine{
			UploadedFileID: fileID, LineNo: i + 1, Sheet: "Rincian Transaksi",
			UniqueID:     fmt.Sprintf("shopee:rincian_transaksi:%032x", i),
			OrderRef:     fmt.Sprintf("2609%08dAB", i),
			PlatformType: "Penghasilan dari Pesanan", Description: "Penghasilan dari Pesanan",
			SettlementType: "fund", Change: int64(10_000 + i), OccurredOn: &day,
			OrderID: uint64(700_000 + i), Outcome: "posted", SettlementLogID: uint64(9_000_000 + i),
		}
	}

	// saveFile's own UPDATE, verbatim in shape.
	saveFile := func(tx *gorm.DB, fileID uint64, posted int) error {
		return tx.WithContext(ctx).
			Model(&settlement_importer_service_models.UploadedFile{}).
			Where("id = ?", fileID).
			Updates(map[string]any{
				"period_from": &day, "period_to": &day, "status": "running", "failure": "",
				"rows_total": perfFileLines, "rows_posted": posted, "rows_existing": 0, "rows_held": 0,
				"rows_skipped": 0, "rows_posted_to_shop": 0, "updated_at": time.Now(), "finished_at": nil,
			}).
			Error
	}

	noTx := db.Session(&gorm.Session{SkipDefaultTransaction: true})

	options := []struct {
		name  string
		write func(fileID uint64, i int) error
	}{
		{"baseline SELECT 1", func(uint64, int) error {
			var one int

			return db.WithContext(ctx).Raw(`SELECT 1`).Scan(&one).Error
		}},
		{"as built", func(fileID uint64, i int) error {
			line := lineOf(fileID, i)

			err := db.WithContext(ctx).Create(&line).Error
			if err != nil {
				return err
			}

			return saveFile(db, fileID, i+1)
		}},
		{"no default tx", func(fileID uint64, i int) error {
			line := lineOf(fileID, i)

			err := noTx.WithContext(ctx).Create(&line).Error
			if err != nil {
				return err
			}

			return saveFile(noTx, fileID, i+1)
		}},
		{"one statement", func(fileID uint64, i int) error {
			line := lineOf(fileID, i)

			return db.WithContext(ctx).Exec(`
				WITH line AS (
					INSERT INTO uploaded_file_lines (uploaded_file_id, line_no, sheet, unique_id, order_ref, platform_type,
						description, settlement_type, change, occurred_on, order_id, outcome, reason, detail, settlement_log_id)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
					RETURNING 1
				)
				UPDATE uploaded_files
				SET rows_posted = rows_posted + ?, rows_existing = rows_existing + ?, rows_held = rows_held + ?,
					rows_skipped = rows_skipped + ?, rows_posted_to_shop = rows_posted_to_shop + ?, updated_at = NOW()
				WHERE id = ?`,
				line.UploadedFileID, line.LineNo, line.Sheet, line.UniqueID, line.OrderRef, line.PlatformType,
				line.Description, line.SettlementType, line.Change, line.OccurredOn, line.OrderID, line.Outcome,
				line.Reason, line.Detail, line.SettlementLogID,
				1, 0, 0, 0, 0, fileID).
				Error
		}},
		{"line only (row on a cadence)", func(fileID uint64, i int) error {
			line := lineOf(fileID, i)

			return noTx.WithContext(ctx).Create(&line).Error
		}},
	}

	for _, option := range options {
		fileID := newFile()
		start := time.Now()

		for i := range perfFileLines {
			err := option.write(fileID, i)
			if err != nil {
				t.Fatalf("%s, line %d: %v", option.name, i, err)
			}
		}

		wall := time.Since(start)
		t.Logf("PERF| line write %-30s 1500 lines in %v = %.3f ms per line", option.name, wall, perfMs(wall)/perfFileLines)
	}

	// batch of 50: one transaction per 50 lines — a multi-row INSERT and one UPDATE.
	fileID := newFile()
	start := time.Now()

	const batch = 50

	for from := 0; from < perfFileLines; from += batch {
		lines := make([]settlement_importer_service_models.UploadedFileLine, 0, batch)
		for i := from; i < from+batch; i++ {
			lines = append(lines, lineOf(fileID, i))
		}

		err := db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
			err := tx.Create(&lines).Error
			if err != nil {
				return err
			}

			return saveFile(tx, fileID, from+batch)
		})
		if err != nil {
			t.Fatalf("batch at %d: %v", from, err)
		}
	}

	wall := time.Since(start)
	t.Logf("PERF| line write %-30s 1500 lines in %v = %.3f ms per line", "batch of 50", wall, perfMs(wall)/perfFileLines)
}

// perfReadShopee is the reader's own cost over the bytes — parse, rows, details, and every row's key —
// the part of an import's non-database time that is the Excel file.
func perfReadShopee(t *testing.T, content []byte) time.Duration {
	t.Helper()

	walls := make([]time.Duration, 0, 5)

	for range 5 {
		start := time.Now()

		doc, err := san_excel_readers.NewShopeeSettlementDocument(bytes.NewReader(content))
		if err != nil {
			t.Fatalf("read: %v", err)
		}

		items, err := doc.GetItems()
		if err != nil {
			t.Fatalf("items: %v", err)
		}

		_, err = doc.GetDetails()
		if err != nil {
			t.Fatalf("details: %v", err)
		}

		for _, item := range items {
			_, err = item.GenerateUniqueID()
			if err != nil {
				t.Fatalf("key: %v", err)
			}
		}

		walls = append(walls, time.Since(start))
	}

	return san_perf.Median(walls)
}

// perfStats reads the SHARED statistics of the two tables — what every committed transaction did.
func perfStats(t *testing.T, db *gorm.DB) map[string]perfTableStat {
	t.Helper()

	var rows []perfTableStat

	err := db.Raw(`SELECT relname, n_tup_ins, n_tup_upd, n_tup_hot_upd
		FROM pg_stat_user_tables
		WHERE relname IN ('uploaded_files', 'uploaded_file_lines')`).
		Scan(&rows).
		Error
	if err != nil {
		t.Fatalf("read the table stats: %v", err)
	}

	out := map[string]perfTableStat{}
	for _, row := range rows {
		out[row.Relname] = row
	}

	return out
}

// perfStatsSettled waits until the backends have flushed the updates the runs made, then reads.
func perfStatsSettled(t *testing.T, db *gorm.DB, before map[string]perfTableStat, wantUpdates int64) map[string]perfTableStat {
	t.Helper()

	deadline := time.Now().Add(30 * time.Second)

	for {
		now := perfStats(t, db)
		if now["uploaded_files"].NTupUpd-before["uploaded_files"].NTupUpd >= wantUpdates || time.Now().After(deadline) {
			return now
		}

		time.Sleep(time.Second)
	}
}

func perfSizes(t *testing.T, db *gorm.DB) map[string]int64 {
	t.Helper()

	var rows []struct {
		Name  string
		Bytes int64
	}

	err := db.Raw(`SELECT c.relname AS name, pg_relation_size(c.oid) AS bytes
		FROM pg_class c
		WHERE c.relname IN ('uploaded_files', 'uploaded_files_pkey', 'uploaded_files_team_created_idx',
			'uploaded_files_team_shop_created_idx', 'uploaded_file_lines', 'uploaded_file_lines_pkey',
			'uploaded_file_lines_file_outcome_idx')`).
		Scan(&rows).
		Error
	if err != nil {
		t.Fatalf("read the relation sizes: %v", err)
	}

	out := map[string]int64{}
	for _, row := range rows {
		out[row.Name] = row.Bytes
	}

	return out
}

func perfMs(d time.Duration) float64 {
	return float64(d) / float64(time.Millisecond)
}

func perfPercent(part, whole int64) float64 {
	if whole == 0 {
		return 0
	}

	return 100 * float64(part) / float64(whole)
}
