package settlement_importer_v1_test

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"connectrpc.com/connect"
	"github.com/xuri/excelize/v2"
	"gorm.io/gorm"

	marketplacev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/marketplace/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	settlement_importerv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement_importer/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement_importer/v1/settlement_importerv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	settlement_importer_v1 "github.com/pdcgo/warehouse_revamp/backend/services/settlement_importer_service/settlement_importer_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/settlement_importer_service/settlement_importer_service_models"
)

// The world these tests import into: team 12 runs a Shopee shop and a TikTok shop, and a Tokopedia one
// that cannot import.
const (
	team        uint64 = 12
	shopeeShop  uint64 = 21
	tiktokShop  uint64 = 25
	otherShop   uint64 = 22
	uploader    uint64 = 61
	primaryCS   uint64 = 63
	orderMaker  uint64 = 70
	strangerOne uint64 = 99
)

// ── the four services, faked ──────────────────────────────────────────────────────────────────────

type fakeShops struct {
	shops map[uint64]settlement_importer_v1.ShopCheck
}

func newFakeShops() *fakeShops {
	return &fakeShops{shops: map[uint64]settlement_importer_v1.ShopCheck{
		shopeeShop: {ID: shopeeShop, Name: "Melati Official", Marketplace: marketplacev1.Marketplace_MARKETPLACE_SHOPEE, PrimaryUserID: primaryCS, HasAccess: true},
		tiktokShop: {ID: tiktokShop, Name: "Melati TikTok", Marketplace: marketplacev1.Marketplace_MARKETPLACE_TIKTOK, PrimaryUserID: primaryCS, HasAccess: true},
		otherShop:  {ID: otherShop, Name: "Melati Store", Marketplace: marketplacev1.Marketplace_MARKETPLACE_TOKOPEDIA, PrimaryUserID: primaryCS, HasAccess: true},
	}}
}

func (f *fakeShops) CheckShop(_ context.Context, teamID, shopID, _ uint64) (settlement_importer_v1.ShopCheck, error) {
	shop, ok := f.shops[shopID]
	if !ok || teamID != team {
		return settlement_importer_v1.ShopCheck{}, connect.NewError(connect.CodeNotFound, errors.New("shop not found"))
	}

	return shop, nil
}

type fakeOrders struct {
	byRef map[string][]settlement_importer_v1.OrderRef
	err   error
	asked [][]string
}

func (f *fakeOrders) OrdersByRefs(_ context.Context, _ uint64, refs []string) (map[string][]settlement_importer_v1.OrderRef, error) {
	f.asked = append(f.asked, refs)
	if f.err != nil {
		return nil, f.err
	}

	out := map[string][]settlement_importer_v1.OrderRef{}
	for _, ref := range refs {
		if orders, ok := f.byRef[ref]; ok {
			out[ref] = orders
		}
	}

	return out, nil
}

type fakeStore struct {
	stored []string // filenames
	err    error
}

func (f *fakeStore) StoreStatement(_ context.Context, _ uint64, filename string, _ []byte) (string, error) {
	if f.err != nil {
		return "", f.err
	}

	f.stored = append(f.stored, filename)

	return fmt.Sprintf("doc-%d", len(f.stored)), nil
}

// fakeLedger is SettlementPost's idempotency on the key: a key seen before answers created false.
type fakeLedger struct {
	mu      sync.Mutex
	posts   []settlement_importer_v1.LedgerPost
	byKey   map[string]uint64
	refuse  map[string]error
	delay   time.Duration
	started chan struct{}
}

func newFakeLedger() *fakeLedger {
	return &fakeLedger{byKey: map[string]uint64{}, refuse: map[string]error{}}
}

func (f *fakeLedger) Post(_ context.Context, post settlement_importer_v1.LedgerPost) (settlement_importer_v1.LedgerResult, error) {
	if f.started != nil {
		select {
		case f.started <- struct{}{}:
		default:
		}
	}

	if f.delay > 0 {
		time.Sleep(f.delay)
	}

	f.mu.Lock()
	defer f.mu.Unlock()

	if err, ok := f.refuse[post.UniqueID]; ok {
		return settlement_importer_v1.LedgerResult{}, err
	}

	if id, ok := f.byKey[post.UniqueID]; ok {
		return settlement_importer_v1.LedgerResult{LogID: id, Created: false}, nil
	}

	id := uint64(len(f.byKey) + 1)
	f.byKey[post.UniqueID] = id
	f.posts = append(f.posts, post)

	return settlement_importer_v1.LedgerResult{LogID: id, Created: true}, nil
}

func (f *fakeLedger) posted() []settlement_importer_v1.LedgerPost {
	f.mu.Lock()
	defer f.mu.Unlock()

	return append([]settlement_importer_v1.LedgerPost{}, f.posts...)
}

type world struct {
	db     *gorm.DB
	shops  *fakeShops
	orders *fakeOrders
	store  *fakeStore
	ledger *fakeLedger
	svc    *settlement_importer_v1.Service
}

func newWorld(t *testing.T, db *gorm.DB) *world {
	t.Helper()

	w := &world{
		db:     db,
		shops:  newFakeShops(),
		orders: &fakeOrders{byRef: map[string][]settlement_importer_v1.OrderRef{}},
		store:  &fakeStore{},
		ledger: newFakeLedger(),
	}
	w.svc = settlement_importer_v1.NewService(db, w.shops, w.orders, w.store, w.ledger)

	return w
}

// ── the stream, over HTTP ─────────────────────────────────────────────────────────────────────────

// asUploader stands in for the access interceptor's HEADER half: the handler's ctx carries the uploader's
// identity and bearer, as a real server stream's does (a-server-stream-is-authorized-on-its-request).
type asUploader struct{ id uint64 }

func (a asUploader) WrapUnary(next connect.UnaryFunc) connect.UnaryFunc { return next }

func (a asUploader) WrapStreamingClient(next connect.StreamingClientFunc) connect.StreamingClientFunc {
	return next
}

func (a asUploader) WrapStreamingHandler(next connect.StreamingHandlerFunc) connect.StreamingHandlerFunc {
	return func(ctx context.Context, conn connect.StreamingHandlerConn) error {
		ctx = san_auth.WithIdentity(ctx, &role_basev1.Identity{IdentityId: a.id})
		ctx = san_auth.WithBearer(ctx, "uploader-token")

		return next(ctx, conn)
	}
}

func (w *world) client(t *testing.T) settlement_importerv1connect.SettlementImporterServiceClient {
	t.Helper()

	mux := http.NewServeMux()
	mux.Handle(settlement_importerv1connect.NewSettlementImporterServiceHandler(w.svc,
		connect.WithInterceptors(asUploader{id: uploader})))

	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)

	return settlement_importerv1connect.NewSettlementImporterServiceClient(server.Client(), server.URL)
}

// message is one streamed response, whichever import sent it.
type message struct {
	level   settlement_importerv1.LogLevel
	text    string
	step    uint32
	count   uint32
	file    *settlement_importerv1.UploadedFile
}

func (w *world) importShopee(t *testing.T, shopID uint64, content []byte) []message {
	t.Helper()

	stream, err := w.client(t).ShopeeSettlementImport(context.Background(), connect.NewRequest(&settlement_importerv1.ShopeeSettlementImportRequest{
		TeamId: team, ShopId: shopID, FileContent: content,
	}))
	if err != nil {
		t.Fatalf("ShopeeSettlementImport: %v", err)
	}
	defer stream.Close()

	var out []message
	for stream.Receive() {
		m := stream.Msg()
		out = append(out, message{m.GetLevel(), m.GetMessage(), m.GetStep(), m.GetCount(), m.GetFile()})
	}

	if stream.Err() != nil {
		t.Fatalf("stream: %v", stream.Err())
	}

	return out
}

func (w *world) importTiktok(t *testing.T, shopID uint64, content []byte) []message {
	t.Helper()

	stream, err := w.client(t).TiktokSettlementImport(context.Background(), connect.NewRequest(&settlement_importerv1.TiktokSettlementImportRequest{
		TeamId: team, ShopId: shopID, FileContent: content,
	}))
	if err != nil {
		t.Fatalf("TiktokSettlementImport: %v", err)
	}
	defer stream.Close()

	var out []message
	for stream.Receive() {
		m := stream.Msg()
		out = append(out, message{m.GetLevel(), m.GetMessage(), m.GetStep(), m.GetCount(), m.GetFile()})
	}

	if stream.Err() != nil {
		t.Fatalf("stream: %v", stream.Err())
	}

	return out
}

func last(messages []message) message {
	if len(messages) == 0 {
		return message{}
	}

	return messages[len(messages)-1]
}

func fileRows(t *testing.T, db *gorm.DB) []settlement_importer_service_models.UploadedFile {
	t.Helper()

	var files []settlement_importer_service_models.UploadedFile

	err := db.Order("id").Find(&files).Error
	if err != nil {
		t.Fatalf("read files: %v", err)
	}

	return files
}

func lineRows(t *testing.T, db *gorm.DB, fileID uint64) []settlement_importer_service_models.UploadedFileLine {
	t.Helper()

	var lines []settlement_importer_service_models.UploadedFileLine

	err := db.Where("uploaded_file_id = ?", fileID).Order("line_no").Find(&lines).Error
	if err != nil {
		t.Fatalf("read lines: %v", err)
	}

	return lines
}

// ── statements, built in memory ───────────────────────────────────────────────────────────────────

// shopeeRow is one "Rincian Transaksi" row, as Shopee writes it.
type shopeeRow struct {
	at, kind, description, ref, direction, amount, status, balance string
}

// shopeeStatement builds a Shopee "Transaction Report" — the preamble, the header on row 18, the rows.
func shopeeStatement(t *testing.T, rows ...shopeeRow) []byte {
	t.Helper()

	file := excelize.NewFile()
	defer file.Close()

	sheet := file.GetSheetList()[0]

	set := func(cell string, value any) {
		err := file.SetCellValue(sheet, cell, value)
		if err != nil {
			t.Fatal(err)
		}
	}

	set("A6", "Username (Penjual)")
	set("B6", "melati.official")
	set("A8", "Dari")
	set("B8", "2026-09-01")
	set("A9", "Ke")
	set("B9", "2026-09-07")

	header := []any{"Tanggal Transaksi", "Tipe Transaksi", "Deskripsi", "No. Pesanan", "Jenis Transaksi", "Jumlah", "Status", "Saldo Akhir"}

	err := file.SetSheetRow(sheet, "A18", &header)
	if err != nil {
		t.Fatal(err)
	}

	for i, r := range rows {
		values := []any{r.at, r.kind, r.description, r.ref, r.direction, r.amount, r.status, r.balance}

		err := file.SetSheetRow(sheet, fmt.Sprintf("A%d", 19+i), &values)
		if err != nil {
			t.Fatal(err)
		}
	}

	return writeWorkbook(t, file)
}

// tiktokOrder is one "Order details" row. Commission is the file's two Affiliate columns, as written.
type tiktokOrder struct {
	id, kind, related, settled, amount, affiliate, shopAds string
}

type tiktokWithdrawal struct {
	kind, reference, requested, amount, status string
}

// tiktokStatement builds a TikTok export — Order details (with its Affiliate columns unless noAffiliate),
// Reports and Withdrawal records.
func tiktokStatement(t *testing.T, currency string, noAffiliate bool, orders []tiktokOrder, withdrawals []tiktokWithdrawal) []byte {
	t.Helper()

	file := excelize.NewFile()
	defer file.Close()

	orderSheet := "Order details"
	_, err := file.NewSheet(orderSheet)
	if err != nil {
		t.Fatal(err)
	}

	header := []any{"Order/adjustment ID", "Type", "Order created time", "Order settled time", "Currency",
		"Total settlement amount", "Total Revenue", "Total Fees", "Related order ID", "Order Source"}
	if !noAffiliate {
		header = append(header, "Affiliate Commission", "Affiliate Shop Ads commission")
	}

	err = file.SetSheetRow(orderSheet, "A1", &header)
	if err != nil {
		t.Fatal(err)
	}

	for i, o := range orders {
		values := []any{o.id, o.kind, o.settled, o.settled, currency, o.amount, o.amount, "0", o.related, "TikTok Shop"}
		if !noAffiliate {
			values = append(values, o.affiliate, o.shopAds)
		}

		err := file.SetSheetRow(orderSheet, fmt.Sprintf("A%d", 2+i), &values)
		if err != nil {
			t.Fatal(err)
		}
	}

	reports := "Reports"
	_, err = file.NewSheet(reports)
	if err != nil {
		t.Fatal(err)
	}

	for i, row := range [][]any{
		{"Time period:", "2026/09/01-2026/09/07"},
		{"Timezone", "UTC+7"},
		{"Currency", currency},
	} {
		err := file.SetSheetRow(reports, fmt.Sprintf("A%d", 1+i), &row)
		if err != nil {
			t.Fatal(err)
		}
	}

	withdrawalSheet := "Withdrawal records"
	_, err = file.NewSheet(withdrawalSheet)
	if err != nil {
		t.Fatal(err)
	}

	wHeader := []any{"Type", "Reference ID", "Request time", "Amount", "Status", "Success time"}

	err = file.SetSheetRow(withdrawalSheet, "A1", &wHeader)
	if err != nil {
		t.Fatal(err)
	}

	for i, w := range withdrawals {
		values := []any{w.kind, w.reference, w.requested, w.amount, w.status, w.requested}

		err := file.SetSheetRow(withdrawalSheet, fmt.Sprintf("A%d", 2+i), &values)
		if err != nil {
			t.Fatal(err)
		}
	}

	return writeWorkbook(t, file)
}

func writeWorkbook(t *testing.T, file *excelize.File) []byte {
	t.Helper()

	var buffer bytes.Buffer

	err := file.Write(&buffer)
	if err != nil {
		t.Fatal(err)
	}

	return buffer.Bytes()
}
