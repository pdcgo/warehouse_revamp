package selling_v1_test

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"connectrpc.com/connect"
	"github.com/xuri/excelize/v2"
	"gorm.io/gorm"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1/sellingv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// fakeExports keeps the stored file and names the rows from fixed maps.
type fakeExports struct {
	content  []byte
	filename string
	teamID   uint64
}

func (f *fakeExports) Store(_ context.Context, teamID uint64, filename string, content []byte) (string, error) {
	f.teamID, f.filename, f.content = teamID, filename, content

	return "https://files.example/" + filename, nil
}

func (f *fakeExports) TeamNames(_ context.Context, ids []uint64) (map[uint64]string, error) {
	return pick(map[uint64]string{2: "Toko Melati", 3: "Toko Kenanga"}, ids), nil
}

func (f *fakeExports) UserNames(_ context.Context, ids []uint64) (map[uint64]string, error) {
	return pick(map[uint64]string{}, ids), nil
}

func pick(all map[uint64]string, ids []uint64) map[uint64]string {
	out := map[uint64]string{}
	for _, id := range ids {
		if name, ok := all[id]; ok {
			out[id] = name
		}
	}

	return out
}

type exportRun struct {
	messages []*sellingv1.OrderExportResponse
	rows     [][]string
	file     *excelize.File
}

// export runs OrderExport over a real HTTP stream — a server-streaming handler cannot be called directly.
func export(t *testing.T, db *gorm.DB, store *fakeExports, req *sellingv1.OrderExportRequest) exportRun {
	t.Helper()

	svc := selling_v1.NewService(db, &fakePicker{}, nil, &fakeCatalog{}, &fakeCredit{}, nil, store, nil)

	mux := http.NewServeMux()
	mux.Handle(sellingv1connect.NewOrderServiceHandler(svc))

	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)

	client := sellingv1connect.NewOrderServiceClient(server.Client(), server.URL)

	stream, err := client.OrderExport(context.Background(), connect.NewRequest(req))
	if err != nil {
		t.Fatalf("OrderExport: %v", err)
	}
	defer stream.Close()

	var run exportRun
	for stream.Receive() {
		run.messages = append(run.messages, stream.Msg())
	}

	if stream.Err() != nil {
		t.Fatalf("stream: %v", stream.Err())
	}

	run.file, err = excelize.OpenReader(bytes.NewReader(store.content))
	if err != nil {
		t.Fatalf("open the exported file: %v", err)
	}

	run.rows, err = run.file.GetRows("Sheet1")
	if err != nil {
		t.Fatalf("read the exported rows: %v", err)
	}

	return run
}

func phoneOrder(t *testing.T, svc *selling_v1.Service, teamID, shopID uint64, phone string) uint64 {
	t.Helper()

	resp, err := svc.OrderCreate(context.Background(), connect.NewRequest(&sellingv1.OrderCreateRequest{
		PlatformCreatedAtUnix: testPlatformDate,
		TeamId:                teamID, ShopId: shopID, WarehouseId: testWarehouse,
		CustomerName: "Budi", CustomerPhone: phone, ShippingCode: "jne",
		OrderExternalRefId: "5780000000000000001", ReceiptCode: "JP0012345678", Subtotal: 10000, Total: 10000,
		Items: []*sellingv1.OrderItem{{ProductId: 1, Sku: "SKU1", Name: "Widget", Quantity: 3, UnitPrice: 10000}},
	}))
	if err != nil {
		t.Fatalf("place order: %v", err)
	}

	return resp.Msg.GetOrder().GetId()
}

// THE SELLER'S FILE (one-export-is-the-list-as-a-file): exactly its own orders, in its columns, ids and phones as text,
// with progress on the way and the link at the end.
func TestOrderExport_TheSellersFile(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	melati := insertShop(t, db, 2, "Melati Official", "MEL-S", "shopee")
	kenanga := insertShop(t, db, 3, "Kenanga Official", "KEN-S", "shopee")

	phoneOrder(t, svc, 2, melati, "0812000111")
	phoneOrder(t, svc, 2, melati, "0812000222")
	phoneOrder(t, svc, 3, kenanga, "0813000333") // another seller's — never in Melati's file

	store := &fakeExports{}
	run := export(t, db, store, &sellingv1.OrderExportRequest{
		TeamId: 2, Filter: &sellingv1.OrderListFilter{}, View: sellingv1.OrderExportView_ORDER_EXPORT_VIEW_SELLER,
	})

	if len(run.rows) != 3 {
		t.Fatalf("%d rows (header included), want 3 — the header and Melati's two orders: %v", len(run.rows), run.rows)
	}

	if run.rows[0][0] != "Order ID" || run.rows[0][8] != "Phone" {
		t.Fatalf("header = %v", run.rows[0])
	}

	// The phone keeps its 0, and the long marketplace id is not turned into 5.78E+17: both are TEXT cells.
	if run.rows[1][8] != "0812000222" {
		t.Fatalf("phone = %q, want 0812000222 (newest first)", run.rows[1][8])
	}

	for _, cell := range []string{"I2", "B2"} {
		kind, err := run.file.GetCellType("Sheet1", cell)
		if err != nil {
			t.Fatalf("cell type of %s: %v", cell, err)
		}

		if kind == excelize.CellTypeNumber {
			t.Fatalf("%s is a NUMBER cell — a phone or a marketplace id must be text", cell)
		}
	}

	if run.rows[1][1] != "5780000000000000001" {
		t.Fatalf("marketplace ref = %q", run.rows[1][1])
	}

	if run.rows[1][10] != "JP0012345678" {
		t.Fatalf("tracking number = %q, want the one typed at create", run.rows[1][10])
	}

	if run.rows[1][11] != "3" {
		t.Fatalf("qty = %q, want 3", run.rows[1][11])
	}

	// Never priced (this service has no pricer), so the fee cell is EMPTY — not a 0, which would read as a warehouse
	// that charged nothing.
	if len(run.rows[1]) > 13 && run.rows[1][13] != "" {
		t.Fatalf("warehouse fee = %q, want empty for an order never priced", run.rows[1][13])
	}

	last := run.messages[len(run.messages)-1]
	if last.GetDownloadUrl() == "" || last.GetDone() != 2 || last.GetTotal() != 2 {
		t.Fatalf("last message = %+v, want the link and 2 of 2", last)
	}

	if store.teamID != 2 {
		t.Fatalf("stored under team %d, want the caller's team 2", store.teamID)
	}

	if len(run.messages) < 2 {
		t.Fatalf("%d messages — want progress before the link", len(run.messages))
	}
}

// THE WAREHOUSE'S FILE: every seller's orders shipping from it, the seller named, and the list's status tab honoured.
func TestOrderExport_TheWarehousesFileHonoursTheFilter(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	melati := insertShop(t, db, 2, "Melati Official", "MEL-S", "shopee")
	kenanga := insertShop(t, db, 3, "Kenanga Official", "KEN-S", "shopee")

	phoneOrder(t, svc, 2, melati, "0812000111")
	kenangaOrder := phoneOrder(t, svc, 3, kenanga, "0813000333")
	moveOrder(t, svc, testWarehouse, kenangaOrder, sellingv1.OrderStatus_ORDER_STATUS_PROCESSED, "")

	all := export(t, db, &fakeExports{}, &sellingv1.OrderExportRequest{
		TeamId: testWarehouse, Filter: &sellingv1.OrderListFilter{}, View: sellingv1.OrderExportView_ORDER_EXPORT_VIEW_WAREHOUSE,
	})

	if len(all.rows) != 3 || all.rows[0][3] != "Seller" {
		t.Fatalf("rows = %v — want the header and both sellers' orders", all.rows)
	}

	sellers := map[string]bool{all.rows[1][3]: true, all.rows[2][3]: true}
	if !sellers["Toko Melati"] || !sellers["Toko Kenanga"] {
		t.Fatalf("sellers named %v, want both by name", sellers)
	}

	processed := export(t, db, &fakeExports{}, &sellingv1.OrderExportRequest{
		TeamId: testWarehouse,
		Filter: &sellingv1.OrderListFilter{Status: sellingv1.OrderStatus_ORDER_STATUS_PROCESSED},
		View:   sellingv1.OrderExportView_ORDER_EXPORT_VIEW_WAREHOUSE,
	})

	if len(processed.rows) != 2 || processed.rows[1][10] != "processed" {
		t.Fatalf("the processed tab's file = %v — want only Kenanga's processed order", processed.rows)
	}

	// The bar's selection (the-bulk-actions-are-always-on-screen): only the ticked rows.
	ticked := export(t, db, &fakeExports{}, &sellingv1.OrderExportRequest{
		TeamId:   testWarehouse,
		Filter:   &sellingv1.OrderListFilter{},
		View:     sellingv1.OrderExportView_ORDER_EXPORT_VIEW_WAREHOUSE,
		OrderIds: []uint64{kenangaOrder},
	})

	if len(ticked.rows) != 2 || ticked.rows[1][3] != "Toko Kenanga" {
		t.Fatalf("the ticked file = %v — want Kenanga's one order", ticked.rows)
	}
}
