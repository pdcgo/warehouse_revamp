package main

import (
	"context"
	"errors"
	"testing"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	role_basev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/role_base/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_service_models"
	"github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_v1"
)

// a-missing-account-is-found-by-its-opened-at — THROUGH THE COMPOSITION ROOT: selling places a real order (real take),
// settlement opens its account from the Order Placed event selling published, and the order learns of it through
// NewSettlementOpenedMarker. A failed open leaves the column NULL, the order committed, and the list's
// `settlement_not_opened` filter finds it.

type openedFixture struct {
	db         *gorm.DB
	orders     *selling_v1.Service
	settlement *settlement_v1.Service
	placed     []*eventsv1.Event
	team, shop uint64
}

func newOpenedFixture(t *testing.T, team, warehouse, product uint64) *openedFixture {
	t.Helper()

	f := &openedFixture{team: team}
	f.db = san_testdb.DB(t)

	capture := func(_ context.Context, _ *role_basev1.Identity, event *eventsv1.Event) error {
		if event.GetOrderPlaced() != nil {
			f.placed = append(f.placed, event)
		}

		return nil
	}

	inventory := inventory_v1.NewService(f.db, nil, nil, nil, nil, nil, nil, nil)
	f.orders = selling_v1.NewService(f.db, NewStockPicker(inventory), capture, nil, nil, runsEveryShop{}, nil, nil, nil)
	f.settlement = settlement_v1.NewService(f.db, nil, nil, nil, NewSettlementOpenedMarker(f.orders))

	stockForPicker(t, inventory, team, warehouse, product, 10)
	f.shop = shopForOrders(t, f.db, team)

	return f
}

func (f *openedFixture) place(t *testing.T, warehouse, product uint64) uint64 {
	t.Helper()

	res, err := f.orders.OrderCreate(context.Background(), connect.NewRequest(twoLinesOf(f.team, f.shop, warehouse, product)))
	if err != nil {
		t.Fatalf("OrderCreate: %v", err)
	}

	return res.Msg.GetOrder().GetId()
}

func (f *openedFixture) openedAt(t *testing.T, orderID uint64) *time.Time {
	t.Helper()

	var order selling_service_models.Order

	err := f.db.Select("id", "settlement_opened_at").Where("id = ?", orderID).Take(&order).Error
	if err != nil {
		t.Fatalf("read order %d: %v", orderID, err)
	}

	return order.SettlementOpenedAt
}

// notOpened is the list's filter and the stat's mirror of it, for the fixture's team.
func (f *openedFixture) notOpened(t *testing.T) ([]uint64, int64) {
	t.Helper()

	res, err := f.orders.OrderList(context.Background(), connect.NewRequest(&sellingv1.OrderListRequest{
		TeamId: f.team,
		Filter: &sellingv1.OrderListFilter{SettlementNotOpened: true},
		Page:   &commonv1.CommonPagination{Page: 1, Limit: 50},
	}))
	if err != nil {
		t.Fatalf("OrderList(settlement_not_opened): %v", err)
	}

	stat, err := f.orders.OrderStat(context.Background(), connect.NewRequest(&sellingv1.OrderStatRequest{
		TeamId: f.team,
		Filter: &sellingv1.OrderStatFilter{SettlementNotOpened: true},
	}))
	if err != nil {
		t.Fatalf("OrderStat(settlement_not_opened): %v", err)
	}

	var counted int64
	for _, c := range stat.Msg.GetByStatus() {
		counted += c.GetCount()
	}

	return res.Msg.GetIds(), counted
}

// THE OPEN STAMPS IT: until settlement hears Order Placed the order reads "not opened" and the filter lists it; once the
// account opens, the order carries the moment its `initial_total` was written, and the filter no longer lists it. A
// redelivery of the same event changes nothing.
func TestSettlementOpenedAt_TheOpenStampsTheOrder(t *testing.T) {
	const (
		team      uint64 = 9_000_050
		warehouse uint64 = 9_000_051
		product   uint64 = 9_000_052
	)

	f := newOpenedFixture(t, team, warehouse, product)
	order := f.place(t, warehouse, product)

	if at := f.openedAt(t, order); at != nil {
		t.Fatalf("a placed order reads opened at %v before settlement heard of it", at)
	}

	ids, counted := f.notOpened(t)
	if len(ids) != 1 || ids[0] != order || counted != 1 {
		t.Fatalf("before the open the filter lists %v (stat %d), want [%d] (1)", ids, counted, order)
	}

	if len(f.placed) != 1 {
		t.Fatalf("selling published %d Order Placed, want 1", len(f.placed))
	}

	handler := f.settlement.OrderSaleHandler()

	err := handler(context.Background(), f.placed[0])
	if err != nil {
		t.Fatalf("settlement opening the account: %v", err)
	}

	var opening settlement_service_models.SettlementLog

	err = f.db.Where("order_id = ? AND settlement_type = 'initial_total'", order).Take(&opening).Error
	if err != nil {
		t.Fatalf("the opening row: %v", err)
	}

	at := f.openedAt(t, order)
	if at == nil || !at.Equal(opening.CreatedAt) {
		t.Fatalf("settlement_opened_at = %v, want the opening row's %v", at, opening.CreatedAt)
	}

	ids, counted = f.notOpened(t)
	if len(ids) != 0 || counted != 0 {
		t.Fatalf("after the open the filter lists %v (stat %d), want none", ids, counted)
	}

	// A redelivery is an idempotent hit on the same row: the first moment stays.
	err = handler(context.Background(), f.placed[0])
	if err != nil {
		t.Fatalf("redelivery: %v", err)
	}

	again := f.openedAt(t, order)
	if again == nil || !again.Equal(*at) {
		t.Fatalf("after a redelivery settlement_opened_at = %v, want it kept at %v", again, at)
	}
}

// A FAILED OPEN LEAVES IT NULL: settlement refuses the opening (here its account for the order already names another
// shop, so the post is refused as the wrong shop) and the event is NACKed — the order is committed all the same, still
// reads "not opened", and is exactly what the filter lists.
func TestSettlementOpenedAt_AFailedOpenLeavesItNullAndTheFilterListsIt(t *testing.T) {
	const (
		team      uint64 = 9_000_060
		warehouse uint64 = 9_000_061
		product   uint64 = 9_000_062
	)

	f := newOpenedFixture(t, team, warehouse, product)
	opened := f.place(t, warehouse, product)
	failed := f.place(t, warehouse, product)

	handler := f.settlement.OrderSaleHandler()

	// The first opens normally.
	err := handler(context.Background(), f.placed[0])
	if err != nil {
		t.Fatalf("opening order %d: %v", opened, err)
	}

	// The second's account is already there under another shop — settlement refuses to post onto it.
	err = f.db.Create(&settlement_service_models.OrderSettlement{OrderID: failed, TeamID: team, ShopID: f.shop + 1}).Error
	if err != nil {
		t.Fatalf("seed the clashing account: %v", err)
	}

	err = handler(context.Background(), f.placed[1])
	if err == nil {
		t.Fatal("settlement opened an account it should have refused")
	}

	var committed selling_service_models.Order

	err = f.db.Where("id = ?", failed).Take(&committed).Error
	if err != nil || errors.Is(err, gorm.ErrRecordNotFound) {
		t.Fatalf("the order whose open failed is not committed: %v", err)
	}

	if committed.SettlementOpenedAt != nil {
		t.Fatalf("a failed open stamped settlement_opened_at = %v", committed.SettlementOpenedAt)
	}

	if f.openedAt(t, opened) == nil {
		t.Fatal("the order that opened is not stamped")
	}

	ids, counted := f.notOpened(t)
	if len(ids) != 1 || ids[0] != failed || counted != 1 {
		t.Fatalf("the filter lists %v (stat %d), want only the failed order %d (1)", ids, counted, failed)
	}
}
