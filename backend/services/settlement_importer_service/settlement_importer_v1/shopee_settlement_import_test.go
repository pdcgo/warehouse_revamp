package settlement_importer_v1_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect"

	settlementv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1"
	settlement_importerv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement_importer/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_excel_readers"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	settlement_importer_v1 "github.com/pdcgo/warehouse_revamp/backend/services/settlement_importer_service/settlement_importer_v1"
)

// sevenShopeeRows is one week of a Shopee shop, every kind of line the importer decides about:
//
//	1 an order's income — its order is found            → POSTED to the order
//	2 an order's income — no such order                 → POSTED to the shop, NO_ORDER
//	3 a withdrawal that completed                       → POSTED, withdrawal
//	4 a withdrawal that FAILED                          → SKIPPED
//	5 the refund returning it — completed, money in     → SKIPPED
//	6 a type nobody has mapped                          → HELD
//	7 a fraction of a rupiah                            → HELD
func sevenShopeeRows(t *testing.T) []byte {
	t.Helper()

	return shopeeStatement(t,
		shopeeRow{"2026-09-02 10:00:00", "Penghasilan dari Pesanan", "Penghasilan dari Pesanan #2509AAA", "2509AAA", "Transaksi Masuk", "185000.00", "Transaksi Selesai", "185000.00"},
		shopeeRow{"2026-09-02 11:00:00", "Penghasilan dari Pesanan", "Penghasilan dari Pesanan #2509ZZZ", "2509ZZZ", "Transaksi Masuk", "77000.00", "Transaksi Selesai", "262000.00"},
		shopeeRow{"2026-09-03 09:00:00", "Penarikan Dana", "Penarikan Dana", "-", "Transaksi Keluar", "-150000.00", "Transaksi Selesai", "112000.00"},
		shopeeRow{"2026-09-04 09:00:00", "Penarikan Dana", "Penarikan Dana", "-", "Transaksi Keluar", "-50000.00", "Gagal", "62000.00"},
		shopeeRow{"2026-09-05 09:00:00", "Penarikan Dana", "Pengembalian Dana untuk Penarikan Gagal", "-", "Transaksi Masuk", "50000.00", "Transaksi Selesai", "112000.00"},
		shopeeRow{"2026-09-05 10:00:00", "Biaya Program Baru", "Biaya Program Baru", "-", "Transaksi Keluar", "-15000.00", "Transaksi Selesai", "97000.00"},
		shopeeRow{"2026-09-06 10:00:00", "Penyesuaian", "Penyesuaian", "-", "Transaksi Masuk", "1250.50", "Transaksi Selesai", "98250.50"},
	)
}

// the-import-is-one-streamed-call, end to end: the shop checked, the file stored under its hash, its own
// row, the file read, every ref resolved in ONE call, and every line posted or recorded — each a step on
// the stream, and the row's tallies matching what happened.
func TestShopeeSettlementImport_PostsAStatementLineByLine(t *testing.T) {
	db := san_testdb.DB(t)
	w := newWorld(t, db)
	w.orders.byRef["2509AAA"] = []settlement_importer_v1.OrderRef{{OrderID: 501, ShopID: shopeeShop, CreatedByUserID: orderMaker}}

	content := sevenShopeeRows(t)
	messages := w.importShopee(t, shopeeShop, content)

	// THE STREAM — the check, the store, the read, seven rows, done.
	if !strings.Contains(messages[0].text, "Shop checked — Melati Official") {
		t.Fatalf("first message = %q", messages[0].text)
	}

	stored := messages[1]
	if stored.file == nil || stored.file.GetStatus() != settlement_importerv1.UploadedFileStatus_UPLOADED_FILE_STATUS_RUNNING {
		t.Fatalf("the stored message carries no running file: %+v", stored)
	}

	read := messages[2]
	if read.count != 7 || !strings.Contains(read.text, "Read 7 rows, 2026-09-01 – 2026-09-07") {
		t.Fatalf("the read message = %+v", read)
	}

	for step := uint32(1); step <= 7; step++ {
		m := messages[2+step]
		if m.step != step || m.count != 7 || m.file == nil {
			t.Fatalf("row %d message = %+v", step, m)
		}
	}

	done := last(messages)
	if done.file.GetStatus() != settlement_importerv1.UploadedFileStatus_UPLOADED_FILE_STATUS_DONE ||
		done.text != "Done — 3 posted, 0 already there, 2 held, 2 skipped" {
		t.Fatalf("the last message = %+v", done)
	}

	// THE LEVELS — a line posted to the shop, a failed withdrawal and a held line are WARN; the rest INFO.
	levels := map[uint32]settlement_importerv1.LogLevel{}
	for _, m := range messages {
		if m.step > 0 && m.step <= 7 && strings.HasPrefix(m.text, "Row") {
			levels[m.step] = m.level
		}
	}

	warn, info := settlement_importerv1.LogLevel_LOG_LEVEL_WARN, settlement_importerv1.LogLevel_LOG_LEVEL_INFO
	for step, want := range map[uint32]settlement_importerv1.LogLevel{1: info, 2: warn, 3: info, 4: warn, 5: warn, 6: warn, 7: warn} {
		if levels[step] != want {
			t.Errorf("row %d level = %v, want %v", step, levels[step], want)
		}
	}

	// THE LEDGER — three posts, each under the uploader's key recipe; the found order carries its creator.
	posts := w.ledger.posted()
	if len(posts) != 3 {
		t.Fatalf("%d posts, want 3: %+v", len(posts), posts)
	}

	for _, p := range posts {
		if !strings.HasPrefix(p.UniqueID, "shopee:rincian_transaksi:") || p.TeamID != team || p.ShopID != shopeeShop {
			t.Errorf("post %+v", p)
		}
	}

	if posts[0].OrderID != 501 || posts[0].CreatedByUserID != orderMaker ||
		posts[0].SettlementType != settlementv1.SettlementType_SETTLEMENT_TYPE_FUND || posts[0].Change != 185_000 ||
		posts[0].OccurredOn != "2026-09-02" {
		t.Errorf("the order's post = %+v", posts[0])
	}

	if posts[1].OrderID != 0 || posts[1].Change != 77_000 {
		t.Errorf("an unmatched ref must post to the shop: %+v", posts[1])
	}

	if posts[2].SettlementType != settlementv1.SettlementType_SETTLEMENT_TYPE_WITHDRAWAL || posts[2].Change != -150_000 || posts[2].OrderID != 0 {
		t.Errorf("the completed withdrawal = %+v", posts[2])
	}

	// ONE lookup for the whole file.
	if len(w.orders.asked) != 1 || len(w.orders.asked[0]) != 2 {
		t.Errorf("the orders were asked %v — one call, both refs", w.orders.asked)
	}

	// THE FILE — stored under its content hash, and its row.
	sum := sha256.Sum256(content)
	hash := hex.EncodeToString(sum[:])

	if len(w.store.stored) != 1 || w.store.stored[0] != hash+".xlsx" {
		t.Fatalf("stored %v, want %s.xlsx", w.store.stored, hash)
	}

	files := fileRows(t, db)
	if len(files) != 1 {
		t.Fatalf("%d file rows", len(files))
	}

	file := files[0]
	if file.Status != "done" || file.ContentSha256 != hash || file.DocumentID != "doc-1" || file.CreatedByUserID != uploader ||
		file.PrimaryUserID != primaryCS || file.Platform != "shopee" || file.FinishedAt == nil {
		t.Errorf("file row = %+v", file)
	}

	if file.RowsTotal != 7 || file.RowsPosted != 3 || file.RowsExisting != 0 || file.RowsHeld != 2 ||
		file.RowsSkipped != 2 || file.RowsPostedToShop != 1 {
		t.Errorf("tallies = %+v", file)
	}

	// THE LINES — every one, with what became of it.
	lines := lineRows(t, db, file.ID)
	want := []struct{ outcome, reason string }{
		{"posted", ""},
		{"posted", "no_order"},
		{"posted", ""},
		{"skipped", "failed_withdrawal"},
		{"skipped", "failed_withdrawal"},
		{"held", "unmapped_type"},
		{"held", "fractional_amount"},
	}

	if len(lines) != len(want) {
		t.Fatalf("%d lines, want %d", len(lines), len(want))
	}

	for i, line := range lines {
		if line.Outcome != want[i].outcome || line.Reason != want[i].reason {
			t.Errorf("line %d = %s/%s, want %s/%s", i+1, line.Outcome, line.Reason, want[i].outcome, want[i].reason)
		}
	}

	if lines[0].OrderID != 501 || lines[0].SettlementLogID == 0 || lines[0].SettlementType != "fund" {
		t.Errorf("the posted order line = %+v", lines[0])
	}

	if lines[6].Detail != "1250.5" {
		t.Errorf("a fractional line keeps its figure as written: %q", lines[6].Detail)
	}
}

// the-row-key-is-the-only-dedupe: the same file twice is a SECOND upload — its own row — whose lines
// answer already there.
func TestShopeeSettlementImport_TheSameFileTwiceIsASecondUploadAlreadyThere(t *testing.T) {
	db := san_testdb.DB(t)
	w := newWorld(t, db)

	content := sevenShopeeRows(t)

	w.importShopee(t, shopeeShop, content)
	second := last(w.importShopee(t, shopeeShop, content))

	if second.text != "Done — 0 posted, 3 already there, 2 held, 2 skipped" {
		t.Fatalf("the second upload ended %q", second.text)
	}

	files := fileRows(t, db)
	if len(files) != 2 || files[0].ContentSha256 != files[1].ContentSha256 {
		t.Fatalf("want two rows sharing a hash, got %+v", files)
	}

	if len(w.ledger.posted()) != 3 {
		t.Fatalf("the ledger took %d rows — the second upload must post nothing", len(w.ledger.posted()))
	}
}

// the-shop-is-checked-before-the-file-is-stored: each refusal is ONE ERROR line, the stream ends, and
// nothing is stored — no document, no row.
func TestShopeeSettlementImport_TheShopCheckRefusesBeforeAnythingIsStored(t *testing.T) {
	for _, tc := range []struct {
		name  string
		shop  uint64
		setup func(w *world)
		want  string
	}{
		{"not a shop of the team", 999, nil, "not one of your team's shops"},
		{"no access", shopeeShop, func(w *world) {
			s := w.shops.shops[shopeeShop]
			s.HasAccess = false
			w.shops.shops[shopeeShop] = s
		}, "You have no access to Melati Official"},
		{"another platform's shop", tiktokShop, nil, "Melati TikTok is not a Shopee shop"},
		{"no primary CS", shopeeShop, func(w *world) {
			s := w.shops.shops[shopeeShop]
			s.PrimaryUserID = 0
			w.shops.shops[shopeeShop] = s
		}, "Melati Official has no primary CS — choose a primary CS first"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db := san_testdb.DB(t)
			w := newWorld(t, db)
			if tc.setup != nil {
				tc.setup(w)
			}

			messages := w.importShopee(t, tc.shop, sevenShopeeRows(t))

			if len(messages) != 1 || messages[0].level != settlement_importerv1.LogLevel_LOG_LEVEL_ERROR ||
				!strings.Contains(messages[0].text, tc.want) || messages[0].file != nil {
				t.Fatalf("messages = %+v, want one ERROR naming %q and no file", messages, tc.want)
			}

			if len(w.store.stored) != 0 || len(fileRows(t, db)) != 0 {
				t.Fatal("a refused request stored something")
			}
		})
	}
}

// a-file-with-another-shops-orders-is-refused: one ref whose order is ONLY in another shop of the team
// fails the whole file — named, nothing posted, the row FAILED. A ref the chosen shop also has is its own.
func TestShopeeSettlementImport_AFileWithAnotherShopsOrdersIsRefused(t *testing.T) {
	db := san_testdb.DB(t)
	w := newWorld(t, db)
	w.orders.byRef["2509AAA"] = []settlement_importer_v1.OrderRef{
		{OrderID: 501, ShopID: otherShop},
		{OrderID: 502, ShopID: shopeeShop}, // shared with the chosen shop — counts as its own
	}
	w.orders.byRef["2509ZZZ"] = []settlement_importer_v1.OrderRef{{OrderID: 601, ShopID: otherShop}}

	messages := w.importShopee(t, shopeeShop, sevenShopeeRows(t))

	end := last(messages)
	if end.level != settlement_importerv1.LogLevel_LOG_LEVEL_ERROR ||
		end.text != "1 of this file's orders belong to Melati Store — the whole file is refused, nothing was posted" ||
		end.file.GetStatus() != settlement_importerv1.UploadedFileStatus_UPLOADED_FILE_STATUS_FAILED {
		t.Fatalf("the last message = %+v", end)
	}

	if len(w.ledger.posted()) != 0 {
		t.Fatal("a refused file posted")
	}

	file := fileRows(t, db)[0]
	if file.Status != "failed" || !strings.Contains(file.Failure, "Melati Store") || len(lineRows(t, db, file.ID)) != 0 {
		t.Fatalf("the refused file's row = %+v", file)
	}
}

// A file the reader refuses is STORED first — it is exactly the file a developer needs — then FAILED.
func TestShopeeSettlementImport_NotAStatementIsStoredThenFailed(t *testing.T) {
	db := san_testdb.DB(t)
	w := newWorld(t, db)

	end := last(w.importShopee(t, shopeeShop, []byte("not a workbook at all")))

	if end.level != settlement_importerv1.LogLevel_LOG_LEVEL_ERROR || !strings.HasPrefix(end.text, "This is not a Shopee statement") ||
		end.file.GetStatus() != settlement_importerv1.UploadedFileStatus_UPLOADED_FILE_STATUS_FAILED {
		t.Fatalf("the last message = %+v", end)
	}

	if len(w.store.stored) != 1 {
		t.Fatal("the unreadable file was not kept")
	}
}

// A line settlement refuses is HELD with its reason — the stream goes on, and the same file again posts it.
func TestShopeeSettlementImport_ALineSettlementRefusesIsHeld(t *testing.T) {
	db := san_testdb.DB(t)
	w := newWorld(t, db)

	content := shopeeStatement(t,
		shopeeRow{"2026-09-03 09:00:00", "Penarikan Dana", "Penarikan Dana", "-", "Transaksi Keluar", "-150000.00", "Transaksi Selesai", "0.00"},
		shopeeRow{"2026-09-02 11:00:00", "Penghasilan dari Pesanan", "#2509ZZZ", "2509ZZZ", "Transaksi Masuk", "77000.00", "Transaksi Selesai", "150000.00"},
	)

	// Refuse the withdrawal line — its key is the importer's recipe over the reader's hash.
	w.ledger.refuse[shopeeKey(t, content, 0)] = connect.NewError(connect.CodeFailedPrecondition,
		errors.New("the shop has no primary CS — choose one before importing its statements"))

	end := last(w.importShopee(t, shopeeShop, content))
	if end.text != "Done — 1 posted, 0 already there, 1 held, 0 skipped" {
		t.Fatalf("the import ended %q", end.text)
	}

	files := fileRows(t, db)
	lines := lineRows(t, db, files[len(files)-1].ID)

	if lines[0].Outcome != "held" || lines[0].Reason != "refused" ||
		lines[0].Detail != "the shop has no primary CS — choose one before importing its statements" {
		t.Fatalf("the refused line = %+v", lines[0])
	}
}

// shopeeKey is the ledger key of a statement's row i — <platform>:<sheet>:<GenerateUniqueID>.
func shopeeKey(t *testing.T, content []byte, i int) string {
	t.Helper()

	doc, err := san_excel_readers.NewShopeeSettlementDocument(bytes.NewReader(content))
	if err != nil {
		t.Fatal(err)
	}

	items, _ := doc.GetItems()

	id, err := items[i].GenerateUniqueID()
	if err != nil {
		t.Fatal(err)
	}

	return "shopee:rincian_transaksi:" + id
}

// an-import-finishes-whether-anyone-watches: the watcher leaves after the first row, and the import posts
// every row and reads DONE anyway.
func TestShopeeSettlementImport_FinishesWhenNobodyIsWatching(t *testing.T) {
	db := san_testdb.DB(t)
	w := newWorld(t, db)
	w.ledger.delay = 80 * time.Millisecond

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	stream, err := w.client(t).ShopeeSettlementImport(ctx, connect.NewRequest(&settlement_importerv1.ShopeeSettlementImportRequest{
		TeamId: team, ShopId: shopeeShop, FileContent: sevenShopeeRows(t),
	}))
	if err != nil {
		t.Fatalf("ShopeeSettlementImport: %v", err)
	}

	for stream.Receive() {
		if stream.Msg().GetStep() == 1 {
			break
		}
	}

	// The tab closes.
	cancel()
	_ = stream.Close()

	w.svc.Wait()

	file := fileRows(t, db)[0]
	if file.Status != "done" || file.RowsPosted != 3 || file.RowsHeld != 2 || file.RowsSkipped != 2 {
		t.Fatalf("the unwatched import ended %+v", file)
	}

	if len(w.ledger.posted()) != 3 {
		t.Fatalf("%d posts, want 3", len(w.ledger.posted()))
	}
}
