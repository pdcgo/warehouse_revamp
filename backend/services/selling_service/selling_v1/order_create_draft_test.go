package selling_v1_test

import (
	"fmt"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// The user every test draft is pushed as (pushRef pushes as 7). A draft is its author's inbox, so this is also who may
// finish it.
const draftPusher = 7

// readyDraft is a draft that has been finished: a shop, a warehouse, a customer, and every line
// mapped. Promoting one is supposed to work — the tests below take things away from it one at a
// time, so what each requirement is actually protecting stays visible.
func readyDraft(t *testing.T, svc *selling_v1.Service, _ *gorm.DB, shopID uint64) uint64 {
	t.Helper()

	draftID := pushRef(t, svc, draftPusher, "SHP-100")

	detail, err := draftDetail(t, svc, draftPusher, 2, draftID)
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

	updateDraft(t, svc, draftPusher, &sellingv1.OrderDraftUpdateRequest{
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

// promote is what the draft page's Promote does (a-draft-becomes-an-order-through-order-create): OrderCreate with what
// the draft holds — the page sends what is on its screen, seeded from the draft — and the draft's id. The catalogue
// label is the page's to send; here it is a stand-in, `SKU41` / `Catalogue SKU41`.
func promote(
	t *testing.T,
	svc *selling_v1.Service,
	userID, teamID, draftID uint64,
) (*sellingv1.Order, error) {
	t.Helper()

	draft, err := draftDetail(t, svc, draftPusher, teamID, draftID)
	if err != nil {
		t.Fatalf("detail: %v", err)
	}

	items := make([]*sellingv1.OrderItem, 0, len(draft.GetItems()))
	for _, line := range draft.GetItems() {
		items = append(items, &sellingv1.OrderItem{
			ProductId: line.GetProductId(),
			Sku:       fmt.Sprintf("SKU%d", line.GetProductId()),
			Name:      fmt.Sprintf("Catalogue SKU%d", line.GetProductId()),
			Quantity:  line.GetQuantity(),
		})
	}

	res, err := svc.OrderCreate(asUser(userID), connect.NewRequest(&sellingv1.OrderCreateRequest{
		TeamId:                       teamID,
		ShopId:                       draft.GetShopId(),
		WarehouseId:                  draft.GetWarehouseId(),
		CustomerName:                 draft.GetCustomerName(),
		CustomerPhone:                draft.GetCustomerPhone(),
		BuyerUsername:                draft.GetBuyerUsername(),
		Address:                      draft.GetAddress(),
		ShippingCode:                 draft.GetShippingCode(),
		PlatformCreatedAtUnix:        draft.GetPlatformCreatedAtUnix(),
		PlatformShipmentDeadlineUnix: draft.GetPlatformShipmentDeadlineUnix(),
		PlatformTotal:                draft.GetPlatformTotal(),
		OrderExternalRefId:           draft.GetExternalId(),
		Items:                        items,
		OrderDraftId:                 draftID,
	}))
	if err != nil {
		return nil, err
	}

	return res.Msg.GetOrder(), nil
}

func draftsWithID(t *testing.T, db *gorm.DB, draftID uint64) int64 {
	t.Helper()

	var n int64

	err := db.Model(&selling_service_models.OrderDraft{}).Where("id = ?", draftID).Count(&n).Error
	if err != nil {
		t.Fatalf("count drafts: %v", err)
	}

	return n
}

// The happy path, and the two facts that make it worth having: a real order exists, and the draft is
// GONE. A promoted draft is not a draft in some final state — it stopped existing.
func TestOrderCreateFromDraft_TheDraftBecomesAnOrderAndDisappears(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	draftID := readyDraft(t, svc, db, shop)

	order, err := promote(t, svc, draftPusher, 2, draftID)
	if err != nil {
		t.Fatalf("OrderCreate: %v", err)
	}

	if order.GetStatus() != sellingv1.OrderStatus_ORDER_STATUS_PENDING {
		t.Fatalf("status = %v, want PENDING", order.GetStatus())
	}

	if order.GetWarehouseId() != testWarehouse || order.GetShopId() != shop {
		t.Fatalf("order names shop %d / warehouse %d, want %d / %d",
			order.GetShopId(), order.GetWarehouseId(), shop, testWarehouse)
	}

	// The draft's external id IS the marketplace ref, and an order never lands without one
	// (an-order-ref-is-required-by-the-rpc).
	if order.GetOrderExternalRefId() != "SHP-100" {
		t.Fatalf("order ref = %q, want the draft's external id %q", order.GetOrderExternalRefId(), "SHP-100")
	}

	if draftsWithID(t, db, draftID) != 0 {
		t.Fatal("the draft survived its own promotion")
	}
}

// ONE DRAFT, ONE ORDER. The second Promote finds the draft gone and places nothing — sequentially it is NotFound at the
// lookup; two at the same instant meet the same answer inside the transaction (Aborted), where the second order rolls
// back.
func TestOrderCreateFromDraft_TheSameDraftCannotBecomeTwoOrders(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	draftID := readyDraft(t, svc, db, shop)

	draft, err := draftDetail(t, svc, draftPusher, 2, draftID)
	if err != nil {
		t.Fatalf("detail: %v", err)
	}

	_, err = promote(t, svc, draftPusher, 2, draftID)
	if err != nil {
		t.Fatalf("first OrderCreate: %v", err)
	}

	// The page still holds the draft it loaded, and sends it again.
	items := make([]*sellingv1.OrderItem, 0, len(draft.GetItems()))
	for _, line := range draft.GetItems() {
		items = append(items, &sellingv1.OrderItem{
			ProductId: line.GetProductId(), Sku: "SKU", Name: "Name", Quantity: line.GetQuantity(),
		})
	}

	_, err = svc.OrderCreate(asUser(draftPusher), connect.NewRequest(&sellingv1.OrderCreateRequest{
		TeamId: 2, ShopId: shop, WarehouseId: testWarehouse, CustomerName: "Budi",
		PlatformCreatedAtUnix: testPlatformDate, PlatformTotal: testPlatformTotal,
		OrderExternalRefId: "SHP-100", Items: items, OrderDraftId: draftID,
	}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("second OrderCreate code = %v, want NotFound", connect.CodeOf(err))
	}

	if n := countOrders(t, db); n != 1 {
		t.Fatalf("%d orders written from one draft, want 1", n)
	}
}

// A PROMOTED ORDER'S MONEY IS THE TAKE'S, as on any order — never the draft rows' marketplace prices
// (an-order-line-carries-no-marketplace-price). The rows say 2 × 50.000 + 1 × 35.000; the take draws 2 × 10.000 and
// 1 × 5.000, so goods_cost is 25.000, the fee is priced on it, and total_cost adds the two. What the buyer paid is the
// draft's own figure, sent from the page.
func TestOrderCreateFromDraft_TakesItsMoneyFromTheTakeNotTheRows(t *testing.T) {
	db := san_testdb.DB(t)
	picker := &fakePicker{costs: map[uint64]int64{41: 10_000, 42: 5_000}}
	fees := &fakeFees{percent: 10}
	svc := newServiceWithFees(t, db, picker, fees)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	draftID := readyDraft(t, svc, db, shop)

	order, err := promote(t, svc, draftPusher, 2, draftID)
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

// A REFUSED ORDER LEAVES THE DRAFT. The deletion runs inside the order's transaction, so whatever refuses the order
// rolls it back too, and the draft is still there to be fixed.
func TestOrderCreateFromDraft_ARefusedOrderLeavesTheDraft(t *testing.T) {
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
			updateDraft(t, svc, draftPusher, strip)

			_, err := promote(t, svc, draftPusher, 2, draftID)
			if err == nil {
				t.Fatalf("placed an order from a draft with %s", tc.name)
			}

			if draftsWithID(t, db, draftID) != 1 {
				t.Fatal("a refused order destroyed the draft")
			}
		})
	}
}

// PROMOTE IS THE ONLY DOOR INTO REVENUE FOR A DRAFT. Nothing a draft does upstream of the order publishes anything, so
// this event firing exactly once, here, is what keeps unfinished scrapes out of the month's margin.
func TestOrderCreateFromDraft_IsWhereTheOrderPlacedEventFires(t *testing.T) {
	db := san_testdb.DB(t)

	events := &recorder{}
	svc := newServiceWithEvents(t, db, events.send)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	// Pushing and editing publish nothing…
	draftID := readyDraft(t, svc, db, shop)

	if len(events.events) != 0 {
		t.Fatalf("%d events published before promote — a draft reached revenue", len(events.events))
	}

	// …and placing the order publishes exactly one OrderPlacedEvent, carrying this order's money.
	order, err := promote(t, svc, draftPusher, 2, draftID)
	if err != nil {
		t.Fatalf("promote: %v", err)
	}

	placed := events.placed(t)
	if placed.GetOrderId() != order.GetId() || placed.GetPlatformTotal() != order.GetPlatformTotal() {
		t.Fatalf("event names order %d / platform total %d, want %d / %d",
			placed.GetOrderId(), placed.GetPlatformTotal(), order.GetId(), order.GetPlatformTotal())
	}
}

// A draft is its author's inbox: a colleague finishing it is NotFound, never Forbidden, and places nothing.
func TestOrderCreateFromDraft_CannotFinishAColleaguesDraft(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	draftID := readyDraft(t, svc, db, shop)

	_, err := promote(t, svc, 9, 2, draftID)
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("code = %v, want NotFound", connect.CodeOf(err))
	}

	if n := countOrders(t, db); n != 0 {
		t.Fatalf("%d orders written for a colleague's draft, want none", n)
	}
}
