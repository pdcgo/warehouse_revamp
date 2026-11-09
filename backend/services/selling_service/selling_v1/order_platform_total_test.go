package selling_v1_test

import (
	"context"
	"strings"
	"testing"

	"connectrpc.com/connect"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// AN ORDER MUST SAY WHAT THE BUYER PAID (platform-total-is-required-at-finalize): refused at placement, naming what is
// missing, and nothing is written and no stock is taken.
func TestOrderCreate_RefusesAnOrderWithNoPlatformTotal(t *testing.T) {
	db := san_testdb.DB(t)
	picker := knownCosts()
	svc := newServiceWithFees(t, db, picker, &fakeFees{percent: 2.5})
	shop := insertShop(t, db, 2, "Melati Shopee", "MEL-S", "shopee")

	req := feeOrderReq(shop)
	req.PlatformTotal = 0

	_, err := svc.OrderCreate(context.Background(), connect.NewRequest(req))

	if connect.CodeOf(err) != connect.CodeInvalidArgument || !strings.Contains(err.Error(), "what the buyer paid") {
		t.Fatalf("err = %v — want InvalidArgument naming the missing platform total", err)
	}

	if n := countOrders(t, db); n != 0 || len(picker.picked) != 0 {
		t.Fatalf("%d orders written, picked %v — a refused order takes nothing", n, picker.picked)
	}
}

// …AND KEEPS IT AS TYPED once it is there, on the response and on the detail.
func TestOrderCreate_KeepsThePlatformTotal(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	shop := insertShop(t, db, 2, "Melati Shopee", "MEL-S", "shopee")

	req := feeOrderReq(shop)
	req.PlatformTotal = 41_500

	created, err := svc.OrderCreate(context.Background(), connect.NewRequest(req))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	if got := created.Msg.GetOrder().GetPlatformTotal(); got != 41_500 {
		t.Fatalf("response platform total = %v, want 41500", got)
	}

	detail, err := svc.OrderDetail(context.Background(), connect.NewRequest(&sellingv1.OrderDetailRequest{
		TeamId: 2, OrderId: created.Msg.GetOrder().GetId(),
	}))
	if err != nil {
		t.Fatalf("detail: %v", err)
	}

	if got := detail.Msg.GetOrder().GetPlatformTotal(); got != 41_500 {
		t.Fatalf("detail platform total = %v, want 41500", got)
	}
}

// THE DRAFT CARRIES IT NOW, AND THE APP'S FIGURE YIELDS TO A PERSON'S (§6.5): a push stores it; a re-push before
// anybody touches it follows the app; a person's edit stores it and marks it touched; the app's next push leaves it
// alone. 0 clears it and keeps it claimed.
func TestOrderDraft_ThePlatformTotalIsPushedEditedAndYields(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	first := scrape()
	first.PlatformTotal = 130_000

	draft := push(t, svc, 7, first).GetDraft()
	if draft.GetPlatformTotal() != 130_000 {
		t.Fatalf("pushed platform total = %v, want 130000", draft.GetPlatformTotal())
	}

	second := scrape()
	second.PlatformTotal = 128_000

	if got := push(t, svc, 7, second).GetDraft().GetPlatformTotal(); got != 128_000 {
		t.Fatalf("re-pushed platform total = %v — an untouched field follows the app's latest reading", got)
	}

	edited := updateDraft(t, svc, 7, &sellingv1.OrderDraftUpdateRequest{
		TeamId: 2, DraftId: draft.GetId(), PlatformTotal: f64(125_000),
	})
	if edited.GetPlatformTotal() != 125_000 {
		t.Fatalf("edited platform total = %v, want 125000", edited.GetPlatformTotal())
	}

	if !contains(edited.GetTouchedFields(), "platform_total") {
		t.Fatalf("touched %v — the edited platform total must be marked", edited.GetTouchedFields())
	}

	again := scrape()
	again.PlatformTotal = 99_000

	if got := push(t, svc, 7, again).GetDraft().GetPlatformTotal(); got != 125_000 {
		t.Fatalf("platform total = %v after a re-push — the person's 125000 must stand", got)
	}

	detail, err := draftDetail(t, svc, 7, 2, draft.GetId())
	if err != nil {
		t.Fatalf("detail: %v", err)
	}

	if detail.GetPlatformTotal() != 125_000 {
		t.Fatalf("detail platform total = %v, want the stored 125000", detail.GetPlatformTotal())
	}

	cleared := updateDraft(t, svc, 7, &sellingv1.OrderDraftUpdateRequest{
		TeamId: 2, DraftId: draft.GetId(), PlatformTotal: f64(0),
	})
	if cleared.GetPlatformTotal() != 0 || !contains(cleared.GetTouchedFields(), "platform_total") {
		t.Fatalf("cleared platform total = %v, touched %v — want 0, still marked", cleared.GetPlatformTotal(),
			cleared.GetTouchedFields())
	}
}

// PROMOTE COPIES IT onto the order — never recomputed from the lines, because no line can say what the
// buyer paid.
func TestOrderCreateFromDraft_CopiesThePlatformTotal(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	draftID := readyDraft(t, svc, db, shop)
	updateDraft(t, svc, 7, &sellingv1.OrderDraftUpdateRequest{
		TeamId: 2, DraftId: draftID, PlatformTotal: f64(131_000),
	})

	order, err := promote(t, svc, 7, 2, draftID)
	if err != nil {
		t.Fatalf("promote: %v", err)
	}

	if order.GetPlatformTotal() != 131_000 {
		t.Fatalf("promoted platform total = %v, want the draft's 131000", order.GetPlatformTotal())
	}
}

// …AND A DRAFT STILL AT 0 IS REFUSED by the same rule the typed order meets, naming it — and the draft survives, with
// no order written and no stock taken, so the person can fill it in and try again.
func TestOrderCreateFromDraft_RefusesADraftWithNoPlatformTotal(t *testing.T) {
	db := san_testdb.DB(t)
	picker := knownCosts()
	svc := newServiceWithFees(t, db, picker, &fakeFees{percent: 2.5})
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	draftID := readyDraft(t, svc, db, shop)
	updateDraft(t, svc, 7, &sellingv1.OrderDraftUpdateRequest{
		TeamId: 2, DraftId: draftID, PlatformTotal: f64(0),
	})

	_, err := promote(t, svc, 7, 2, draftID)
	if connect.CodeOf(err) != connect.CodeInvalidArgument || !strings.Contains(err.Error(), "what the buyer paid") {
		t.Fatalf("err = %v — want InvalidArgument naming the missing platform total", err)
	}

	if n := countOrders(t, db); n != 0 || len(picker.picked) != 0 {
		t.Fatalf("%d orders written, picked %v — a refused promote takes nothing", n, picker.picked)
	}

	var drafts int64

	err = db.Model(&selling_service_models.OrderDraft{}).Where("id = ?", draftID).Count(&drafts).Error
	if err != nil {
		t.Fatalf("count: %v", err)
	}

	if drafts != 1 {
		t.Fatal("a refused promote destroyed the draft")
	}
}

// THE FIGURE IS A DOUBLE, FROZEN EXACT AT PLACEMENT, end to end (the-backend-never-rounds-money): a draft keeps a
// fraction as typed (a-draft-keeps-its-platform-total-as-typed) and placement freezes that same figure as it writes the
// order row — never rounded. The row, the response, the detail, the OrderPlaced event settlement opens its account
// from, and the census's Σ all carry that same exact number.
func TestOrderCreateFromDraft_APlatformTotalIsFrozenExactEndToEnd(t *testing.T) {
	db := san_testdb.DB(t)
	rec := &recorder{}
	svc := newServiceWithEvents(t, db, rec.send)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	draftID := readyDraft(t, svc, db, shop)

	edited := updateDraft(t, svc, 7, &sellingv1.OrderDraftUpdateRequest{
		TeamId: 2, DraftId: draftID, PlatformTotal: f64(131_000.5),
	})
	if edited.GetPlatformTotal() != 131_000.5 {
		t.Fatalf("draft platform total = %v — a draft keeps what was typed, it has not frozen", edited.GetPlatformTotal())
	}

	order, err := promote(t, svc, 7, 2, draftID)
	if err != nil {
		t.Fatalf("promote: %v", err)
	}

	const frozen = 131_000.5

	if order.GetPlatformTotal() != frozen {
		t.Fatalf("promoted platform total = %v, want %v — frozen exact, never rounded", order.GetPlatformTotal(), float64(frozen))
	}

	var row selling_service_models.Order

	err = db.Where("id = ?", order.GetId()).Take(&row).Error
	if err != nil {
		t.Fatal(err)
	}

	if row.PlatformTotal != frozen {
		t.Fatalf("stored platform total = %v, want %v", row.PlatformTotal, float64(frozen))
	}

	if got := rec.placed(t).GetPlatformTotal(); got != frozen {
		t.Fatalf("OrderPlaced platform total = %v, want %v — settlement's initial_total is this figure", got, float64(frozen))
	}

	detail, err := svc.OrderDetail(context.Background(), connect.NewRequest(&sellingv1.OrderDetailRequest{
		TeamId: 2, OrderId: order.GetId(),
	}))
	if err != nil {
		t.Fatalf("detail: %v", err)
	}

	if detail.Msg.GetOrder().GetPlatformTotal() != frozen {
		t.Fatalf("detail platform total = %v", detail.Msg.GetOrder().GetPlatformTotal())
	}

	stat := orderStat(t, svc, 2, 0)
	if _, value := statusCount(stat, sellingv1.OrderStatus_ORDER_STATUS_PENDING); value != frozen {
		t.Fatalf("census value = %v, want %v", value, float64(frozen))
	}

	if stat.GetPreview().GetRevenue_30D() != frozen {
		t.Fatalf("revenue 30d = %v, want %v", stat.GetPreview().GetRevenue_30D(), float64(frozen))
	}
}

// …A TYPED FRACTION IS A REAL FIGURE: Rp 0,4 is placed and stored as 0,4 (nothing rounds it away), while float dust
// below 4 places is as missing as 0 and refused (platform-total-is-required-at-finalize).
func TestOrderCreate_RefusesAPlatformTotalOfDustButPlacesAFraction(t *testing.T) {
	db := san_testdb.DB(t)
	picker := knownCosts()
	svc := newServiceWithFees(t, db, picker, &fakeFees{percent: 2.5})
	shop := insertShop(t, db, 2, "Melati Shopee", "MEL-S", "shopee")

	req := feeOrderReq(shop)
	req.PlatformTotal = 0.00001

	_, err := svc.OrderCreate(context.Background(), connect.NewRequest(req))
	if connect.CodeOf(err) != connect.CodeInvalidArgument || !strings.Contains(err.Error(), "what the buyer paid") {
		t.Fatalf("err = %v — want InvalidArgument naming the missing platform total", err)
	}

	if n := countOrders(t, db); n != 0 || len(picker.picked) != 0 {
		t.Fatalf("%d orders written, picked %v — a refused order takes nothing", n, picker.picked)
	}

	req = feeOrderReq(shop)
	req.PlatformTotal = 0.4

	placed, err := svc.OrderCreate(context.Background(), connect.NewRequest(req))
	if err != nil {
		t.Fatalf("a platform total of Rp 0,4: %v — want it placed", err)
	}

	if placed.Msg.GetOrder().GetPlatformTotal() != 0.4 {
		t.Fatalf("platform total = %v, want 0,4 stored exact", placed.Msg.GetOrder().GetPlatformTotal())
	}
}
