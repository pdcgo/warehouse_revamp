package selling_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

func TestOrder_Confirm(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := context.Background()

	shopID := insertShop(t, db, 2, "Shop", "C1", "shopee")
	id := placeOrder(t, svc, 2, shopID)

	resp, err := svc.OrderConfirm(ctx, connect.NewRequest(&sellingv1.OrderConfirmRequest{TeamId: testWarehouse, OrderId: id}))
	if err != nil {
		t.Fatalf("OrderConfirm: %v", err)
	}
	if resp.Msg.GetOrder().GetStatus() != sellingv1.OrderStatus_ORDER_STATUS_CONFIRMED {
		t.Fatalf("status = %v, want CONFIRMED", resp.Msg.GetOrder().GetStatus())
	}

	// The lines still ride along on the response.
	if len(resp.Msg.GetOrder().GetItems()) != 1 {
		t.Fatalf("confirmed order should carry its items, got %d", len(resp.Msg.GetOrder().GetItems()))
	}

	// It persists: a subsequent detail read shows CONFIRMED.
	got, err := svc.OrderDetail(ctx, connect.NewRequest(&sellingv1.OrderDetailRequest{TeamId: 2, OrderId: id}))
	if err != nil {
		t.Fatalf("OrderDetail: %v", err)
	}
	if got.Msg.GetOrder().GetStatus() != sellingv1.OrderStatus_ORDER_STATUS_CONFIRMED {
		t.Fatalf("persisted status = %v, want CONFIRMED", got.Msg.GetOrder().GetStatus())
	}
}

// Only a PLACED order can be confirmed — confirming a CONFIRMED order is a precondition failure.
func TestOrder_ConfirmNotPlaced(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := context.Background()

	shopID := insertShop(t, db, 2, "Shop", "C2", "shopee")
	id := placeOrder(t, svc, 2, shopID)

	_, err := svc.OrderConfirm(ctx, connect.NewRequest(&sellingv1.OrderConfirmRequest{TeamId: testWarehouse, OrderId: id}))
	if err != nil {
		t.Fatalf("first confirm: %v", err)
	}

	_, err = svc.OrderConfirm(ctx, connect.NewRequest(&sellingv1.OrderConfirmRequest{TeamId: testWarehouse, OrderId: id}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("re-confirm code = %v, want FailedPrecondition", connect.CodeOf(err))
	}
}

// A cancelled order cannot be confirmed.
func TestOrder_ConfirmCancelled(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := context.Background()

	shopID := insertShop(t, db, 2, "Shop", "C3", "shopee")
	id := placeOrder(t, svc, 2, shopID)

	_, err := svc.OrderCancel(ctx, connect.NewRequest(&sellingv1.OrderCancelRequest{TeamId: 2, OrderId: id}))
	if err != nil {
		t.Fatalf("cancel: %v", err)
	}

	_, err = svc.OrderConfirm(ctx, connect.NewRequest(&sellingv1.OrderConfirmRequest{TeamId: testWarehouse, OrderId: id}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("confirm-after-cancel code = %v, want FailedPrecondition", connect.CodeOf(err))
	}
}

// THE SELLING TEAM THAT OWNS THE ORDER CANNOT CONFIRM IT (owner) — confirming is the warehouse
// accepting the job, so team 2 asking reads as not-found exactly like any other stranger would.
//
// This is the assertion that pins the change down. The handler now finds the order by
// (order_id, warehouse_id), so passing the SELLING team — the scope #91 used, and the one every caller
// in this file used to pass — matches no row.
func TestOrder_ConfirmIsNotTheSellingTeams(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := context.Background()

	shopID := insertShop(t, db, 2, "Shop", "C5", "shopee")
	id := placeOrder(t, svc, 2, shopID)

	_, err := svc.OrderConfirm(ctx, connect.NewRequest(&sellingv1.OrderConfirmRequest{TeamId: 2, OrderId: id}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("selling-team confirm code = %v, want NotFound", connect.CodeOf(err))
	}

	// And it is still waiting on the warehouse.
	got, err := svc.OrderDetail(ctx, connect.NewRequest(&sellingv1.OrderDetailRequest{TeamId: 2, OrderId: id}))
	if err != nil {
		t.Fatalf("OrderDetail: %v", err)
	}
	if got.Msg.GetOrder().GetStatus() != sellingv1.OrderStatus_ORDER_STATUS_PLACED {
		t.Fatalf("status = %v, want still PLACED", got.Msg.GetOrder().GetStatus())
	}
}

// You cannot confirm an order shipping from somebody else's warehouse — it reads as not-found.
func TestOrder_ConfirmCrossTeam(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := context.Background()

	shopID := insertShop(t, db, 2, "Shop", "C4", "shopee")
	id := placeOrder(t, svc, 2, shopID)

	_, err := svc.OrderConfirm(ctx, connect.NewRequest(&sellingv1.OrderConfirmRequest{TeamId: 3, OrderId: id}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("cross-team confirm code = %v, want NotFound", connect.CodeOf(err))
	}

	// And it did not change under the owning team.
	got, err := svc.OrderDetail(ctx, connect.NewRequest(&sellingv1.OrderDetailRequest{TeamId: 2, OrderId: id}))
	if err != nil {
		t.Fatalf("OrderDetail: %v", err)
	}
	if got.Msg.GetOrder().GetStatus() != sellingv1.OrderStatus_ORDER_STATUS_PLACED {
		t.Fatalf("status = %v, want still PLACED", got.Msg.GetOrder().GetStatus())
	}
}
