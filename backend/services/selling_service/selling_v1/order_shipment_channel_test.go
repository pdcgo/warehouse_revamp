package selling_v1_test

import (
	"context"
	"strings"
	"testing"

	"connectrpc.com/connect"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

// NO ORDER WITHOUT A COURIER (no-order-without-a-courier): the typed door refuses an order naming no shipment channel,
// naming what is missing — and nothing is written and no stock is taken.
func TestOrderCreate_RefusesAnOrderWithNoCourier(t *testing.T) {
	db := san_testdb.DB(t)
	picker := knownCosts()
	svc := newServiceWithFees(t, db, picker, &fakeFees{percent: 2.5})
	shop := insertShop(t, db, 2, "Melati Shopee", "MEL-S", "shopee")

	req := feeOrderReq(shop)
	req.ShipmentChannelId = 0

	_, err := svc.OrderCreate(context.Background(), connect.NewRequest(req))

	if connect.CodeOf(err) != connect.CodeInvalidArgument || !strings.Contains(err.Error(), "which courier carries it") {
		t.Fatalf("err = %v — want InvalidArgument naming the missing courier", err)
	}

	if n := countOrders(t, db); n != 0 || len(picker.picked) != 0 {
		t.Fatalf("%d orders written, picked %v — a refused order takes nothing", n, picker.picked)
	}
}

// THE COURIER IS STORED AS ITS ID (shipment-channel-is-an-id-into-shipment-service), and nothing else about it
// (the-channel-name-is-not-frozen): the response and the detail answer the id the request named.
func TestOrderCreate_StoresTheCouriersChannelID(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	shop := insertShop(t, db, 2, "Melati Shopee", "MEL-S", "shopee")

	req := feeOrderReq(shop)
	req.ShipmentChannelId = 7

	created, err := svc.OrderCreate(context.Background(), connect.NewRequest(req))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	if got := created.Msg.GetOrder().GetShipmentChannelId(); got != 7 {
		t.Fatalf("response courier = %d, want 7", got)
	}

	detail, err := svc.OrderDetail(context.Background(), connect.NewRequest(&sellingv1.OrderDetailRequest{
		TeamId: 2, OrderId: created.Msg.GetOrder().GetId(),
	}))
	if err != nil {
		t.Fatalf("detail: %v", err)
	}

	if got := detail.Msg.GetOrder().GetShipmentChannelId(); got != 7 {
		t.Fatalf("detail courier = %d, want 7", got)
	}
}

// THE APP'S COURIER ON A DRAFT, AND A PERSON'S (the-app-converts-the-courier-to-a-channel-id, §6.5's touched rule): a
// push stores the channel id the app converted; a re-push follows the app while nobody touched it; a person's pick is
// stored and marked `shipment_channel_id`; the app's next push leaves it alone. A push with none keeps the draft at 0.
func TestOrderDraft_TheCourierIsPushedPickedAndYields(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	none := push(t, svc, 7, scrape()).GetDraft()
	if none.GetShipmentChannelId() != 0 {
		t.Fatalf("a push with no courier stored %d, want 0 — the app could not convert it", none.GetShipmentChannelId())
	}

	first := scrape()
	first.ShipmentChannelId = 1

	draft := push(t, svc, 7, first).GetDraft()
	if draft.GetShipmentChannelId() != 1 {
		t.Fatalf("pushed courier = %d, want 1", draft.GetShipmentChannelId())
	}

	second := scrape()
	second.ShipmentChannelId = 2

	if got := push(t, svc, 7, second).GetDraft().GetShipmentChannelId(); got != 2 {
		t.Fatalf("re-pushed courier = %d — an untouched field follows the app", got)
	}

	picked := uint64(9)
	edited := updateDraft(t, svc, 7, &sellingv1.OrderDraftUpdateRequest{
		TeamId: 2, DraftId: draft.GetId(), ShipmentChannelId: &picked,
	})
	if edited.GetShipmentChannelId() != 9 || !contains(edited.GetTouchedFields(), "shipment_channel_id") {
		t.Fatalf("edited courier = %d, touched %v — want 9, marked shipment_channel_id",
			edited.GetShipmentChannelId(), edited.GetTouchedFields())
	}

	again := scrape()
	again.ShipmentChannelId = 3

	if got := push(t, svc, 7, again).GetDraft().GetShipmentChannelId(); got != 9 {
		t.Fatalf("courier = %d after a re-push — the person's pick must stand", got)
	}
}

// PROMOTE MEETS THE SAME RULE (no-order-without-a-courier): a draft the app could not convert is refused when the form
// sends none, and placed with the courier the person picks — stored on the order.
func TestOrderCreateFromDraft_NeedsACourier(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	draftID := readyDraft(t, svc, db, shop)

	draft, err := draftDetail(t, svc, draftPusher, 2, draftID)
	if err != nil {
		t.Fatalf("detail: %v", err)
	}

	if draft.GetShipmentChannelId() != 0 {
		t.Fatalf("the ready draft carries courier %d — this test needs one the app could not convert", draft.GetShipmentChannelId())
	}

	req := draftOrderRequest(draft, 0)

	_, err = svc.OrderCreate(asUser(draftPusher), connect.NewRequest(req))
	if connect.CodeOf(err) != connect.CodeInvalidArgument || !strings.Contains(err.Error(), "which courier carries it") {
		t.Fatalf("err = %v — want InvalidArgument naming the missing courier", err)
	}

	if n := draftsWithID(t, db, draftID); n != 1 {
		t.Fatalf("%d drafts — a refused promote leaves the draft as it was", n)
	}

	placed, err := svc.OrderCreate(asUser(draftPusher), connect.NewRequest(draftOrderRequest(draft, 5)))
	if err != nil {
		t.Fatalf("promote with a picked courier: %v", err)
	}

	if placed.Msg.GetOrder().GetShipmentChannelId() != 5 {
		t.Fatalf("courier = %d, want the picked 5", placed.Msg.GetOrder().GetShipmentChannelId())
	}
}

// draftOrderRequest is the form's Create over a draft, naming `courier` (0 = the person picked none).
func draftOrderRequest(draft *sellingv1.OrderDraft, courier uint64) *sellingv1.OrderCreateRequest {
	items := mappedItems(draft)

	return &sellingv1.OrderCreateRequest{
		ShipmentChannelId:     courier,
		IdempotencyKey:        newOrderKey(),
		TeamId:                draft.GetTeamId(),
		ShopId:                draft.GetShopId(),
		WarehouseId:           draft.GetWarehouseId(),
		CustomerName:          draft.GetCustomerName(),
		Address:               draft.GetAddress(),
		PlatformCreatedAtUnix: draft.GetPlatformCreatedAtUnix(),
		PlatformTotal:         draft.GetPlatformTotal(),
		OrderExternalRefId:    draft.GetExternalId(),
		Items:                 items,
		OrderDraftId:          draft.GetId(),
	}
}

// THE FILE NAMES THE COURIER BY ITS CODE (shipment-channel-is-an-id-into-shipment-service): the export store resolves
// the rows' channel ids, and an id that resolves to nothing is written as `#id`, never blank.
func TestOrderExport_NamesTheCourierByItsCode(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	melati := insertShop(t, db, 2, "Melati Official", "MEL-S", "shopee")

	phoneOrder(t, svc, 2, melati, "0812000111") // courier testShipmentChannel → "jne" in fakeExports

	unknown := feeOrderReq(melati)
	unknown.ShipmentChannelId = 99

	_, err := svc.OrderCreate(context.Background(), connect.NewRequest(unknown))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	run := export(t, db, &fakeExports{}, &sellingv1.OrderExportRequest{
		TeamId: 2, Filter: &sellingv1.OrderListFilter{}, View: sellingv1.OrderExportView_ORDER_EXPORT_VIEW_SELLER,
	})

	col := -1
	for i, name := range run.rows[0] {
		if name == "Courier" {
			col = i
		}
	}

	if col < 0 {
		t.Fatalf("no Courier column in %v", run.rows[0])
	}

	got := map[string]bool{}
	for _, row := range run.rows[1:] {
		got[row[col]] = true
	}

	if !got["jne"] || !got["#99"] {
		t.Fatalf("courier cells %v — want jne (resolved) and #99 (unresolved)", got)
	}
}
