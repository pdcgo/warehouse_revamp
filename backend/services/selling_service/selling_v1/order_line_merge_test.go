package selling_v1_test

import (
	"context"
	"strings"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// ONE PRODUCT IS ONE LINE (the-order-keeps-only-product-lines). The order form adds a bundle's products as ordinary
// lines, so the same product arrives once by hand and once from a bundle — and the take refuses a product listed twice.
// placeOrder merges them first, so the order is placed, the take is asked ONE line of the summed quantity, and every
// figure stored is exactly what a single line of that quantity would have stored.
func TestOrderCreate_OneProductOnTwoLinesIsPlacedAsOneLine(t *testing.T) {
	db := san_testdb.DB(t)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	// 3 units drawn as 2 × 10.000 + 1 × 14.000 — a draw no single unit price describes, so a per-line split of it would
	// show up in the figures.
	draw := selling_v1.PickDraw{100: {
		Cost: 34_000, UnitCost: 34_000.0 / 3, Total: 34_000, UnitCostWithMarkup: 34_000.0 / 3, MarkupTotal: 0,
	}}

	events := &recorder{}
	twoLines := &fakePicker{draw: draw}
	svc := selling_v1.NewService(db, twoLines, events.send, &fakeCatalog{}, &fakeCredit{}, nil, nil, &fakeFees{percent: 10})

	req := orderReq(shop)
	req.Items = []*sellingv1.OrderItem{
		{ProductId: 100, Sku: "SKU1", Name: "Widget", Quantity: 2},
		{ProductId: 100, Sku: "SKU1", Name: "Widget", Quantity: 1},
	}

	merged, err := svc.OrderCreate(context.Background(), connect.NewRequest(req))
	if err != nil {
		t.Fatalf("an order naming one product on two lines was refused: %v", err)
	}

	// The take is asked for ONE line of the summed quantity.
	if len(twoLines.asked) != 1 || len(twoLines.asked[0]) != 1 ||
		twoLines.asked[0][0] != (selling_v1.PickLine{ProductID: 100, Quantity: 3}) {
		t.Fatalf("the take was asked %v — want one pick of one line, product 100 × 3", twoLines.asked)
	}

	// The caller's request reads as it arrived — the merge works on a copy.
	if req.Items[0].GetQuantity() != 2 || req.Items[1].GetQuantity() != 1 {
		t.Fatalf("the merge rewrote the request's lines: %v", req.Items)
	}

	// THE SAME ORDER, TYPED AS ONE LINE OF 3 — what the merged order must be indistinguishable from.
	oneLine := &fakePicker{draw: draw}
	single := selling_v1.NewService(db, oneLine, nil, &fakeCatalog{}, &fakeCredit{}, nil, nil, &fakeFees{percent: 10})

	singleReq := orderReq(shop)
	singleReq.Items = []*sellingv1.OrderItem{
		{ProductId: 100, Sku: "SKU1", Name: "Widget", Quantity: 3},
	}

	typed, err := single.OrderCreate(context.Background(), connect.NewRequest(singleReq))
	if err != nil {
		t.Fatalf("the single-line order: %v", err)
	}

	got := storedOrder(t, db, merged.Msg.GetOrder().GetId())
	want := storedOrder(t, db, typed.Msg.GetOrder().GetId())

	if len(got.Items) != 1 {
		t.Fatalf("stored %d lines, want 1 — one product is one line", len(got.Items))
	}

	line := got.Items[0]
	if line.ProductID != 100 || line.Quantity != 3 || line.UnitCost != 11_333 ||
		line.Total == nil || *line.Total != 34_000 {
		t.Fatalf("stored line %+v — want product 100 × 3 at unit cost 11333, total 34000", line)
	}

	if got.GoodsCost != 34_000 || got.WarehouseFee == nil || *got.WarehouseFee != 3_400 {
		t.Fatalf("stored goods_cost %d, fee %v — want the draw's 34000 and 10%% of it", got.GoodsCost, got.WarehouseFee)
	}

	// Every figure a single line of 3 stores, the merged order stores too.
	if got.GoodsCost != want.GoodsCost || *got.WarehouseFee != *want.WarehouseFee || got.TotalCost != want.TotalCost {
		t.Fatalf("merged header goods_cost %d fee %v total_cost %v — single line %d %v %v",
			got.GoodsCost, *got.WarehouseFee, got.TotalCost,
			want.GoodsCost, *want.WarehouseFee, want.TotalCost)
	}

	other := want.Items[0]
	if line.Quantity != other.Quantity || line.UnitCost != other.UnitCost ||
		*line.Total != *other.Total || line.SKU != other.SKU || line.Name != other.Name {
		t.Fatalf("merged line %+v — the single line stored %+v", line, other)
	}

	// The event carries the one line too — liability charges the product fee from it.
	lines := events.placed(t).GetLines()
	if len(lines) != 1 || lines[0].GetQuantity() != 3 || lines[0].GetTotal() != 34_000 {
		t.Fatalf("OrderPlaced lines %v — want one line of 3, total 34000", lines)
	}
}

// A LINE CARRIES NO PRICE (an-order-line-carries-no-marketplace-price), so two lines of one product have nothing to
// disagree about but their label: they are ONE line, placed, holding the take's unit cost.
func TestOrderCreate_OneProductOnTwoLinesIsOneLineAtTheTakesCost(t *testing.T) {
	db := san_testdb.DB(t)
	picker := &fakePicker{costs: map[uint64]int64{100: 6000}}
	svc := newServiceWithPicker(t, db, picker)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	req := orderReq(shop)
	req.Items = []*sellingv1.OrderItem{
		{ProductId: 100, Sku: "SKU1", Name: "Widget", Quantity: 2},
		{ProductId: 100, Sku: "SKU1", Name: "Widget", Quantity: 1},
	}

	created, err := svc.OrderCreate(context.Background(), connect.NewRequest(req))
	if err != nil {
		t.Fatalf("one product on two lines was refused: %v", err)
	}

	stored := storedOrder(t, db, created.Msg.GetOrder().GetId())
	if len(stored.Items) != 1 {
		t.Fatalf("stored %d lines, want 1", len(stored.Items))
	}

	line := stored.Items[0]
	if line.Quantity != 3 || line.UnitCost != 6000 {
		t.Fatalf("stored line %+v — want 3 at the take's 6000", line)
	}
}

// ⚠ THE LABEL IS COMPARED. Two lines of one product under two names cannot become one line without dropping one of
// them, so the order is refused — naming the product — before anything is taken.
func TestOrderCreate_OneProductUnderTwoNamesIsRefused(t *testing.T) {
	db := san_testdb.DB(t)
	picker := &fakePicker{costs: map[uint64]int64{100: 6000}}
	svc := newServiceWithPicker(t, db, picker)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	req := orderReq(shop)
	req.Items = []*sellingv1.OrderItem{
		{ProductId: 100, Sku: "SKU1", Name: "Widget", Quantity: 2},
		{ProductId: 100, Sku: "SKU1", Name: "Widget Merah", Quantity: 1},
	}

	_, err := svc.OrderCreate(context.Background(), connect.NewRequest(req))
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("code = %v, want InvalidArgument", connect.CodeOf(err))
	}

	if !strings.Contains(err.Error(), "product 100") {
		t.Fatalf("error %q does not name the product", err.Error())
	}

	if len(picker.picked) != 0 {
		t.Fatalf("a refused order still took stock: %v", picker.picked)
	}

	assertNoOrders(t, db)
}

// THE SECOND DOOR (#194). A draft's two scraped rows can map to one product, and Promote runs the same placeOrder —
// so it is placed as one line of the summed quantity, at the take's cost.
func TestOrderDraftPromote_OneProductOnTwoRowsIsPlacedAsOneLine(t *testing.T) {
	db := san_testdb.DB(t)
	picker := &fakePicker{costs: map[uint64]int64{41: 20_000}}
	svc := newServiceWithPicker(t, db, picker)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	// Both rows mapped to product 41, at one marketplace price — 2 + 1 units.
	draftID := draftOfOneProduct(t, svc, shop, 50_000, 50_000)

	order, err := promote(t, svc, 7, 2, draftID)
	if err != nil {
		t.Fatalf("a draft mapping two rows to one product was refused: %v", err)
	}

	if len(picker.asked) != 1 || len(picker.asked[0]) != 1 ||
		picker.asked[0][0] != (selling_v1.PickLine{ProductID: 41, Quantity: 3}) {
		t.Fatalf("the take was asked %v — want one pick of one line, product 41 × 3", picker.asked)
	}

	stored := storedOrder(t, db, order.GetId())

	if len(stored.Items) != 1 {
		t.Fatalf("stored %d lines, want 1", len(stored.Items))
	}

	// The line holds the take's cost and no marketplace price (an-order-line-carries-no-marketplace-price).
	line := stored.Items[0]
	if line.Quantity != 3 || line.UnitCost != 20_000 {
		t.Fatalf("stored line %+v — want 3 at the take's 20.000, never the rows' 50.000", line)
	}

	// 3 × 20.000 drawn — the header is the take's too, never the rows' 3 × 50.000.
	if stored.GoodsCost != 60_000 {
		t.Fatalf("stored goods_cost %d — want 60000", stored.GoodsCost)
	}
}

// …and two rows of one product at TWO marketplace prices are one line too (an-order-line-carries-no-marketplace-price):
// the line carries no price to disagree about, so nothing is dropped by the merge. The prices stay on the draft's rows
// until the draft goes, and nothing on the order sums them.
func TestOrderDraftPromote_OneProductAtTwoMarketplacePricesIsPlacedAsOneLine(t *testing.T) {
	db := san_testdb.DB(t)
	picker := &fakePicker{costs: map[uint64]int64{41: 20_000}}
	svc := newServiceWithPicker(t, db, picker)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	draftID := draftOfOneProduct(t, svc, shop, 50_000, 35_000)

	order, err := promote(t, svc, 7, 2, draftID)
	if err != nil {
		t.Fatalf("two rows of one product at two marketplace prices were refused: %v", err)
	}

	if len(picker.asked) != 1 || len(picker.asked[0]) != 1 ||
		picker.asked[0][0] != (selling_v1.PickLine{ProductID: 41, Quantity: 3}) {
		t.Fatalf("the take was asked %v — want one pick of one line, product 41 × 3", picker.asked)
	}

	stored := storedOrder(t, db, order.GetId())
	if len(stored.Items) != 1 {
		t.Fatalf("stored %d lines, want 1", len(stored.Items))
	}

	line := stored.Items[0]
	if line.Quantity != 3 || line.UnitCost != 20_000 {
		t.Fatalf("stored line %+v — want 3 at the take's 20.000, neither 50.000 nor 35.000", line)
	}

	// The take's 3 × 20.000 — never the rows' 2 × 50.000 + 1 × 35.000.
	if stored.GoodsCost != 60_000 {
		t.Fatalf("stored goods_cost %d, want the take's 60000", stored.GoodsCost)
	}

	var drafts int64

	err = db.Model(&selling_service_models.OrderDraft{}).Where("id = ?", draftID).Count(&drafts).Error
	if err != nil {
		t.Fatalf("count: %v", err)
	}

	if drafts != 0 {
		t.Fatal("the promoted draft survived")
	}
}

// draftOfOneProduct is a finished draft whose two scraped rows (2 × and 1 ×) are BOTH mapped to product 41, each at
// the unit price given.
func draftOfOneProduct(t *testing.T, svc *selling_v1.Service, shopID uint64, first, second int64) uint64 {
	t.Helper()

	draftID := pushRef(t, svc, 7, "SHP-100")

	detail, err := draftDetail(t, svc, 7, 2, draftID)
	if err != nil {
		t.Fatalf("detail: %v", err)
	}

	items := detail.GetItems()
	if len(items) != 2 {
		t.Fatalf("the scrape has %d rows, want 2", len(items))
	}

	updateDraft(t, svc, 7, &sellingv1.OrderDraftUpdateRequest{
		TeamId:       2,
		DraftId:      draftID,
		ShopId:       u64(shopID),
		WarehouseId:  u64(testWarehouse),
		CustomerName: str("Budi"),
		Items: &sellingv1.OrderDraftLines{Lines: []*sellingv1.OrderDraftLineEdit{
			{Id: items[0].GetId(), ProductId: 41, Quantity: items[0].GetQuantity(), UnitPrice: first},
			{Id: items[1].GetId(), ProductId: 41, Quantity: items[1].GetQuantity(), UnitPrice: second},
		}},
		PlatformCreatedAtUnix: i64(testPlatformDate),
		PlatformTotal:         i64(testPlatformTotal),
	})

	return draftID
}

// storedOrder reads an order and its lines back from the table — what was written, not what the call echoed.
func storedOrder(t *testing.T, db *gorm.DB, id uint64) selling_service_models.Order {
	t.Helper()

	var order selling_service_models.Order

	err := db.Where("id = ?", id).Take(&order).Error
	if err != nil {
		t.Fatalf("read order %d: %v", id, err)
	}

	err = db.Where("order_id = ?", id).Order("id").Find(&order.Items).Error
	if err != nil {
		t.Fatalf("read order %d's lines: %v", id, err)
	}

	return order
}

// assertNoOrders fails when any order row exists — a refused create must leave none behind.
func assertNoOrders(t *testing.T, db *gorm.DB) {
	t.Helper()

	var orders int64

	err := db.Model(&selling_service_models.Order{}).Count(&orders).Error
	if err != nil {
		t.Fatalf("count orders: %v", err)
	}

	if orders != 0 {
		t.Fatalf("a refused order left %d orders behind", orders)
	}
}
