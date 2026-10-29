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
		t.Fatalf("response platform total = %d, want 41500", got)
	}

	detail, err := svc.OrderDetail(context.Background(), connect.NewRequest(&sellingv1.OrderDetailRequest{
		TeamId: 2, OrderId: created.Msg.GetOrder().GetId(),
	}))
	if err != nil {
		t.Fatalf("detail: %v", err)
	}

	if got := detail.Msg.GetOrder().GetPlatformTotal(); got != 41_500 {
		t.Fatalf("detail platform total = %d, want 41500", got)
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
		t.Fatalf("pushed platform total = %d, want 130000", draft.GetPlatformTotal())
	}

	second := scrape()
	second.PlatformTotal = 128_000

	if got := push(t, svc, 7, second).GetDraft().GetPlatformTotal(); got != 128_000 {
		t.Fatalf("re-pushed platform total = %d — an untouched field follows the app's latest reading", got)
	}

	edited := updateDraft(t, svc, 7, &sellingv1.OrderDraftUpdateRequest{
		TeamId: 2, DraftId: draft.GetId(), PlatformTotal: i64(125_000),
	})
	if edited.GetPlatformTotal() != 125_000 {
		t.Fatalf("edited platform total = %d, want 125000", edited.GetPlatformTotal())
	}

	if !contains(edited.GetTouchedFields(), "platform_total") {
		t.Fatalf("touched %v — the edited platform total must be marked", edited.GetTouchedFields())
	}

	again := scrape()
	again.PlatformTotal = 99_000

	if got := push(t, svc, 7, again).GetDraft().GetPlatformTotal(); got != 125_000 {
		t.Fatalf("platform total = %d after a re-push — the person's 125000 must stand", got)
	}

	detail, err := draftDetail(t, svc, 7, 2, draft.GetId())
	if err != nil {
		t.Fatalf("detail: %v", err)
	}

	if detail.GetPlatformTotal() != 125_000 {
		t.Fatalf("detail platform total = %d, want the stored 125000", detail.GetPlatformTotal())
	}

	cleared := updateDraft(t, svc, 7, &sellingv1.OrderDraftUpdateRequest{
		TeamId: 2, DraftId: draft.GetId(), PlatformTotal: i64(0),
	})
	if cleared.GetPlatformTotal() != 0 || !contains(cleared.GetTouchedFields(), "platform_total") {
		t.Fatalf("cleared platform total = %d, touched %v — want 0, still marked", cleared.GetPlatformTotal(),
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
		TeamId: 2, DraftId: draftID, PlatformTotal: i64(131_000),
	})

	order, err := promote(t, svc, 7, 2, draftID)
	if err != nil {
		t.Fatalf("promote: %v", err)
	}

	if order.GetPlatformTotal() != 131_000 {
		t.Fatalf("promoted platform total = %d, want the draft's 131000", order.GetPlatformTotal())
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
		TeamId: 2, DraftId: draftID, PlatformTotal: i64(0),
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
