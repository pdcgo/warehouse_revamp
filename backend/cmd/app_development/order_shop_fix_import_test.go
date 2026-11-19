package main

import (
	"bytes"
	"context"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"connectrpc.com/connect"
	"github.com/xuri/excelize/v2"
	"gorm.io/gorm"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1/sellingv1connect"
	settlementv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement/v1/settlementv1connect"
	settlement_importerv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement_importer/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/settlement_importer/v1/settlement_importerv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
	settlement_importer_v1 "github.com/pdcgo/warehouse_revamp/backend/services/settlement_importer_service/settlement_importer_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_service_models"
	"github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_v1"
)

// THE STATEMENT IMPORTS ONCE THE ORDER'S SHOP IS FIXED (an-orders-shop-is-fixed-and-counted-on-the-day — the owner's
// checklist: completed · order in the wrong shop · statement import refused → shop changed · statement import succeeds),
// through the importer's OWN path: its production adapters (importerShops, importerOrders, importerLedger) over the real
// selling and settlement handlers, and selling's OrderShopChanged delivered to settlement's push handler.

const (
	fixTeam     uint64 = 9_000_860
	fixUploader uint64 = 9_000_861
	fixCreator  uint64 = 9_000_862
	fixRef             = "2611FIXSHOP"
)

// Direct clients: the production adapters take Connect clients; these answer the one method each adapter calls from
// the real handler, in-process, so the import runs on one goroutine against the test's transaction.
type directOrders struct {
	sellingv1connect.OrderServiceClient
	svc *selling_v1.Service
}

func (d directOrders) OrderByExternalRefs(
	ctx context.Context,
	req *connect.Request[sellingv1.OrderByExternalRefsRequest],
) (*connect.Response[sellingv1.OrderByExternalRefsResponse], error) {
	return d.svc.OrderByExternalRefs(ctx, req)
}

type directShops struct {
	sellingv1connect.ShopServiceClient
	svc *selling_v1.Service
}

func (d directShops) ShopAccessCheck(
	ctx context.Context,
	req *connect.Request[sellingv1.ShopAccessCheckRequest],
) (*connect.Response[sellingv1.ShopAccessCheckResponse], error) {
	return d.svc.ShopAccessCheck(ctx, req)
}

type directLedger struct {
	settlementv1connect.SettlementWriteServiceClient
	svc *settlement_v1.Service
}

func (d directLedger) SettlementPost(
	ctx context.Context,
	req *connect.Request[settlementv1.SettlementPostRequest],
) (*connect.Response[settlementv1.SettlementPostResponse], error) {
	return d.svc.SettlementPost(ctx, req)
}

type keptStatements struct{ n int }

func (k *keptStatements) StoreStatement(context.Context, uint64, string, []byte) (string, error) {
	k.n++

	return "doc-" + strconv.Itoa(k.n), nil
}

// asStatementUploader is the access interceptor's header half for the importer's stream: the uploader's identity.
type asStatementUploader struct{}

func (asStatementUploader) WrapUnary(next connect.UnaryFunc) connect.UnaryFunc { return next }

func (asStatementUploader) WrapStreamingClient(next connect.StreamingClientFunc) connect.StreamingClientFunc {
	return next
}

func (asStatementUploader) WrapStreamingHandler(next connect.StreamingHandlerFunc) connect.StreamingHandlerFunc {
	return func(ctx context.Context, conn connect.StreamingHandlerConn) error {
		ctx = san_auth.WithIdentity(ctx, &role_basev1.Identity{IdentityId: fixUploader})

		return next(ctx, conn)
	}
}

// fixShopStatement is a Shopee Transaction Report with one income line for the order's ref.
func fixShopStatement(t *testing.T) []byte {
	t.Helper()

	file := excelize.NewFile()
	defer file.Close()

	sheet := file.GetSheetList()[0]

	for cell, value := range map[string]string{
		"A6": "Username (Penjual)", "B6": "melati.store", "A8": "Dari", "B8": "2026-11-01", "A9": "Ke", "B9": "2026-11-07",
	} {
		err := file.SetCellValue(sheet, cell, value)
		if err != nil {
			t.Fatal(err)
		}
	}

	header := []any{"Tanggal Transaksi", "Tipe Transaksi", "Deskripsi", "No. Pesanan", "Jenis Transaksi", "Jumlah", "Status", "Saldo Akhir"}

	err := file.SetSheetRow(sheet, "A18", &header)
	if err != nil {
		t.Fatal(err)
	}

	row := []any{"2026-11-03 10:00:00", "Penghasilan dari Pesanan", "Penghasilan dari Pesanan #" + fixRef, fixRef,
		"Transaksi Masuk", "110000.00", "Transaksi Selesai", "110000.00"}

	err = file.SetSheetRow(sheet, "A19", &row)
	if err != nil {
		t.Fatal(err)
	}

	var buf bytes.Buffer

	err = file.Write(&buf)
	if err != nil {
		t.Fatal(err)
	}

	return buf.Bytes()
}

func importFixStatement(t *testing.T, client settlement_importerv1connect.SettlementImporterServiceClient, shopID uint64, content []byte) string {
	t.Helper()

	stream, err := client.ShopeeSettlementImport(context.Background(), connect.NewRequest(&settlement_importerv1.ShopeeSettlementImportRequest{
		TeamId: fixTeam, ShopId: shopID, FileContent: content,
	}))
	if err != nil {
		t.Fatalf("ShopeeSettlementImport: %v", err)
	}
	defer stream.Close()

	last := ""
	for stream.Receive() {
		last = stream.Msg().GetMessage()
	}

	if stream.Err() != nil {
		t.Fatalf("stream: %v", stream.Err())
	}

	return last
}

func fixShopOf(t *testing.T, db *gorm.DB, name, code string) uint64 {
	t.Helper()

	shop := selling_service_models.Shop{TeamID: fixTeam, Name: name, ShopCode: code, Marketplace: "shopee"}

	err := db.Create(&shop).Error
	if err != nil {
		t.Fatalf("shop %s: %v", name, err)
	}

	// The uploader is its primary CS — an import needs one (a-shop-with-no-primary-cs-cannot-import).
	err = db.Create(&selling_service_models.ShopUser{ShopID: shop.ID, UserID: fixUploader, IsPrimary: true}).Error
	if err != nil {
		t.Fatalf("grant %s: %v", name, err)
	}

	return shop.ID
}

func TestOrderShopFix_TheNewShopsStatementImports(t *testing.T) {
	db := san_testdb.DB(t)

	settlement := settlement_v1.NewService(db, nil, nil, nil, nil, nil, nil)

	// selling's OrderShopChanged goes straight to settlement's push handler — what the broker does in the app.
	deliver := func(ctx context.Context, _ *role_basev1.Identity, event *eventsv1.Event) error {
		if event.GetOrderShopChanged() == nil {
			return nil
		}

		return settlement.OrderShopHandler()(ctx, event)
	}

	selling := selling_v1.NewService(db, nil, deliver, nil, nil, runsEveryShop{}, nil, nil, nil, nil, nil)

	wrong := fixShopOf(t, db, "Melati Official", "MO-FX")
	right := fixShopOf(t, db, "Melati Store", "MS-FX")

	// The order, completed, filed under the wrong shop — and its sale opened there, as the placement left it.
	order := selling_service_models.Order{
		TeamID: fixTeam, ShopID: wrong, WarehouseID: 9_000_869, Status: "completed", IdempotencyKey: newOrderKey(),
		OrderExternalRefID: fixRef, PlatformTotal: 120_000, TotalCost: 100_000, CreatedByUserID: fixCreator,
		Address: &selling_service_models.OrderAddress{CustomerName: "Budi"},
	}

	err := db.Create(&order).Error
	if err != nil {
		t.Fatalf("order: %v", err)
	}

	_, err = settlement.PostEntry(context.Background(), settlement_v1.PostInput{
		TeamID: fixTeam, ShopID: wrong, OrderID: order.ID, UniqueID: "order-placed:" + strconv.FormatUint(order.ID, 10),
		SettlementType: settlementv1.SettlementType_SETTLEMENT_TYPE_INITIAL_TOTAL,
		SourceType:     settlementv1.SourceType_SOURCE_TYPE_ORDER, Change: -120_000, OccurredOn: "2026-11-01",
		CreatedByUserID: fixCreator, ActorID: fixCreator,
	})
	if err != nil {
		t.Fatalf("open the sale: %v", err)
	}

	importer := settlement_importer_v1.NewService(db,
		NewImporterShopChecker(directShops{svc: selling}),
		NewImporterOrderFinder(directOrders{svc: selling}),
		&keptStatements{},
		NewImporterLedger(directLedger{svc: settlement}))

	mux := http.NewServeMux()
	mux.Handle(settlement_importerv1connect.NewSettlementImporterServiceHandler(importer,
		connect.WithInterceptors(asStatementUploader{})))

	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)

	client := settlement_importerv1connect.NewSettlementImporterServiceClient(server.Client(), server.URL)
	statement := fixShopStatement(t)

	// BEFORE: the right shop's statement is refused — its order sits in another shop.
	refused := importFixStatement(t, client, right, statement)
	if !strings.Contains(refused, "belong to Melati Official") || !strings.Contains(refused, "nothing was posted") {
		t.Fatalf("before the fix the import ended %q, want it refused naming Melati Official", refused)
	}

	// THE FIX.
	_, err = selling.OrderShopUpdate(san_auth.WithIdentity(context.Background(), &role_basev1.Identity{IdentityId: fixUploader}),
		connect.NewRequest(&sellingv1.OrderShopUpdateRequest{TeamId: fixTeam, OrderId: order.ID, ShopId: right}))
	if err != nil {
		t.Fatalf("OrderShopUpdate: %v", err)
	}

	var account settlement_service_models.OrderSettlement

	err = db.Where("order_id = ?", order.ID).Take(&account).Error
	if err != nil || account.ShopID != right {
		t.Fatalf("the account is on %d (err %v), want the fixed shop %d", account.ShopID, err, right)
	}

	// AFTER: the same statement imports, its line posted onto the order's account under the right shop.
	done := importFixStatement(t, client, right, statement)
	if !strings.HasPrefix(done, "Done — 1 posted") {
		t.Fatalf("after the fix the import ended %q, want its one line posted", done)
	}

	var fund []settlement_service_models.SettlementLog

	err = db.Where("order_id = ? AND settlement_type = 'fund'", order.ID).Find(&fund).Error
	if err != nil || len(fund) != 1 || fund[0].ShopID != right || !san_money.Equal(fund[0].Change, 110_000) ||
		fund[0].SourceType != "importer" {
		t.Fatalf("the statement's line = %+v (err %v), want 110.000 of fund under shop %d", fund, err, right)
	}

	err = db.Where("order_id = ?", order.ID).Take(&account).Error
	if err != nil || !san_money.Equal(account.LastBalance, -10_000) || !san_money.Equal(account.InitialTotal, 120_000) {
		t.Fatalf("account = %+v (err %v), want the sale 120.000 and a balance of −10.000", account, err)
	}

	var oldShop float64

	err = db.Raw(`SELECT COALESCE(SUM(change), 0) FROM settlement_logs WHERE order_id = ? AND shop_id = ?`, order.ID, wrong).
		Scan(&oldShop).Error
	if err != nil || !san_money.IsZero(oldShop) {
		t.Fatalf("the wrong shop still holds %v of the order (err %v)", oldShop, err)
	}

}
