package selling_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// confirmedOrder places an order and confirms it — the state the warehouse's work starts from.
func confirmedOrder(t *testing.T, svc *selling_v1.Service, shopID uint64) uint64 {
	t.Helper()

	ctx := context.Background()

	created, err := svc.OrderCreate(ctx, connect.NewRequest(orderReq(shopID)))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	id := created.Msg.GetOrder().GetId()

	_, err = svc.OrderConfirm(ctx, connect.NewRequest(&sellingv1.OrderConfirmRequest{
		TeamId: 2, OrderId: id,
	}))
	if err != nil {
		t.Fatalf("confirm: %v", err)
	}

	return id
}

// #150 — the warehouse walks an order through PICKING → PACKED → SHIPPED, and the crew is authorised
// by the ORDER'S WAREHOUSE rather than the selling team that placed it.
func TestOrderFulfil_WalksTheOrderThroughTheStates(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := context.Background()
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	id := confirmedOrder(t, svc, shop)

	// Note the team_id on every call: it is testWarehouse, NOT the selling team 2 that owns the order.
	pick, err := svc.OrderPick(ctx, connect.NewRequest(&sellingv1.OrderPickRequest{
		TeamId: testWarehouse, OrderId: id,
	}))
	if err != nil {
		t.Fatalf("pick: %v", err)
	}
	if got := pick.Msg.GetOrder().GetStatus(); got != sellingv1.OrderStatus_ORDER_STATUS_PICKING {
		t.Fatalf("after pick = %v, want PICKING", got)
	}

	pack, err := svc.OrderPack(ctx, connect.NewRequest(&sellingv1.OrderPackRequest{
		TeamId: testWarehouse, OrderId: id,
	}))
	if err != nil {
		t.Fatalf("pack: %v", err)
	}
	if got := pack.Msg.GetOrder().GetStatus(); got != sellingv1.OrderStatus_ORDER_STATUS_PACKED {
		t.Fatalf("after pack = %v, want PACKED", got)
	}

	ship, err := svc.OrderShip(ctx, connect.NewRequest(&sellingv1.OrderShipRequest{
		TeamId: testWarehouse, OrderId: id,
	}))
	if err != nil {
		t.Fatalf("ship: %v", err)
	}
	if got := ship.Msg.GetOrder().GetStatus(); got != sellingv1.OrderStatus_ORDER_STATUS_SHIPPED {
		t.Fatalf("after ship = %v, want SHIPPED", got)
	}
}

// #150 — forward only, ONE STEP AT A TIME. You cannot pack what was never picked: a skipped state
// means somebody is guessing at what happened, so it is refused rather than tolerated.
func TestOrderFulfil_RefusesASkippedStep(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := context.Background()
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	id := confirmedOrder(t, svc, shop)

	// CONFIRMED → PACKED skips picking.
	_, err := svc.OrderPack(ctx, connect.NewRequest(&sellingv1.OrderPackRequest{
		TeamId: testWarehouse, OrderId: id,
	}))
	if code := connect.CodeOf(err); code != connect.CodeFailedPrecondition {
		t.Fatalf("packing an unpicked order = %v, want FailedPrecondition", code)
	}

	// CONFIRMED → SHIPPED skips both.
	_, err = svc.OrderShip(ctx, connect.NewRequest(&sellingv1.OrderShipRequest{
		TeamId: testWarehouse, OrderId: id,
	}))
	if code := connect.CodeOf(err); code != connect.CodeFailedPrecondition {
		t.Fatalf("shipping an unpacked order = %v, want FailedPrecondition", code)
	}

	// And picking twice is refused too — the second caller finds the state already moved, which is what
	// stops two crew members both advancing the same order.
	_, err = svc.OrderPick(ctx, connect.NewRequest(&sellingv1.OrderPickRequest{
		TeamId: testWarehouse, OrderId: id,
	}))
	if err != nil {
		t.Fatalf("pick: %v", err)
	}

	_, err = svc.OrderPick(ctx, connect.NewRequest(&sellingv1.OrderPickRequest{
		TeamId: testWarehouse, OrderId: id,
	}))
	if code := connect.CodeOf(err); code != connect.CodeFailedPrecondition {
		t.Fatalf("picking twice = %v, want FailedPrecondition", code)
	}
}

// #150 — a crew can only touch orders shipping from ITS OWN warehouse. Another warehouse's order reads
// as NotFound rather than PermissionDenied, so a crew cannot even discover that an id belongs to
// someone else's building.
func TestOrderFulfil_AnotherWarehouseCannotTouchIt(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := context.Background()
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	id := confirmedOrder(t, svc, shop)

	const otherWarehouse uint64 = 901

	_, err := svc.OrderPick(ctx, connect.NewRequest(&sellingv1.OrderPickRequest{
		TeamId: otherWarehouse, OrderId: id,
	}))
	if code := connect.CodeOf(err); code != connect.CodeNotFound {
		t.Fatalf("another warehouse picking = %v, want NotFound", code)
	}

	// The SELLING team cannot either — these are the warehouse's actions, and the order's team is not
	// its warehouse. (Worth pinning: it is the one scope people will assume works.)
	_, err = svc.OrderPick(ctx, connect.NewRequest(&sellingv1.OrderPickRequest{
		TeamId: 2, OrderId: id,
	}))
	if code := connect.CodeOf(err); code != connect.CodeNotFound {
		t.Fatalf("the selling team picking = %v, want NotFound", code)
	}
}

// #70/#150 — cancel is allowed while the goods are still in the building, and refused once they have
// left. The owner's call, and the line is SHIPPED.
func TestOrderCancel_AllowedUntilShipped(t *testing.T) {
	db := san_testdb.DB(t)
	picker := &fakePicker{}
	svc := newServiceWithPicker(t, db, picker)
	ctx := context.Background()
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	// Mid-pick: still cancellable, and the stock comes back.
	id := confirmedOrder(t, svc, shop)

	_, err := svc.OrderPick(ctx, connect.NewRequest(&sellingv1.OrderPickRequest{
		TeamId: testWarehouse, OrderId: id,
	}))
	if err != nil {
		t.Fatalf("pick: %v", err)
	}

	_, err = svc.OrderCancel(ctx, connect.NewRequest(&sellingv1.OrderCancelRequest{
		TeamId: 2, OrderId: id,
	}))
	if err != nil {
		t.Fatalf("cancelling a mid-pick order must work: %v", err)
	}

	if len(picker.returned) != 1 {
		t.Fatalf("a cancel mid-pick must return the stock, returned %v", picker.returned)
	}

	// Shipped: refused. Putting the stock back would book goods onto a shelf while they are on a van.
	shipped := confirmedOrder(t, svc, shop)

	for _, step := range []func() error{
		func() error {
			_, e := svc.OrderPick(ctx, connect.NewRequest(&sellingv1.OrderPickRequest{TeamId: testWarehouse, OrderId: shipped}))
			return e
		},
		func() error {
			_, e := svc.OrderPack(ctx, connect.NewRequest(&sellingv1.OrderPackRequest{TeamId: testWarehouse, OrderId: shipped}))
			return e
		},
		func() error {
			_, e := svc.OrderShip(ctx, connect.NewRequest(&sellingv1.OrderShipRequest{TeamId: testWarehouse, OrderId: shipped}))
			return e
		},
	} {
		if err = step(); err != nil {
			t.Fatalf("walking to shipped: %v", err)
		}
	}

	before := len(picker.returned)

	_, err = svc.OrderCancel(ctx, connect.NewRequest(&sellingv1.OrderCancelRequest{
		TeamId: 2, OrderId: shipped,
	}))
	if code := connect.CodeOf(err); code != connect.CodeFailedPrecondition {
		t.Fatalf("cancelling a SHIPPED order = %v, want FailedPrecondition", code)
	}

	// And the refusal returned no stock — the goods are on a van, not on a shelf.
	if len(picker.returned) != before {
		t.Fatalf("a refused cancel returned stock anyway: %v", picker.returned)
	}
}
