package selling_v1_test

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"

	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// THE ORDER NEVER CALLS SETTLEMENT (settlement-opens-the-sale-from-the-order-event). It publishes, and
// settlement opens and cancels the order's account from the events — so these tests pin what the events
// CARRY, the half of the contract this service owns. What settlement does with them is
// settlement_service's order_sale_test.go.

func sellerCtx(id uint64) context.Context {
	return san_auth.WithIdentity(context.Background(), &role_basev1.Identity{IdentityId: id})
}

func createMarketplaceOrder(
	t *testing.T,
	svc *selling_v1.Service,
	ctx context.Context,
	shopID uint64,
	marketplaceTotal int64,
) *sellingv1.Order {
	t.Helper()

	resp, err := svc.OrderCreate(ctx, connect.NewRequest(&sellingv1.OrderCreateRequest{
		PlatformCreatedAtUnix: testPlatformDate,
		TeamId:                2, ShopId: shopID, WarehouseId: testWarehouse,
		CustomerName: "Budi", Subtotal: 10000, Total: 10000,
		MarketplaceTotal: marketplaceTotal,
		Items: []*sellingv1.OrderItem{
			{ProductId: 1, Sku: "SKU1", Name: "Widget", Quantity: 1, UnitPrice: 10000},
		},
	}))
	if err != nil {
		t.Fatalf("OrderCreate: %v", err)
	}

	return resp.Msg.GetOrder()
}

// *Order Placed* carries everything settlement opens the account from: the shop, what the platform
// says the buyer paid, and who placed it — the creator read from the TOKEN, never from the request.
func TestOrderCreate_ThePlacedEventCarriesTheSale(t *testing.T) {
	db := san_testdb.DB(t)
	rec := &recorder{}
	svc := newServiceWithEvents(t, db, rec.send)

	shopID := insertShop(t, db, 2, "Shop", "ST1", "shopee")
	placed := createMarketplaceOrder(t, svc, sellerCtx(42), shopID, 9500)

	got := rec.placed(t)
	if got.GetOrderId() != placed.GetId() || got.GetShopId() != shopID || got.GetTeamId() != 2 ||
		got.GetMarketplaceTotal() != 9500 || got.GetActorId() != 42 {
		t.Fatalf("the placed event does not carry the sale: %+v", got)
	}

	var stored selling_service_models.Order

	err := db.First(&stored, placed.GetId()).Error
	if err != nil {
		t.Fatalf("read order: %v", err)
	}

	if stored.CreatedByUserID != 42 {
		t.Fatalf("orders.created_by_user_id = %d, want 42", stored.CreatedByUserID)
	}

	// The account is dated by the order's own moment — the envelope's occurred_at.
	if rec.events[0].GetOccurredAt().AsTime().Sub(stored.CreatedAt).Abs() > time.Millisecond {
		t.Fatalf("occurred_at %v is not the order's created_at %v", rec.events[0].GetOccurredAt().AsTime(), stored.CreatedAt)
	}
}

// *Order Cancelled* carries the shop whose account the sale is cancelled on, and is dated by the instant
// the cancel was WRITTEN — settlement derives the cancel's key from that date, so it must be the
// order's own, not a clock read at publish time.
func TestOrderCancel_TheCancelledEventCarriesTheShop(t *testing.T) {
	db := san_testdb.DB(t)
	rec := &recorder{}
	svc := newServiceWithEvents(t, db, rec.send)

	shopID := insertShop(t, db, 2, "Shop", "ST4", "shopee")
	placed := createMarketplaceOrder(t, svc, sellerCtx(42), shopID, 9500)

	_, err := svc.OrderCancel(sellerCtx(43), connect.NewRequest(&sellingv1.OrderCancelRequest{
		TeamId:  2,
		OrderId: placed.GetId(),
	}))
	if err != nil {
		t.Fatalf("OrderCancel: %v", err)
	}

	if len(rec.events) != 2 {
		t.Fatalf("published %d events, want 2 (placed, then cancelled)", len(rec.events))
	}

	got := rec.events[1].GetOrderCancelled()
	if got.GetOrderId() != placed.GetId() || got.GetShopId() != shopID || got.GetActorId() != 43 {
		t.Fatalf("the cancelled event does not carry the sale: %+v", got)
	}

	var stored selling_service_models.Order

	err = db.First(&stored, placed.GetId()).Error
	if err != nil {
		t.Fatalf("read order: %v", err)
	}

	if rec.events[1].GetOccurredAt().AsTime().Sub(stored.UpdatedAt).Abs() > time.Millisecond {
		t.Fatalf("occurred_at %v is not the instant the cancel was written (%v)",
			rec.events[1].GetOccurredAt().AsTime(), stored.UpdatedAt)
	}
}
