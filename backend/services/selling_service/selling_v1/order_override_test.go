package selling_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// AN OVERRIDE IS STAMPED (an-override-is-stamped-in-every-service): when Root or the Administrator writes inside a team
// they hold no role in, every row that records who acted says so — the order, each timeline row, a draft.

// asScoped is a request context as the access interceptor leaves it: who is calling, the team the request is scoped
// to, and their role there. ROLE_UNSPECIFIED is Root or the Administrator, in by the root-team bypass.
func asScoped(userID, teamID uint64, role role_basev1.Role) context.Context {
	ctx := san_auth.WithIdentity(context.Background(), &role_basev1.Identity{IdentityId: userID})
	ctx = san_auth.WithScope(ctx, teamID)

	return san_auth.WithCallerRole(ctx, role)
}

var (
	rootOutside = role_basev1.Role_ROLE_UNSPECIFIED
	sellingCS   = role_basev1.Role_ROLE_SELLING_CS
)

// timelineOverrides is each of the order's timeline rows' stamp, oldest first.
func timelineOverrides(t *testing.T, db *gorm.DB, orderID uint64) []bool {
	t.Helper()

	var rows []selling_service_models.OrderTimelineLog

	err := db.Where("order_id = ?", orderID).Order("id").Find(&rows).Error
	if err != nil {
		t.Fatalf("read timeline: %v", err)
	}

	out := make([]bool, 0, len(rows))
	for _, r := range rows {
		out = append(out, r.IsOverride)
	}

	return out
}

func orderOverride(t *testing.T, db *gorm.DB, orderID uint64) bool {
	t.Helper()

	var order selling_service_models.Order

	err := db.Where("id = ?", orderID).Take(&order).Error
	if err != nil {
		t.Fatalf("read order: %v", err)
	}

	return order.IsOverride
}

// PLACEMENT stamps the order AND both rows it opens the timeline with (the placement, the typed note) — and a member
// placing the same order stamps none of them.
func TestOrderOverride_PlacementStampsTheOrderAndItsOpeningRows(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	shopID := insertShop(t, db, 2, "Shop", "S1", "shopee")

	cases := []struct {
		name string
		ctx  context.Context
		want bool
	}{
		{"root outside team 2", asScoped(1, 2, rootOutside), true},
		{"team 2's own CS", asScoped(7, 2, sellingCS), false},
	}

	for _, c := range cases {
		req := orderReq(shopID)
		req.Note = "handle with care"

		created, err := svc.OrderCreate(c.ctx, connect.NewRequest(req))
		if err != nil {
			t.Fatalf("%s: OrderCreate: %v", c.name, err)
		}

		orderID := created.Msg.GetOrder().GetId()

		got := orderOverride(t, db, orderID)
		if got != c.want {
			t.Errorf("%s: orders.is_override = %v, want %v", c.name, got, c.want)
		}

		stamps := timelineOverrides(t, db, orderID)
		if len(stamps) != 2 {
			t.Fatalf("%s: %d opening timeline rows, want 2 (placed, the note)", c.name, len(stamps))
		}

		for i, got := range stamps {
			if got != c.want {
				t.Errorf("%s: timeline row %d is_override = %v, want %v", c.name, i, got, c.want)
			}
		}
	}
}

// EVERY LATER TIMELINE WRITER stamps its own row by its own caller: a status move (the choke point every transition
// passes through), a note and a receipt edit. Root's rows say override; the member's rows beside them do not.
func TestOrderOverride_EachTimelineRowCarriesItsOwnCaller(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	shopID := insertShop(t, db, 2, "Shop", "S1", "shopee")

	created, err := svc.OrderCreate(asScoped(7, 2, sellingCS), connect.NewRequest(orderReq(shopID)))
	if err != nil {
		t.Fatalf("OrderCreate: %v", err)
	}

	orderID := created.Msg.GetOrder().GetId()

	// Root confirms it from outside the WAREHOUSE — the team a warehouse move is scoped to.
	moved, err := svc.OrderStatusChange(asScoped(1, testWarehouse, rootOutside),
		connect.NewRequest(&sellingv1.OrderStatusChangeRequest{
			TeamId: testWarehouse, OrderIds: []uint64{orderID}, To: sellingv1.OrderStatus_ORDER_STATUS_PROCESSED,
		}))
	if err != nil {
		t.Fatalf("OrderStatusChange: %v", err)
	}

	if !moved.Msg.GetResults()[0].GetMoved() {
		t.Fatalf("move refused: %s", moved.Msg.GetResults()[0].GetRefusedReason())
	}

	_, err = svc.OrderNoteCreate(asScoped(1, 2, rootOutside), connect.NewRequest(&sellingv1.OrderNoteCreateRequest{
		TeamId: 2, OrderId: orderID, Note: "root looked at this",
	}))
	if err != nil {
		t.Fatalf("OrderNoteCreate by root: %v", err)
	}

	_, err = svc.OrderNoteCreate(asScoped(7, 2, sellingCS), connect.NewRequest(&sellingv1.OrderNoteCreateRequest{
		TeamId: 2, OrderId: orderID, Note: "the CS replied",
	}))
	if err != nil {
		t.Fatalf("OrderNoteCreate by CS: %v", err)
	}

	_, err = editReceipt(svc, asScoped(1, 2, rootOutside), 2, orderID, str("JNE-ROOT"), nil)
	if err != nil {
		t.Fatalf("OrderReceiptUpdate: %v", err)
	}

	// placed (CS), processed (root), note (root), note (CS), receipt edit (root).
	want := []bool{false, true, true, false, true}

	got := timelineOverrides(t, db, orderID)
	if len(got) != len(want) {
		t.Fatalf("%d timeline rows, want %d", len(got), len(want))
	}

	for i := range want {
		if got[i] != want[i] {
			t.Errorf("timeline row %d is_override = %v, want %v (all: %v)", i, got[i], want[i], got)
		}
	}

	if orderOverride(t, db, orderID) {
		t.Error("the order says override — its creator was the team's own CS; later rows must not rewrite it")
	}
}

// A DRAFT'S STAMP FOLLOWS THE PUSH, as its author does: root pushing from outside the team stamps it, and the team's
// own person re-pushing the same draft takes it over and clears it.
func TestOrderOverride_ADraftsStampFollowsThePush(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	steps := []struct {
		name string
		ctx  context.Context
		want bool
	}{
		{"root outside team 2 pushes it", asScoped(1, 2, rootOutside), true},
		{"team 2's CS re-pushes it", asScoped(7, 2, sellingCS), false},
		{"root re-pushes it again", asScoped(1, 2, rootOutside), true},
	}

	for _, s := range steps {
		res, err := svc.OrderDraftPush(s.ctx, connect.NewRequest(scrape()))
		if err != nil {
			t.Fatalf("%s: OrderDraftPush: %v", s.name, err)
		}

		var draft selling_service_models.OrderDraft

		err = db.Where("id = ?", res.Msg.GetDraft().GetId()).Take(&draft).Error
		if err != nil {
			t.Fatalf("%s: read draft: %v", s.name, err)
		}

		if draft.IsOverride != s.want {
			t.Errorf("%s: order_drafts.is_override = %v, want %v", s.name, draft.IsOverride, s.want)
		}
	}
}

// THE STAMP TRAVELS ON THE EVENTS: OrderPlaced carries the placement's flag and OrderCancelled the CANCEL's own, so the
// fees, the opening row and the reversals a consumer posts for each actor say whether that act was an override. A
// cancel by somebody else never inherits the placement's flag.
func TestOrderOverride_EachEventCarriesItsOwnActsStamp(t *testing.T) {
	db := san_testdb.DB(t)
	rec := &recorder{}
	svc := newServiceWithEvents(t, db, rec.send)
	shopID := insertShop(t, db, 2, "Shop", "S1", "shopee")

	cases := []struct {
		name                    string
		placer, canceller       context.Context
		wantPlaced, wantCancels bool
	}{
		{"root places, the CS cancels", asScoped(1, 2, rootOutside), asScoped(7, 2, sellingCS), true, false},
		{"the CS places, root cancels", asScoped(7, 2, sellingCS), asScoped(1, 2, rootOutside), false, true},
	}

	for _, c := range cases {
		rec.events = nil

		created, err := svc.OrderCreate(c.placer, connect.NewRequest(orderReq(shopID)))
		if err != nil {
			t.Fatalf("%s: OrderCreate: %v", c.name, err)
		}

		_, err = svc.OrderCancel(c.canceller, connect.NewRequest(&sellingv1.OrderCancelRequest{
			TeamId: 2, OrderId: created.Msg.GetOrder().GetId(),
		}))
		if err != nil {
			t.Fatalf("%s: OrderCancel: %v", c.name, err)
		}

		if len(rec.events) != 2 || rec.events[0].GetOrderPlaced() == nil || rec.events[1].GetOrderCancelled() == nil {
			t.Fatalf("%s: published %v, want OrderPlaced then OrderCancelled", c.name, rec.events)
		}

		if got := rec.events[0].GetOrderPlaced().GetActorIsOverride(); got != c.wantPlaced {
			t.Errorf("%s: OrderPlaced.actor_is_override = %v, want %v", c.name, got, c.wantPlaced)
		}

		if got := rec.events[1].GetOrderCancelled().GetActorIsOverride(); got != c.wantCancels {
			t.Errorf("%s: OrderCancelled.actor_is_override = %v, want %v", c.name, got, c.wantCancels)
		}
	}
}
