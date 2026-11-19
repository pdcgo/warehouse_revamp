package selling_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// FIX AN ORDER'S SHOP (an-orders-shop-is-fixed-and-counted-on-the-day): a completed order filed under the wrong shop
// moves to another shop of the same team and marketplace that the person may write — a note row names the old and the
// new, and OrderShopChanged carries the fix to settlement and the order metrics.

// completedOrder places team 2's order in shopID, by person 7, and walks it to completed through the real moves.
func completedOrder(t *testing.T, svc *selling_v1.Service, shopID uint64) uint64 {
	t.Helper()

	id := placeOrderAs(t, svc, asUser(7), 2, shopID)
	moveOrder(t, svc, testWarehouse, id, sellingv1.OrderStatus_ORDER_STATUS_PROCESSED, "")
	moveOrder(t, svc, testWarehouse, id, sellingv1.OrderStatus_ORDER_STATUS_PICKED, "")
	moveOrder(t, svc, testWarehouse, id, sellingv1.OrderStatus_ORDER_STATUS_SHIPPING, "")
	moveOrder(t, svc, 2, id, sellingv1.OrderStatus_ORDER_STATUS_SHIPPED, "")
	moveOrder(t, svc, 2, id, sellingv1.OrderStatus_ORDER_STATUS_COMPLETED, "")

	return id
}

func fixShop(svc *selling_v1.Service, ctx context.Context, teamID, orderID, shopID uint64) (*sellingv1.Order, error) {
	resp, err := svc.OrderShopUpdate(ctx, connect.NewRequest(&sellingv1.OrderShopUpdateRequest{
		TeamId: teamID, OrderId: orderID, ShopId: shopID,
	}))
	if err != nil {
		return nil, err
	}

	return resp.Msg.GetOrder(), nil
}

func orderShop(t *testing.T, db *gorm.DB, orderID uint64) uint64 {
	t.Helper()

	var shopID uint64

	err := db.Raw(`SELECT shop_id FROM orders WHERE id = ?`, orderID).Scan(&shopID).Error
	if err != nil {
		t.Fatalf("read order %d's shop: %v", orderID, err)
	}

	return shopID
}

func shopChanges(t *testing.T, db *gorm.DB, orderID uint64) []selling_service_models.OrderShopChange {
	t.Helper()

	var rows []selling_service_models.OrderShopChange

	err := db.Where("order_id = ?", orderID).Order("id").Find(&rows).Error
	if err != nil {
		t.Fatalf("read order %d's shop changes: %v", orderID, err)
	}

	return rows
}

// shopFixed is the OrderShopChanged events a recorder caught.
func shopFixed(rec *moveRecorder) []*eventsv1.OrderShopChanged {
	rec.mu.Lock()
	defer rec.mu.Unlock()

	out := []*eventsv1.OrderShopChanged{}

	for _, event := range rec.events {
		if fixed := event.GetOrderShopChanged(); fixed != nil {
			out = append(out, fixed)
		}
	}

	return out
}

// The fix: the order is in the new shop, a note row from selling by the person names both shops, the change row
// points at that note, and ONE OrderShopChanged announces it. Naming the shop it is now in writes and announces nothing.
func TestOrderShopUpdate_MovesTheOrderAndNamesBothShops(t *testing.T) {
	db := san_testdb.DB(t)
	rec := &moveRecorder{}
	svc := newServiceWithEvents(t, db, rec.send)
	wrong := insertShop(t, db, 2, "Melati Official", "MO", "shopee")
	right := insertShop(t, db, 2, "Melati Store", "MS", "shopee")
	orderID := completedOrder(t, svc, wrong)
	_, before := lastLog(t, svc, orderID)

	got, err := fixShop(svc, asUser(7), 2, orderID, right)
	if err != nil {
		t.Fatalf("OrderShopUpdate: %v", err)
	}

	if got.GetShopId() != right || orderShop(t, db, orderID) != right {
		t.Fatalf("the order is in shop %d (answer %d), want %d", orderShop(t, db, orderID), got.GetShopId(), right)
	}

	if got.GetStatus() != sellingv1.OrderStatus_ORDER_STATUS_COMPLETED {
		t.Fatalf("status = %v, want the fix to leave it COMPLETED", got.GetStatus())
	}

	note, rows := lastLog(t, svc, orderID)
	if rows != before+1 || note.GetNote() != "Toko: Melati Official → Melati Store" ||
		note.GetStatus() != sellingv1.OrderStatus_ORDER_STATUS_UNSPECIFIED ||
		note.GetFrom() != sellingv1.OrderTimelineFrom_ORDER_TIMELINE_FROM_SELLING || note.GetActorId() != 7 {
		t.Fatalf("the newest timeline row = %+v (%d rows, before %d), want one note naming both shops, from selling, by 7",
			note, rows, before)
	}

	changes := shopChanges(t, db, orderID)
	if len(changes) != 1 || changes[0].FromShopID != wrong || changes[0].ToShopID != right ||
		changes[0].TimelineLogID != note.GetId() || changes[0].TeamID != 2 || changes[0].ActorID != 7 {
		t.Fatalf("changes = %+v, want one %d → %d on note %d by 7", changes, wrong, right, note.GetId())
	}

	fixed := shopFixed(rec)
	if len(fixed) != 1 || fixed[0].GetOrderId() != orderID || fixed[0].GetFromShopId() != wrong ||
		fixed[0].GetToShopId() != right || fixed[0].GetChangeId() != changes[0].ID ||
		fixed[0].GetTimelineLogId() != note.GetId() || fixed[0].GetTeamId() != 2 || fixed[0].GetActorId() != 7 {
		t.Fatalf("published %+v, want one OrderShopChanged of the change", fixed)
	}

	// Already there: nothing is written, nothing announced.
	_, err = fixShop(svc, asUser(7), 2, orderID, right)
	if err != nil {
		t.Fatalf("a fix to the shop it is in: %v", err)
	}

	_, after := lastLog(t, svc, orderID)
	if after != rows || len(shopChanges(t, db, orderID)) != 1 || len(shopFixed(rec)) != 1 {
		t.Fatalf("a fix to the same shop wrote %d rows, %d changes, %d events — want nothing new",
			after-rows, len(shopChanges(t, db, orderID))-1, len(shopFixed(rec))-1)
	}
}

// The new shop is the SAME TEAM's (another team's reads NotFound) and the SAME MARKETPLACE's
// (a-shops-marketplace-and-team-are-fixed) — each refused with the order left where it was and nothing announced.
func TestOrderShopUpdate_TheSameTeamAndMarketplaceOnly(t *testing.T) {
	db := san_testdb.DB(t)
	rec := &moveRecorder{}
	svc := newServiceWithEvents(t, db, rec.send)
	wrong := insertShop(t, db, 2, "Melati Official", "MO", "shopee")
	tiktok := insertShop(t, db, 2, "Melati TikTok", "MT", "tiktok")
	theirs := insertShop(t, db, 3, "Mawar Shopee", "MW", "shopee")
	orderID := completedOrder(t, svc, wrong)

	_, err := fixShop(svc, asUser(7), 2, orderID, theirs)
	wantCode(t, err, connect.CodeNotFound)

	_, err = fixShop(svc, asUser(7), 2, orderID, tiktok)
	cerr := wantCode(t, err, connect.CodeFailedPrecondition)
	if cerr.Message() != "the order's shop can only be fixed to a shop of the same marketplace" {
		t.Fatalf("refusal = %q", cerr.Message())
	}

	_, err = fixShop(svc, asUser(7), 2, orderID, 999_999)
	wantCode(t, err, connect.CodeNotFound)

	if orderShop(t, db, orderID) != wrong || len(shopChanges(t, db, orderID)) != 0 || len(shopFixed(rec)) != 0 {
		t.Fatal("a refused fix moved the order, wrote a change or announced one")
	}
}

// THE WRITE GATE (a-write-needs-a-grant-or-a-manager): a CS with no grant on the new shop is refused, naming it; the
// same CS once granted it, and the team's owner without a grant, fix it.
func TestOrderShopUpdate_TheNewShopNeedsAGrantOrAManager(t *testing.T) {
	db := san_testdb.DB(t)
	const cs, owner uint64 = 31, 32

	svc := newServiceWithRoles(t, db, fakeRoles{
		{cs, 2}:    role_basev1.Role_ROLE_SELLING_CS,
		{owner, 2}: role_basev1.Role_ROLE_SELLING_OWNER,
	})
	wrong := insertShop(t, db, 2, "Melati Official", "MO", "shopee")
	right := insertShop(t, db, 2, "Melati Store", "MS", "shopee")
	other := insertShop(t, db, 2, "Melati Outlet", "MX", "shopee")

	// The order is placed (and walked) by the owner, who may write every shop.
	id := placeOrderAs(t, svc, asUser(owner), 2, wrong)
	moveOrder(t, svc, testWarehouse, id, sellingv1.OrderStatus_ORDER_STATUS_PROCESSED, "")
	moveOrder(t, svc, testWarehouse, id, sellingv1.OrderStatus_ORDER_STATUS_PICKED, "")
	moveOrder(t, svc, testWarehouse, id, sellingv1.OrderStatus_ORDER_STATUS_SHIPPING, "")
	moveOrder(t, svc, 2, id, sellingv1.OrderStatus_ORDER_STATUS_SHIPPED, "")
	moveOrder(t, svc, 2, id, sellingv1.OrderStatus_ORDER_STATUS_COMPLETED, "")

	_, err := fixShop(svc, asUser(cs), 2, id, right)
	cerr := wantCode(t, err, connect.CodePermissionDenied)
	if cerr.Message() != "You have no access to Melati Store — ask the team's owner or admin for it" {
		t.Fatalf("refusal = %q", cerr.Message())
	}

	if orderShop(t, db, id) != wrong {
		t.Fatal("a refused fix moved the order")
	}

	err = db.Create(&selling_service_models.ShopUser{ShopID: right, UserID: cs}).Error
	if err != nil {
		t.Fatalf("grant: %v", err)
	}

	_, err = fixShop(svc, asUser(cs), 2, id, right)
	if err != nil {
		t.Fatalf("a granted CS's fix: %v", err)
	}

	_, err = fixShop(svc, asUser(owner), 2, id, other)
	if err != nil {
		t.Fatalf("the owner's fix with no grant: %v", err)
	}

	if orderShop(t, db, id) != other || len(shopChanges(t, db, id)) != 2 {
		t.Fatalf("after two fixes the order is in %d with %d changes, want %d and 2", orderShop(t, db, id),
			len(shopChanges(t, db, id)), other)
	}
}

// A CLOSED shop is taken — it refuses only new selling (a-closed-shop-refuses-only-new-selling), and its statements
// still import.
func TestOrderShopUpdate_AClosedShopIsTaken(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	wrong := insertShop(t, db, 2, "Melati Official", "MO", "shopee")
	closed := insertShop(t, db, 2, "Melati Lama", "ML", "shopee")
	orderID := completedOrder(t, svc, wrong)

	err := db.Exec(`UPDATE shops SET status = 'closed', closed_at = NOW() WHERE id = ?`, closed).Error
	if err != nil {
		t.Fatalf("close the shop: %v", err)
	}

	_, err = fixShop(svc, asUser(7), 2, orderID, closed)
	if err != nil {
		t.Fatalf("a fix to a closed shop: %v", err)
	}

	if orderShop(t, db, orderID) != closed {
		t.Fatal("the order did not move to the closed shop")
	}
}

// WHEN: from handover on — shipping, shipped, problem, completed, return, return completed, lost (a statement may carry
// the order from then; customer service sets those statuses by hand). Before handover (pending, processed, picked) and
// a cancelled order are REFUSED (FailedPrecondition), never ignored.
func TestOrderShopUpdate_FromHandoverOn(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	wrong := insertShop(t, db, 2, "Melati Official", "MO", "shopee")
	right := insertShop(t, db, 2, "Melati Store", "MS", "shopee")

	for _, tc := range []struct {
		status string
		takes  bool
	}{
		{"pending", false}, {"processed", false}, {"picked", false}, {"cancel", false},
		{"shipping", true}, {"shipped", true}, {"problem", true},
		{"completed", true}, {"return", true}, {"return_completed", true}, {"lost", true},
	} {
		t.Run(tc.status, func(t *testing.T) {
			id := placeOrder(t, svc, 2, wrong)

			// The status alone is under test, so it is set directly; completedOrder walks the real moves.
			err := db.Exec(`UPDATE orders SET status = ? WHERE id = ?`, tc.status, id).Error
			if err != nil {
				t.Fatalf("set status: %v", err)
			}

			_, err = fixShop(svc, asUser(7), 2, id, right)
			if !tc.takes {
				cerr := wantCode(t, err, connect.CodeFailedPrecondition)
				if cerr.Message() != "an order's shop is fixed from handover on — shipping, shipped, problem, completed, return, return completed or lost" {
					t.Fatalf("refusal = %q", cerr.Message())
				}

				if orderShop(t, db, id) != wrong {
					t.Fatalf("a %s order moved", tc.status)
				}

				return
			}

			if err != nil {
				t.Fatalf("a %s order's fix: %v", tc.status, err)
			}

			if orderShop(t, db, id) != right {
				t.Fatalf("a %s order did not move", tc.status)
			}
		})
	}
}

// The order's warehouse and any other team read NotFound — the fix is the selling team's.
func TestOrderShopUpdate_OnlyTheSellingTeam(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	wrong := insertShop(t, db, 2, "Melati Official", "MO", "shopee")
	orderID := completedOrder(t, svc, wrong)
	warehouseShop := insertShop(t, db, testWarehouse, "Gudang", "GD", "shopee")
	theirs := insertShop(t, db, 3, "Mawar", "MW", "shopee")

	_, err := fixShop(svc, asUser(9), testWarehouse, orderID, warehouseShop)
	wantCode(t, err, connect.CodeNotFound)

	_, err = fixShop(svc, asUser(9), 3, orderID, theirs)
	wantCode(t, err, connect.CodeNotFound)

	if orderShop(t, db, orderID) != wrong {
		t.Fatal("another team moved the order")
	}
}
