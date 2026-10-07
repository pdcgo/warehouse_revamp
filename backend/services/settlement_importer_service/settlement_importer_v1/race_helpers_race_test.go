//go:build raceaudit

// Shared harness for the settlement_importer_service concurrency audits (the audit-sql skill). Each
// import RPC's races are in its own <rpc>_race_test.go:
//
//	go test -tags raceaudit -run "TestRace_|TestInterleave_" -count=20 -v ./backend/services/settlement_importer_service/settlement_importer_v1/
//
// ⚠ These COMMIT (san_race's pool). They clean up only this service's two tables — nothing else in the
// shared test database is touched.
package settlement_importer_v1_test

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	settlement_importerv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement_importer/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement_importer/v1/settlement_importerv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/services/settlement_importer_service/settlement_importer_service_models"
	settlement_importer_v1 "github.com/pdcgo/warehouse_revamp/backend/services/settlement_importer_service/settlement_importer_v1"
)

// raceTables are this service's tables, children first — the only ones a race here may clean.
var raceTables = []string{"uploaded_file_lines", "uploaded_files"}

// raceOrders and raceStore stand in for setup_test.go's fakeOrders and fakeStore, which append to a
// slice WITHOUT a lock: racing imports call them at the same instant. The shop fake is read-only and the
// ledger fake is already mutex-guarded, so both are used as they are.
type raceOrders struct {
	mu    sync.Mutex
	byRef map[string][]settlement_importer_v1.OrderRef
}

func (f *raceOrders) OrdersByRefs(_ context.Context, _ uint64, refs []string) (map[string][]settlement_importer_v1.OrderRef, error) {
	f.mu.Lock()
	defer f.mu.Unlock()

	out := map[string][]settlement_importer_v1.OrderRef{}
	for _, ref := range refs {
		if orders, ok := f.byRef[ref]; ok {
			out[ref] = orders
		}
	}

	return out, nil
}

type raceStore struct {
	mu sync.Mutex
	n  int
}

func (f *raceStore) StoreStatement(_ context.Context, _ uint64, _ string, _ []byte) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()

	f.n++

	return fmt.Sprintf("doc-%d", f.n), nil
}

// raceImporter is ONE importer — one Service, one ledger — served over the real stream, that every racing
// caller shares, the way every uploader shares the one server.
type raceImporter struct {
	svc    *settlement_importer_v1.Service
	ledger *fakeLedger
	client settlement_importerv1connect.SettlementImporterServiceClient
}

func newRaceImporter(t *testing.T, db *gorm.DB, found map[string][]settlement_importer_v1.OrderRef) *raceImporter {
	t.Helper()

	ledger := newFakeLedger()
	svc := settlement_importer_v1.NewService(db, newFakeShops(), &raceOrders{byRef: found}, &raceStore{}, ledger)

	w := &world{svc: svc}

	return &raceImporter{svc: svc, ledger: ledger, client: w.client(t)}
}

// raceImport runs one import over the stream. When leaveAfter > 0 the watcher closes the tab once that
// step arrives — the import must carry on without it (an-import-finishes-whether-anyone-watches).
//
// It answers an error when a watcher who stayed did not see the import end DONE with every row read.
func (r *raceImporter) raceImport(shopee bool, shopID uint64, content []byte, rows int, leaveAfter uint32) error {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	var (
		stream interface {
			Receive() bool
			Err() error
			Close() error
		}
		msg func() message
	)

	if shopee {
		s, err := r.client.ShopeeSettlementImport(ctx, connect.NewRequest(&settlement_importerv1.ShopeeSettlementImportRequest{
			TeamId: team, ShopId: shopID, FileContent: content,
		}))
		if err != nil {
			return err
		}

		stream = s
		msg = func() message {
			m := s.Msg()
			return message{m.GetLevel(), m.GetMessage(), m.GetStep(), m.GetCount(), m.GetFile()}
		}
	} else {
		s, err := r.client.TiktokSettlementImport(ctx, connect.NewRequest(&settlement_importerv1.TiktokSettlementImportRequest{
			TeamId: team, ShopId: shopID, FileContent: content,
		}))
		if err != nil {
			return err
		}

		stream = s
		msg = func() message {
			m := s.Msg()
			return message{m.GetLevel(), m.GetMessage(), m.GetStep(), m.GetCount(), m.GetFile()}
		}
	}
	defer stream.Close()

	var end message

	for stream.Receive() {
		end = msg()

		if leaveAfter > 0 && end.step == leaveAfter {
			cancel() // the tab closes

			return nil
		}
	}

	err := stream.Err()
	if err != nil {
		return err
	}

	if end.file.GetStatus() != settlement_importerv1.UploadedFileStatus_UPLOADED_FILE_STATUS_DONE ||
		int(end.file.GetTally().GetTotal()) != rows {
		return fmt.Errorf("the import ended %v with %d of %d rows: %s", end.file.GetStatus(), end.file.GetTally().GetTotal(), rows, end.text)
	}

	return nil
}

// raceFile is an uploaded_files row as the race left it.
type raceFile struct {
	ID               uint64
	ShopID           uint64
	Platform         string
	Status           string
	RowsTotal        int
	RowsPosted       int
	RowsExisting     int
	RowsHeld         int
	RowsSkipped      int
	RowsPostedToShop int
	Finished         bool
}

// raceLine is an uploaded_file_lines row as the race left it.
type raceLine struct {
	UploadedFileID  uint64
	LineNo          int
	UniqueID        string
	Outcome         string
	Reason          string
	SettlementLogID uint64
}

// raceCheckImports asserts on the WAREHOUSE, never on the errors: every upload of `platform` to shopID is
// its own row, DONE, whose tallies are exactly its own lines; every file carries the statement's lines —
// line_no 1..rows once each, the same key at the same line_no in every copy — and across the copies each
// key that reached the ledger was POSTED by exactly one of them and found EXISTING by the rest, all
// naming the same ledger row. Answers the files, and how many keys reached the ledger.
func raceCheckImports(t *testing.T, db *gorm.DB, shopID uint64, platform string, uploads, rows int) ([]raceFile, int) {
	t.Helper()

	var files []raceFile

	err := db.Raw(`SELECT id, shop_id, platform, status, rows_total, rows_posted, rows_existing, rows_held,
			rows_skipped, rows_posted_to_shop, finished_at IS NOT NULL AS finished
		FROM uploaded_files WHERE shop_id = ? AND platform = ? ORDER BY id`, shopID, platform).
		Scan(&files).
		Error
	if err != nil {
		t.Fatalf("read the files: %v", err)
	}

	if len(files) != uploads {
		t.Fatalf("%d %s uploads became %d rows — want one row per upload", uploads, platform, len(files))
	}

	var reference []raceLine

	for _, file := range files {
		if file.Status != "done" || !file.Finished || file.RowsTotal != rows {
			t.Fatalf("file %d = %+v, want DONE with %d rows", file.ID, file, rows)
		}

		var lines []raceLine

		err := db.Raw(`SELECT uploaded_file_id, line_no, unique_id, outcome, reason, settlement_log_id
			FROM uploaded_file_lines WHERE uploaded_file_id = ? ORDER BY line_no`, file.ID).
			Scan(&lines).
			Error
		if err != nil {
			t.Fatalf("read file %d's lines: %v", file.ID, err)
		}

		if len(lines) != rows {
			t.Fatalf("file %d has %d lines, want %d — a line went missing or landed under another file", file.ID, len(lines), rows)
		}

		counted := raceFile{}

		for i, line := range lines {
			if line.LineNo != i+1 {
				t.Fatalf("file %d: line %d is numbered %d — want 1..%d once each", file.ID, i+1, line.LineNo, rows)
			}

			if !strings.HasPrefix(line.UniqueID, platform+":") {
				t.Fatalf("file %d (%s) carries line %q — another platform's line under this file", file.ID, platform, line.UniqueID)
			}

			switch line.Outcome {
			case "posted":
				counted.RowsPosted++

				if line.Reason == "no_order" {
					counted.RowsPostedToShop++
				}
			case "existing":
				counted.RowsExisting++
			case "held":
				counted.RowsHeld++
			case "skipped":
				counted.RowsSkipped++
			}
		}

		if counted.RowsPosted != file.RowsPosted || counted.RowsExisting != file.RowsExisting ||
			counted.RowsHeld != file.RowsHeld || counted.RowsSkipped != file.RowsSkipped ||
			counted.RowsPostedToShop != file.RowsPostedToShop {
			t.Fatalf("file %d's tallies %+v are not its own lines %+v — a tally was lost or crossed files", file.ID, file, counted)
		}

		if reference == nil {
			reference = lines

			continue
		}

		for i := range lines {
			if lines[i].UniqueID != reference[i].UniqueID {
				t.Fatalf("file %d line %d is %q, the first copy's is %q — the copies disagree", file.ID, i+1, lines[i].UniqueID, reference[i].UniqueID)
			}

			reached := func(outcome string) bool { return outcome == "posted" || outcome == "existing" }
			if reached(lines[i].Outcome) != reached(reference[i].Outcome) || (!reached(lines[i].Outcome) && lines[i].Outcome != reference[i].Outcome) {
				t.Fatalf("file %d line %d is %s, the first copy's is %s — the same line decided twice differently",
					file.ID, i+1, lines[i].Outcome, reference[i].Outcome)
			}
		}
	}

	// ACROSS the copies: a key reaches the ledger once per upload, is CREATED once, and every copy names the
	// same ledger row.
	var keys []struct {
		UniqueID string
		Posted   int
		Existing int
		LogIDs   int
	}

	err = db.Raw(`SELECT l.unique_id,
			COUNT(*) FILTER (WHERE l.outcome = 'posted')   AS posted,
			COUNT(*) FILTER (WHERE l.outcome = 'existing') AS existing,
			COUNT(DISTINCT l.settlement_log_id)            AS log_ids
		FROM uploaded_file_lines l
		JOIN uploaded_files f ON f.id = l.uploaded_file_id
		WHERE f.shop_id = ? AND f.platform = ? AND l.outcome IN ('posted', 'existing')
		GROUP BY l.unique_id`, shopID, platform).
		Scan(&keys).
		Error
	if err != nil {
		t.Fatalf("read the keys: %v", err)
	}

	for _, key := range keys {
		if key.Posted != 1 || key.Existing != uploads-1 || key.LogIDs != 1 {
			t.Fatalf("key %s: posted by %d uploads, existing in %d, %d ledger rows — want 1, %d, 1",
				key.UniqueID, key.Posted, key.Existing, key.LogIDs, uploads-1)
		}
	}

	t.Logf("RACE| %d %s uploads → %d rows, %d lines each, %d keys reached the ledger (each created once)",
		uploads, platform, len(files), rows, len(keys))

	return files, len(keys)
}

// ── statements ──────────────────────────────────────────────────────────────────────────────────

// raceShopeeStatement is 60 Shopee rows carrying every outcome: order income whose order is found (posted
// to it) or not (posted to the shop), completed withdrawals, a failed withdrawal and its refund (skipped),
// an unmapped type and a fraction (held). Row 5 is the one the race's ledger refuses (held).
func raceShopeeStatement(t *testing.T) ([]byte, int, map[string][]settlement_importer_v1.OrderRef) {
	t.Helper()

	const n = 60

	rows := make([]shopeeRow, 0, n)
	found := map[string][]settlement_importer_v1.OrderRef{}
	balance := int64(1_000_000)

	for i := range n {
		at := fmt.Sprintf("2026-09-%02d %02d:%02d:00", 1+i/10, 8+i%10, i%60)

		row := shopeeRow{at, "Penghasilan dari Pesanan", "", "-", "Transaksi Masuk", "", "Transaksi Selesai", ""}
		amount := int64(10_000 + i*100)

		switch {
		case i%10 == 9:
			row.kind, row.description, row.direction, amount = "Penarikan Dana", "Penarikan Dana", "Transaksi Keluar", -100_000
		case i == 20:
			row.kind, row.description, row.direction, row.status, amount = "Penarikan Dana", "Penarikan Dana", "Transaksi Keluar", "Gagal", -50_000
		case i == 21:
			row.kind, row.description, amount = "Penarikan Dana", "Pengembalian Dana untuk Penarikan Gagal", 50_000
		case i == 33:
			row.kind, row.description, row.direction, amount = "Biaya Program Baru", "Biaya Program Baru", "Transaksi Keluar", -15_000
		default:
			row.ref = fmt.Sprintf("2609R%05d", i)
			row.description = "Penghasilan dari Pesanan #" + row.ref

			if i%3 != 0 {
				found[row.ref] = []settlement_importer_v1.OrderRef{{OrderID: uint64(800_000 + i), ShopID: shopeeShop, CreatedByUserID: orderMaker}}
			}
		}

		balance += amount
		row.amount = fmt.Sprintf("%d.00", amount)
		row.balance = fmt.Sprintf("%d.00", balance)

		if i == 44 {
			row.kind, row.description, row.ref, row.amount = "Penyesuaian", "Penyesuaian", "-", "1250.50"
		}

		rows = append(rows, row)
	}

	return shopeeStatement(t, rows...), n, found
}

// raceTiktokStatement is a TikTok week: 30 orders, a third of them commissioned (two lines each), a
// reimbursement, a type nobody mapped (held), and withdrawals — transferred, processing, and the two kinds
// that repeat the orders (skipped). Answers the lines it yields.
func raceTiktokStatement(t *testing.T) ([]byte, int, map[string][]settlement_importer_v1.OrderRef) {
	t.Helper()

	orders := []tiktokOrder{}
	found := map[string][]settlement_importer_v1.OrderRef{}
	lines := 0

	for i := range 30 {
		id := fmt.Sprintf("58%06d", i)
		settled := fmt.Sprintf("2026/09/%02d", 1+i%7)

		affiliate, shopAds := "0", "0"
		if i%3 == 0 {
			affiliate, shopAds = "-2500", "-500"
			lines++ // its affiliate_fee
		}

		orders = append(orders, tiktokOrder{id, "Order", id, settled, fmt.Sprintf("%d", 60_000+i*1_000), affiliate, shopAds})
		lines++

		if i%2 == 0 {
			found[id] = []settlement_importer_v1.OrderRef{{OrderID: uint64(900_000 + i), ShopID: tiktokShop, CreatedByUserID: orderMaker}}
		}
	}

	orders = append(orders,
		tiktokOrder{"78000001", "Logistics reimbursement", "58000002", "2026/09/04", "8000", "", ""},
		tiktokOrder{"78000002", "Seller shipping fee compensation", "/", "2026/09/05", "6000", "", ""},
	)
	lines += 2

	withdrawals := []tiktokWithdrawal{
		{"Withdrawal", "WD1", "2026/09/05", "-120000", "Transferred"},
		{"Withdrawal", "WD2", "2026/09/06", "-10000", "Processing"},
		{"Earnings", "E1", "2026/09/05", "147000", "Transferred"},
		{"GMV Pay Deduction", "G1", "2026/09/05", "-3000", "Transferred"},
	}
	lines += len(withdrawals)

	return tiktokStatement(t, "IDR", false, orders, withdrawals), lines, found
}

// raceNewFile writes a committed uploaded_files row as an import's step 3 leaves it — running.
func raceNewFile(t *testing.T, db *gorm.DB) uint64 {
	t.Helper()

	file := settlement_importer_service_models.UploadedFile{
		TeamID: team, ShopID: shopeeShop, Platform: "shopee", DocumentID: "doc", ContentSha256: "5e1a",
		Status: "running", CreatedByUserID: uploader, PrimaryUserID: primaryCS,
	}

	err := db.Create(&file).Error
	if err != nil {
		t.Fatalf("create a file row: %v", err)
	}

	return file.ID
}

// raceRefused is what the race's ledger answers for the one key it refuses.
var raceRefused = connect.NewError(connect.CodeFailedPrecondition, errors.New("refused for the race"))
