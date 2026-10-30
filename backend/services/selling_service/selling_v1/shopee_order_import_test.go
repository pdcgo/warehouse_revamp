package selling_v1_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1/sellingv1connect"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// The two Shopee mocks: the same shop's export read on 23 Oct, and again on 27 Oct (examples/order_samples/README.md).
const (
	shopeeEarly = "mock_order_all_20261020_20261023.xlsx"
	shopeeLate  = "mock_order_all_20261020_20261027.xlsx"
)

// importRun is what an import streamed: every message, and the lines by level.
type importRun struct {
	count    uint32
	tally    *sellingv1.OrderImportTally
	info     []string
	warn     []string
	errors   []string
	lastStep uint32
}

// line is the one line naming `ref`, whatever its level — or "" when no line names it.
func (r importRun) line(ref string) string {
	for _, lines := range [][]string{r.info, r.warn, r.errors} {
		for _, line := range lines {
			if strings.HasPrefix(line, ref+":") {
				return line
			}
		}
	}

	return ""
}

// orderSample is a file from examples/order_samples — the mocks the import is built against.
func orderSample(t *testing.T, platform, name string) []byte {
	t.Helper()

	content, err := os.ReadFile(filepath.Join("..", "..", "..", "..", "examples", "order_samples", platform, name))
	if err != nil {
		t.Fatalf("read the sample: %v", err)
	}

	return content
}

// importClient serves OrderService over a real HTTP stream — a server-streaming handler cannot be called directly.
func importClient(t *testing.T, db *gorm.DB) sellingv1connect.OrderServiceClient {
	t.Helper()

	mux := http.NewServeMux()
	mux.Handle(sellingv1connect.NewOrderServiceHandler(newService(t, db)))

	server := httptest.NewServer(mux)
	t.Cleanup(server.Close)

	return sellingv1connect.NewOrderServiceClient(server.Client(), server.URL)
}

// importMessage is either platform's response — they carry the same five fields.
type importMessage interface {
	GetLevel() sellingv1.OrderImportLogLevel
	GetMessage() string
	GetStep() uint32
	GetCount() uint32
	GetTally() *sellingv1.OrderImportTally
}

func collectImport(t *testing.T, receive func() bool, msg func() importMessage, done func() error) importRun {
	t.Helper()

	var run importRun

	for receive() {
		m := msg()
		run.count = m.GetCount()
		run.lastStep = m.GetStep()

		if m.GetTally() != nil {
			run.tally = m.GetTally()
		}

		switch m.GetLevel() {
		case sellingv1.OrderImportLogLevel_ORDER_IMPORT_LOG_LEVEL_WARN:
			run.warn = append(run.warn, m.GetMessage())
		case sellingv1.OrderImportLogLevel_ORDER_IMPORT_LOG_LEVEL_ERROR:
			run.errors = append(run.errors, m.GetMessage())
		default:
			run.info = append(run.info, m.GetMessage())
		}
	}

	err := done()
	if err != nil {
		t.Fatalf("stream: %v", err)
	}

	return run
}

func shopeeImport(t *testing.T, client sellingv1connect.OrderServiceClient, shopID uint64, content []byte) importRun {
	t.Helper()

	stream, err := client.ShopeeOrderImport(context.Background(), connect.NewRequest(&sellingv1.ShopeeOrderImportRequest{
		TeamId: 2, ShopId: shopID, FileContent: content,
	}))
	if err != nil {
		t.Fatalf("ShopeeOrderImport: %v", err)
	}
	defer stream.Close()

	return collectImport(t, stream.Receive, func() importMessage { return stream.Msg() }, stream.Err)
}

// seedImportOrder writes an order of team 2 straight into a status, with the ref the file names.
func seedImportOrder(t *testing.T, db *gorm.DB, shopID uint64, ref, status string) uint64 {
	t.Helper()

	order := selling_service_models.Order{
		TeamID: 2, ShopID: shopID, WarehouseID: testWarehouse,
		Status: status, OrderExternalRefID: ref, CustomerName: "Budi",
	}

	err := db.Create(&order).Error
	if err != nil {
		t.Fatalf("seed order %s: %v", ref, err)
	}

	return order.ID
}

func statusOf(t *testing.T, db *gorm.DB, orderID uint64) string {
	t.Helper()

	var order selling_service_models.Order

	err := db.Select("status").First(&order, orderID).Error
	if err != nil {
		t.Fatalf("read order %d: %v", orderID, err)
	}

	return order.Status
}

func wantTally(t *testing.T, run importRun, moved, already, notApplied uint32) {
	t.Helper()

	got := run.tally
	if got == nil {
		t.Fatalf("no tally; errors %v", run.errors)
	}

	if got.GetMoved() != moved || got.GetAlreadyThere() != already || got.GetNotApplied() != notApplied {
		t.Fatalf("tally moved %d, already %d, not applied %d — want %d, %d, %d\nwarn: %v",
			got.GetMoved(), got.GetAlreadyThere(), got.GetNotApplied(), moved, already, notApplied, run.warn)
	}
}

func wantLine(t *testing.T, run importRun, ref, contains string) {
	t.Helper()

	line := run.line(ref)
	if !strings.Contains(line, contains) {
		t.Fatalf("line for %s is %q, want it to say %q", ref, line, contains)
	}
}

// the-import-moves-only-after-handover, every row of its table against the 27 Oct export: customer service's moves are
// made, the rest is listed with its reason, and the tally sums to the orders in the file.
func TestShopeeOrderImport_MakesCustomerServicesMovesAndListsTheRest(t *testing.T) {
	db := san_testdb.DB(t)
	client := importClient(t, db)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	completed := seedImportOrder(t, db, shop, "2610201A2B3C4D", "completed")
	delivered := seedImportOrder(t, db, shop, "2610201E5F6G7H", "shipped")
	returned := seedImportOrder(t, db, shop, "2610212J8K9L0M", "shipped")
	inTransit := seedImportOrder(t, db, shop, "2610212N1P2Q3R", "shipping")
	notHandedOver := seedImportOrder(t, db, shop, "2610223S4T5U6V", "picked")
	pending := seedImportOrder(t, db, shop, "2610223W7X8Y9Z", "pending")
	seedImportOrder(t, db, shop, "2610224A1C3E5G", "cancel")

	run := shopeeImport(t, client, shop, orderSample(t, "shopee", shopeeLate))

	if len(run.errors) > 0 {
		t.Fatalf("errors: %v", run.errors)
	}

	if run.count != 9 || run.lastStep != 9 {
		t.Fatalf("count %d, last step %d — want 9 orders, the bar full at the end", run.count, run.lastStep)
	}

	// Two of the three cancelled refs have nothing live here — counted as already there
	// (a-cancelled-order-with-nothing-live-is-already-there). The pending one is customer service's to-do.
	wantTally(t, run, 3, 3, 3)

	for id, want := range map[uint64]string{
		completed:     "completed",
		delivered:     "completed",
		returned:      "return",
		inTransit:     "shipped",
		notHandedOver: "picked",
		pending:       "pending",
	} {
		if got := statusOf(t, db, id); got != want {
			t.Fatalf("order %d is %s, want %s", id, got, want)
		}
	}

	wantLine(t, run, "2610201E5F6G7H", "shipped → completed")
	wantLine(t, run, "2610201A2B3C4D", "already completed")
	wantLine(t, run, "2610223S4T5U6V", "not handed over yet: still picked here")
	wantLine(t, run, "2610223W7X8Y9Z", "cancelled on the platform (Batal)")
	wantLine(t, run, "2610224A1C3E5G", "cancelled on the platform, and no live order here")
	wantLine(t, run, "2610235H7J9K2L", "cancelled on the platform, and no live order here")
	wantLine(t, run, "2610256M4N6P8Q", "no such order in Toko A")

	// Each move is a timeline row like a hand move's, saying where it came from.
	var logs []selling_service_models.OrderTimelineLog

	err := db.Where("order_id = ?", inTransit).Find(&logs).Error
	if err != nil {
		t.Fatalf("timeline: %v", err)
	}

	if len(logs) != 1 || logs[0].Status != "shipped" || logs[0].Note != "Shopee order import" {
		t.Fatalf("timeline of the moved order: %+v", logs)
	}
}

// Importing the same file twice changes nothing the second time: what moved is already there.
func TestShopeeOrderImport_TheSameFileTwiceChangesNothing(t *testing.T) {
	db := san_testdb.DB(t)
	client := importClient(t, db)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	seedImportOrder(t, db, shop, "2610201E5F6G7H", "shipped")
	seedImportOrder(t, db, shop, "2610212N1P2Q3R", "shipping")

	file := orderSample(t, "shopee", shopeeLate)

	wantTally(t, shopeeImport(t, client, shop, file), 2, 3, 4)
	wantTally(t, shopeeImport(t, client, shop, file), 0, 5, 4)
}

// A file older than ours never moves an order backwards: it is listed as behind.
func TestShopeeOrderImport_AFileBehindOursIsListed(t *testing.T) {
	db := san_testdb.DB(t)
	client := importClient(t, db)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	order := seedImportOrder(t, db, shop, "2610201E5F6G7H", "shipped")

	shopeeImport(t, client, shop, orderSample(t, "shopee", shopeeLate))
	run := shopeeImport(t, client, shop, orderSample(t, "shopee", shopeeEarly))

	wantLine(t, run, "2610201E5F6G7H", "the file is behind ours: completed here")

	if got := statusOf(t, db, order); got != "completed" {
		t.Fatalf("the order went back to %s", got)
	}
}

// One ref, two live orders in the shop: which one the platform means cannot be told, so neither moves.
func TestShopeeOrderImport_ARefWithTwoOrdersIsListed(t *testing.T) {
	db := san_testdb.DB(t)
	client := importClient(t, db)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	first := seedImportOrder(t, db, shop, "2610212N1P2Q3R", "shipping")
	seedImportOrder(t, db, shop, "2610212N1P2Q3R", "shipping")

	run := shopeeImport(t, client, shop, orderSample(t, "shopee", shopeeLate))

	wantLine(t, run, "2610212N1P2Q3R", "matches 2 orders in Toko A")

	if got := statusOf(t, db, first); got != "shipping" {
		t.Fatalf("an ambiguous ref moved an order to %s", got)
	}
}

// a-completed-shipping-order-passes-through-shipped: Selesai on an order still `shipping` here is the two moves customer
// service would make by hand — shipped, then completed — two timeline rows, one line, counted once as moved.
func TestShopeeOrderImport_ACompletedShippingOrderPassesThroughShipped(t *testing.T) {
	db := san_testdb.DB(t)
	client := importClient(t, db)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	order := seedImportOrder(t, db, shop, "2610201E5F6G7H", "shipping")

	run := shopeeImport(t, client, shop, orderSample(t, "shopee", shopeeLate))

	wantLine(t, run, "2610201E5F6G7H", "shipping → shipped → completed (Selesai)")
	wantTally(t, run, 1, 3, 5)

	if got := statusOf(t, db, order); got != "completed" {
		t.Fatalf("the order is %s, want completed", got)
	}

	var logs []selling_service_models.OrderTimelineLog

	err := db.Where("order_id = ?", order).Order("id").Find(&logs).Error
	if err != nil {
		t.Fatalf("timeline: %v", err)
	}

	if len(logs) != 2 || logs[0].Status != "shipped" || logs[1].Status != "completed" {
		t.Fatalf("timeline %+v — want shipped, then completed", logs)
	}

	// The diagram itself gained no edge: a hand move still cannot skip shipped.
	other := seedImportOrder(t, db, shop, "OTHER-REF", "shipping")

	res, err := newService(t, db).OrderStatusChange(context.Background(), connect.NewRequest(&sellingv1.OrderStatusChangeRequest{
		TeamId: 2, OrderIds: []uint64{other}, To: sellingv1.OrderStatus_ORDER_STATUS_COMPLETED,
	}))
	if err != nil {
		t.Fatalf("hand move: %v", err)
	}

	if res.Msg.GetResults()[0].GetMoved() {
		t.Fatal("a hand move went shipping → completed")
	}
}

// The bridge is for `shipping` only: an order already returned here is not walked forward to completed by a file that
// says Selesai — the file is behind ours, and nothing moves.
func TestShopeeOrderImport_ACompletedFileDoesNotUndoAReturn(t *testing.T) {
	db := san_testdb.DB(t)
	client := importClient(t, db)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	order := seedImportOrder(t, db, shop, "2610201E5F6G7H", "return")

	run := shopeeImport(t, client, shop, orderSample(t, "shopee", shopeeLate))

	wantLine(t, run, "2610201E5F6G7H", "the file is behind ours: return here")

	if got := statusOf(t, db, order); got != "return" {
		t.Fatalf("the order moved to %s", got)
	}
}

// The shop is checked before the file is read: another platform's shop, or another team's, is one ERROR line and
// nothing else.
func TestShopeeOrderImport_TheWrongShopEndsBeforeTheFile(t *testing.T) {
	db := san_testdb.DB(t)
	client := importClient(t, db)
	tiktok := insertShop(t, db, 2, "Toko A TikTok", "TOKO-A-TT", "tiktok")
	elsewhere := insertShop(t, db, 3, "Toko B", "TOKO-B", "shopee")

	file := orderSample(t, "shopee", shopeeLate)

	for name, shop := range map[string]uint64{"another platform's": tiktok, "another team's": elsewhere} {
		run := shopeeImport(t, client, shop, file)

		if len(run.errors) != 1 || run.tally != nil || run.count != 0 {
			t.Fatalf("%s shop: errors %v, tally %v, count %d — want one error and nothing read", name, run.errors, run.tally, run.count)
		}
	}
}

// A file that is not a Shopee order export — TikTok's — is one ERROR line, and no order is touched.
func TestShopeeOrderImport_AnotherPlatformsFileIsRefused(t *testing.T) {
	db := san_testdb.DB(t)
	client := importClient(t, db)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	run := shopeeImport(t, client, shop, orderSample(t, "tiktok", "mock_all_orders_20261020_20261027.xlsx"))

	if len(run.errors) != 1 || !strings.Contains(run.errors[0], "Shopee order export") || run.tally != nil {
		t.Fatalf("errors %v, tally %v", run.errors, run.tally)
	}
}
