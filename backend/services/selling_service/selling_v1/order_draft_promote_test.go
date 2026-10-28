package selling_v1_test

import (
	"strings"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// readyDraft is a draft that has been finished: a shop, a warehouse, a customer, and every line
// mapped. Promoting one is supposed to work — the tests below take things away from it one at a
// time, so what each requirement is actually protecting stays visible.
func readyDraft(t *testing.T, svc *selling_v1.Service, db *gorm.DB, shopID uint64) uint64 {
	t.Helper()

	draftID := pushRef(t, svc, 7, "SHP-100")

	detail, err := draftDetail(t, svc, 7, 2, draftID)
	if err != nil {
		t.Fatalf("detail: %v", err)
	}

	lines := make([]*sellingv1.OrderDraftLineEdit, 0, len(detail.GetItems()))
	for i, item := range detail.GetItems() {
		lines = append(lines, &sellingv1.OrderDraftLineEdit{
			Id:        item.GetId(),
			ProductId: uint64(41 + i),
			Quantity:  item.GetQuantity(),
			UnitPrice: item.GetUnitPrice(),
		})
	}

	updateDraft(t, svc, 7, &sellingv1.OrderDraftUpdateRequest{
		TeamId:       2,
		DraftId:      draftID,
		ShopId:       u64(shopID),
		WarehouseId:  u64(testWarehouse),
		CustomerName: str("Budi"),
		Items:        &sellingv1.OrderDraftLines{Lines: lines},
		// The storefront's order date, read off the page by the person finishing it — required to promote
		// (platform-created-at-is-required-at-finalize).
		PlatformCreatedAtUnix: i64(testPlatformDate),
		// …and what the buyer paid there, required on the same footing (platform-total-is-required-at-finalize).
		PlatformTotal: i64(testPlatformTotal),
	})

	return draftID
}

func promote(
	t *testing.T,
	svc *selling_v1.Service,
	userID, teamID, draftID uint64,
) (*sellingv1.Order, error) {
	t.Helper()

	res, err := svc.OrderDraftPromote(asUser(userID),
		connect.NewRequest(&sellingv1.OrderDraftPromoteRequest{TeamId: teamID, DraftId: draftID}))
	if err != nil {
		return nil, err
	}

	return res.Msg.GetOrder(), nil
}

// The happy path, and the two facts that make it worth having: a real order exists, and the draft is
// GONE. A promoted draft is not a draft in some final state — it stopped existing.
func TestOrderDraftPromote_TheDraftBecomesAnOrderAndDisappears(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	draftID := readyDraft(t, svc, db, shop)

	order, err := promote(t, svc, 7, 2, draftID)
	if err != nil {
		t.Fatalf("OrderDraftPromote: %v", err)
	}

	if order.GetStatus() != sellingv1.OrderStatus_ORDER_STATUS_PENDING {
		t.Fatalf("status = %v, want PLACED", order.GetStatus())
	}

	if order.GetWarehouseId() != testWarehouse || order.GetShopId() != shop {
		t.Fatalf("order names shop %d / warehouse %d, want %d / %d",
			order.GetShopId(), order.GetWarehouseId(), shop, testWarehouse)
	}

	var drafts int64

	err = db.Model(&selling_service_models.OrderDraft{}).Where("id = ?", draftID).Count(&drafts).Error
	if err != nil {
		t.Fatalf("count: %v", err)
	}

	if drafts != 0 {
		t.Fatal("the draft survived its own promotion")
	}
}

// An order line freezes the CATALOGUE's label, not the marketplace's. The scraped text says what the
// buyer clicked on; the order must say what we actually shipped.
func TestOrderDraftPromote_TheLinesCarryTheCatalogueLabel(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	draftID := readyDraft(t, svc, db, shop)

	order, err := promote(t, svc, 7, 2, draftID)
	if err != nil {
		t.Fatalf("promote: %v", err)
	}

	detail, err := svc.OrderDetail(asUser(7), connect.NewRequest(&sellingv1.OrderDetailRequest{
		TeamId: 2, OrderId: order.GetId(),
	}))
	if err != nil {
		t.Fatalf("OrderDetail: %v", err)
	}

	items := detail.Msg.GetOrder().GetItems()
	if len(items) != 2 {
		t.Fatalf("items = %d, want 2", len(items))
	}

	if items[0].GetSku() != "SKU41" || items[0].GetName() != "Catalogue SKU41" {
		t.Fatalf("line 1 = %q / %q, want the catalogue's label — not the scraped title",
			items[0].GetSku(), items[0].GetName())
	}
}

// A PROMOTED ORDER'S MONEY IS THE TAKE'S, as on OrderCreate — never the draft rows' marketplace prices
// (an-order-line-carries-no-marketplace-price). The rows say 2 × 50.000 + 1 × 35.000; the take draws 2 × 10.000 and
// 1 × 5.000, so goods_cost is 25.000, the fee is priced on it, and total_cost adds the two. What the buyer paid is the
// draft's own figure, copied.
func TestOrderDraftPromote_TakesItsMoneyFromTheTakeNotTheRows(t *testing.T) {
	db := san_testdb.DB(t)
	picker := &fakePicker{costs: map[uint64]int64{41: 10_000, 42: 5_000}}
	fees := &fakeFees{percent: 10}
	svc := newServiceWithFees(t, db, picker, fees)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	draftID := readyDraft(t, svc, db, shop)

	order, err := promote(t, svc, 7, 2, draftID)
	if err != nil {
		t.Fatalf("promote: %v", err)
	}

	if order.GetGoodsCost() != 25_000 {
		t.Fatalf("goods_cost = %d, want 25000 — the take's draw, not the rows' 135000", order.GetGoodsCost())
	}

	if order.GetWarehouseFee() != 2_500 || order.GetTotalCost() != 27_500 {
		t.Fatalf("fee %v, total_cost %v — want 2500 on the goods_cost and 27500 for the two together",
			order.GetWarehouseFee(), order.GetTotalCost())
	}

	if order.GetPlatformTotal() != testPlatformTotal {
		t.Fatalf("platform_total = %d, want the draft's %d", order.GetPlatformTotal(), testPlatformTotal)
	}
}

// THE ONE REQUIREMENT SPECIFIC TO DRAFTS. An unmapped line is precisely what makes this a draft, so
// promoting one must fail — and say so in the screen's own terms.
func TestOrderDraftPromote_RefusesAnUnmappedLine(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	draftID := pushRef(t, svc, 7, "SHP-100")

	updateDraft(t, svc, 7, &sellingv1.OrderDraftUpdateRequest{
		TeamId: 2, DraftId: draftID,
		ShopId: u64(shop), WarehouseId: u64(testWarehouse), CustomerName: str("Budi"),
	})

	_, err := promote(t, svc, 7, 2, draftID)
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("code = %v, want FailedPrecondition", connect.CodeOf(err))
	}
}

// Everything an ORDER has always required is required here too, through the same code path — this is
// the payoff of the separate table, and the table below is what would drift if the rule were copied.
func TestOrderDraftPromote_RunsTheSameValidationOrderCreateDoes(t *testing.T) {
	db := san_testdb.DB(t)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	cases := []struct {
		name  string
		strip func(*sellingv1.OrderDraftUpdateRequest)
	}{
		{"no shop", func(r *sellingv1.OrderDraftUpdateRequest) { r.ShopId = u64(0) }},
		{"no warehouse", func(r *sellingv1.OrderDraftUpdateRequest) { r.WarehouseId = u64(0) }},
		{"no customer", func(r *sellingv1.OrderDraftUpdateRequest) { r.CustomerName = str("") }},
		{"no lines", func(r *sellingv1.OrderDraftUpdateRequest) {
			r.Items = &sellingv1.OrderDraftLines{}
		}},
		// platform-created-at-is-required-at-finalize — a draft may hold it empty, an order may not.
		{"no platform order date", func(r *sellingv1.OrderDraftUpdateRequest) { r.PlatformCreatedAtUnix = i64(0) }},
		// platform-total-is-required-at-finalize — the same footing.
		{"no marketplace total", func(r *sellingv1.OrderDraftUpdateRequest) { r.PlatformTotal = i64(0) }},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			svc := newService(t, db)
			draftID := readyDraft(t, svc, db, shop)

			strip := &sellingv1.OrderDraftUpdateRequest{TeamId: 2, DraftId: draftID}
			tc.strip(strip)
			updateDraft(t, svc, 7, strip)

			_, err := promote(t, svc, 7, 2, draftID)
			if err == nil {
				t.Fatalf("promoted a draft with %s", tc.name)
			}

			// And the draft is still there to be fixed — a refused promote must not consume it.
			var drafts int64

			countErr := db.
				Model(&selling_service_models.OrderDraft{}).
				Where("id = ?", draftID).
				Count(&drafts).
				Error
			if countErr != nil {
				t.Fatalf("count: %v", countErr)
			}

			if drafts != 1 {
				t.Fatal("a refused promote destroyed the draft")
			}
		})
	}
}

// STALE REFERENCES (§6.10.7). A product can be deleted between the mapping and the promote, and the
// answer must name WHICH one — the person has to go back to that line and pick something else, and a
// bare validation error would leave them hunting through lines that all look fine.
func TestOrderDraftPromote_NamesTheProductThatDied(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newServiceWithCatalog(t, db, &fakeCatalog{missing: map[uint64]bool{42: true}})
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	draftID := readyDraft(t, svc, db, shop)

	_, err := promote(t, svc, 7, 2, draftID)
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("code = %v, want FailedPrecondition", connect.CodeOf(err))
	}

	if !strings.Contains(err.Error(), "42") {
		t.Fatalf("error %q does not name the dead product", err.Error())
	}
}

// PROMOTE IS THE ONLY DOOR INTO REVENUE. Nothing a draft does upstream of this publishes anything, so
// this event firing exactly once, here, is what keeps unfinished scrapes out of the month's margin.
func TestOrderDraftPromote_IsWhereTheOrderPlacedEventFires(t *testing.T) {
	db := san_testdb.DB(t)

	events := &recorder{}
	svc := newServiceWithEvents(t, db, events.send)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	// Pushing and editing publish nothing…
	draftID := readyDraft(t, svc, db, shop)

	if len(events.events) != 0 {
		t.Fatalf("%d events published before promote — a draft reached revenue", len(events.events))
	}

	// …and promoting publishes exactly one OrderPlacedEvent, carrying this order's money.
	order, err := promote(t, svc, 7, 2, draftID)
	if err != nil {
		t.Fatalf("promote: %v", err)
	}

	placed := events.placed(t)
	if placed.GetOrderId() != order.GetId() || placed.GetPlatformTotal() != order.GetPlatformTotal() {
		t.Fatalf("event names order %d / platform total %d, want %d / %d",
			placed.GetOrderId(), placed.GetPlatformTotal(), order.GetId(), order.GetPlatformTotal())
	}
}

func TestOrderDraftPromote_CannotPromoteAColleaguesDraft(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	draftID := readyDraft(t, svc, db, shop)

	_, err := promote(t, svc, 9, 2, draftID)
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("code = %v, want NotFound", connect.CodeOf(err))
	}
}
