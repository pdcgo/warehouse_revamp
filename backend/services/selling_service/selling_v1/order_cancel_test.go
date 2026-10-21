package selling_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
)

func TestOrder_Cancel(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := context.Background()

	shopID := insertShop(t, db, 2, "Shop", "X1", "shopee")
	id := placeOrder(t, svc, 2, shopID)

	resp, err := svc.OrderCancel(ctx, connect.NewRequest(&sellingv1.OrderCancelRequest{TeamId: 2, OrderId: id}))
	if err != nil {
		t.Fatalf("OrderCancel: %v", err)
	}
	if resp.Msg.GetOrder().GetStatus() != sellingv1.OrderStatus_ORDER_STATUS_CANCEL {
		t.Fatalf("status = %v, want CANCEL", resp.Msg.GetOrder().GetStatus())
	}
}

// PENDING ONLY (who-may-cancel-a-pending-order): a processed order is refused, and becomes cancellable
// once its warehouse hands it back to pending — the moment the goods are unpacked and re-shelved.
func TestOrder_CancelOnlyFromPending(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := context.Background()

	shopID := insertShop(t, db, 2, "Shop", "X2", "shopee")
	id := placeOrder(t, svc, 2, shopID)

	moveOrder(t, svc, testWarehouse, id, sellingv1.OrderStatus_ORDER_STATUS_PROCESSED, "")

	_, err := svc.OrderCancel(ctx, connect.NewRequest(&sellingv1.OrderCancelRequest{TeamId: 2, OrderId: id}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("cancelling a processed order = %v, want FailedPrecondition", connect.CodeOf(err))
	}

	moveOrder(t, svc, testWarehouse, id, sellingv1.OrderStatus_ORDER_STATUS_PENDING, "platform cancelled")

	resp, err := svc.OrderCancel(ctx, connect.NewRequest(&sellingv1.OrderCancelRequest{TeamId: 2, OrderId: id}))
	if err != nil {
		t.Fatalf("cancel once handed back to pending: %v", err)
	}
	if resp.Msg.GetOrder().GetStatus() != sellingv1.OrderStatus_ORDER_STATUS_CANCEL {
		t.Fatalf("status = %v, want CANCEL", resp.Msg.GetOrder().GetStatus())
	}
}

// Cancelling an already cancelled order is a precondition failure (terminal state).
func TestOrder_CancelAlreadyCancelled(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := context.Background()

	shopID := insertShop(t, db, 2, "Shop", "X3", "shopee")
	id := placeOrder(t, svc, 2, shopID)

	_, err := svc.OrderCancel(ctx, connect.NewRequest(&sellingv1.OrderCancelRequest{TeamId: 2, OrderId: id}))
	if err != nil {
		t.Fatalf("first cancel: %v", err)
	}

	_, err = svc.OrderCancel(ctx, connect.NewRequest(&sellingv1.OrderCancelRequest{TeamId: 2, OrderId: id}))
	if connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Fatalf("re-cancel code = %v, want FailedPrecondition", connect.CodeOf(err))
	}
}

// You cannot cancel another team's order — it reads as not-found and stays unchanged.
func TestOrder_CancelCrossTeam(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := context.Background()

	shopID := insertShop(t, db, 2, "Shop", "X4", "shopee")
	id := placeOrder(t, svc, 2, shopID)

	_, err := svc.OrderCancel(ctx, connect.NewRequest(&sellingv1.OrderCancelRequest{TeamId: 3, OrderId: id}))
	if connect.CodeOf(err) != connect.CodeNotFound {
		t.Fatalf("cross-team cancel code = %v, want NotFound", connect.CodeOf(err))
	}

	got, err := svc.OrderDetail(ctx, connect.NewRequest(&sellingv1.OrderDetailRequest{TeamId: 2, OrderId: id}))
	if err != nil {
		t.Fatalf("OrderDetail: %v", err)
	}
	if got.Msg.GetOrder().GetStatus() != sellingv1.OrderStatus_ORDER_STATUS_PENDING {
		t.Fatalf("status = %v, want still PENDING", got.Msg.GetOrder().GetStatus())
	}
}
