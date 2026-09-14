package selling_v1_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// fakeSettlement stands in for settlement_service. It records what it was asked, and can refuse on
// demand — the refusal is the case the decision is about.
type fakeSettlement struct {
	opened    []selling_v1.SaleOpening
	cancelled []selling_v1.SaleCancel
	err       error
}

func (f *fakeSettlement) OpenSale(_ context.Context, sale selling_v1.SaleOpening) error {
	f.opened = append(f.opened, sale)

	return f.err
}

func (f *fakeSettlement) CancelSale(_ context.Context, cancel selling_v1.SaleCancel) error {
	f.cancelled = append(f.cancelled, cancel)

	return f.err
}

func newServiceWithSettlement(t *testing.T, db *gorm.DB, settlement selling_v1.SettlementPoster) *selling_v1.Service {
	t.Helper()

	return selling_v1.NewService(db, &fakePicker{}, nil, &fakeCatalog{}, &fakeCredit{}, settlement)
}

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
		TeamId: 2, ShopId: shopID, WarehouseId: testWarehouse,
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

// Placing a marketplace order opens its settlement account with what the buyer paid, and names the
// creator from the TOKEN — never from the request.
func TestOrderCreate_OpensTheSettlementAccount(t *testing.T) {
	db := san_testdb.DB(t)
	settlement := &fakeSettlement{}
	svc := newServiceWithSettlement(t, db, settlement)

	shopID := insertShop(t, db, 2, "Shop", "ST1", "shopee")
	placed := createMarketplaceOrder(t, svc, sellerCtx(42), shopID, 9500)

	if len(settlement.opened) != 1 {
		t.Fatalf("OpenSale called %d times, want 1", len(settlement.opened))
	}

	got := settlement.opened[0]
	if got.OrderID != placed.GetId() || got.ShopID != shopID || got.TeamID != 2 ||
		got.MarketplaceTotal != 9500 || got.CreatedByUserID != 42 {
		t.Fatalf("unexpected opening: %+v", got)
	}

	var stored selling_service_models.Order

	err := db.First(&stored, placed.GetId()).Error
	if err != nil {
		t.Fatalf("read order: %v", err)
	}

	if stored.CreatedByUserID != 42 {
		t.Fatalf("orders.created_by_user_id = %d, want 42", stored.CreatedByUserID)
	}
}

// 0 means NOT RECORDED — a phone order has no marketplace sale, so no account is opened for it.
func TestOrderCreate_WithoutAMarketplaceTotalOpensNoAccount(t *testing.T) {
	db := san_testdb.DB(t)
	settlement := &fakeSettlement{}
	svc := newServiceWithSettlement(t, db, settlement)

	shopID := insertShop(t, db, 2, "Shop", "ST2", "shopee")
	createMarketplaceOrder(t, svc, sellerCtx(42), shopID, 0)

	if len(settlement.opened) != 0 {
		t.Fatalf("OpenSale called for an order with no marketplace total")
	}
}

// ⚠ THE DECISION ITSELF (#the-order-commits-without-settlement): a settlement failure never fails the
// order. The buyer has already paid; refusing would lose the only record of the sale.
func TestOrderCreate_ASettlementFailureDoesNotFailTheOrder(t *testing.T) {
	db := san_testdb.DB(t)
	settlement := &fakeSettlement{err: errors.New("settlement is down")}
	svc := newServiceWithSettlement(t, db, settlement)

	shopID := insertShop(t, db, 2, "Shop", "ST3", "shopee")
	placed := createMarketplaceOrder(t, svc, sellerCtx(42), shopID, 9500)

	if placed.GetId() == 0 {
		t.Fatalf("the order was not placed")
	}
}

// A cancel undoes the sale on the account, dated by the instant the cancel was WRITTEN — the key is
// derived from that date, so it must be the order's own, not a clock read at call time.
func TestOrderCancel_CancelsTheSettlementSale(t *testing.T) {
	db := san_testdb.DB(t)
	settlement := &fakeSettlement{}
	svc := newServiceWithSettlement(t, db, settlement)

	shopID := insertShop(t, db, 2, "Shop", "ST4", "shopee")
	placed := createMarketplaceOrder(t, svc, sellerCtx(42), shopID, 9500)

	resp, err := svc.OrderCancel(sellerCtx(43), connect.NewRequest(&sellingv1.OrderCancelRequest{
		TeamId:  2,
		OrderId: placed.GetId(),
	}))
	if err != nil {
		t.Fatalf("OrderCancel: %v", err)
	}

	if len(settlement.cancelled) != 1 {
		t.Fatalf("CancelSale called %d times, want 1", len(settlement.cancelled))
	}

	got := settlement.cancelled[0]
	if got.OrderID != placed.GetId() || got.ShopID != shopID || got.ActorID != 43 {
		t.Fatalf("unexpected cancel: %+v", got)
	}

	var stored selling_service_models.Order

	err = db.First(&stored, placed.GetId()).Error
	if err != nil {
		t.Fatalf("read order: %v", err)
	}

	if !got.CancelledAt.Equal(stored.UpdatedAt) && got.CancelledAt.Sub(stored.UpdatedAt).Abs() > time.Millisecond {
		t.Fatalf("CancelledAt %v is not the instant the cancel was written (%v)", got.CancelledAt, stored.UpdatedAt)
	}

	if resp.Msg.GetOrder().GetStatus() != sellingv1.OrderStatus_ORDER_STATUS_CANCELLED {
		t.Fatalf("status = %v, want CANCELLED", resp.Msg.GetOrder().GetStatus())
	}
}
