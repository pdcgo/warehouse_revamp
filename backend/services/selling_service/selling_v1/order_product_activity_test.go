package selling_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

func productActivity(
	t *testing.T,
	svc *selling_v1.Service,
	teamID uint64,
	productIDs []uint64,
) map[uint64]*sellingv1.OrderProductActivityItem {
	t.Helper()

	res, err := svc.OrderProductActivityByIds(
		context.Background(),
		connect.NewRequest(&sellingv1.OrderProductActivityByIdsRequest{
			TeamId: teamID,
			Filter: &sellingv1.OrderProductActivityByIdsFilter{ProductIds: productIDs},
		}),
	)
	if err != nil {
		t.Fatalf("OrderProductActivityByIds: %v", err)
	}

	out := map[uint64]*sellingv1.OrderProductActivityItem{}

	for id, list := range res.Msg.GetItems() {
		for _, it := range list.GetItems() {
			activity := it.GetActivity()
			if activity == nil {
				continue
			}

			row, ok := activity.GetMapData()[id]
			if ok {
				out[id] = row
			}
		}
	}

	return out
}

// An order makes its product's row appear, dated, with the units on the 30-day count.
func TestOrderProductActivity_LastOrderAndRecentUnits(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	shopID := insertShop(t, db, 2, "Shop", "ACT1", "shopee")
	placeOrder(t, svc, 2, shopID)

	// placeOrder sells one unit of product 1.
	row := productActivity(t, svc, 2, []uint64{1, 999})[1]
	if row == nil {
		t.Fatalf("no activity for a product that was just ordered")
	}
	if row.GetLastOrderUnix() == 0 {
		t.Fatalf("last_order_unix = 0 after an order")
	}
	if row.GetSoldQty_30D() != 1 {
		t.Fatalf("sold_qty_30d = %d, want 1", row.GetSoldQty_30D())
	}

	// A product nobody ordered is absent, not a row of zeros.
	if productActivity(t, svc, 2, []uint64{999})[999] != nil {
		t.Fatalf("a never-ordered product returned a row")
	}
}

// A CANCELLED order is not a sale. This is the whole reason the column is worth having: a dead
// product must not read as alive because somebody placed an order and then unwound it.
func TestOrderProductActivity_CancelledDoesNotCount(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	shopID := insertShop(t, db, 2, "Shop", "ACT2", "shopee")
	id := placeOrder(t, svc, 2, shopID)

	_, err := svc.OrderCancel(context.Background(), connect.NewRequest(&sellingv1.OrderCancelRequest{
		TeamId: 2, OrderId: id,
	}))
	if err != nil {
		t.Fatalf("OrderCancel: %v", err)
	}

	if productActivity(t, svc, 2, []uint64{1})[1] != nil {
		t.Fatalf("a cancelled order still counted as activity")
	}

	stat, err := svc.OrderActivityStat(context.Background(), connect.NewRequest(&sellingv1.OrderActivityStatRequest{
		TeamId: 2,
	}))
	if err != nil {
		t.Fatalf("OrderActivityStat: %v", err)
	}
	if stat.Msg.GetPreview().GetLastOrderUnix() != 0 || stat.Msg.GetPreview().GetOrders_30D() != 0 {
		t.Fatalf("stat counted a cancelled order: %v", stat.Msg.GetPreview())
	}
}

// Another team's orders are invisible — the same team scope every read here carries.
func TestOrderProductActivity_TeamScoped(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	shopID := insertShop(t, db, 3, "Their shop", "ACT3", "shopee")
	placeOrder(t, svc, 3, shopID)

	if productActivity(t, svc, 2, []uint64{1})[1] != nil {
		t.Fatalf("another team's order leaked into this team's activity")
	}
}

// The stat answers for the team rather than for listed products.
func TestOrderActivityStat_CountsThisTeamsOrders(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)

	shopID := insertShop(t, db, 2, "Shop", "ACT4", "shopee")
	placeOrder(t, svc, 2, shopID)
	placeOrder(t, svc, 2, shopID)

	res, err := svc.OrderActivityStat(context.Background(), connect.NewRequest(&sellingv1.OrderActivityStatRequest{
		TeamId: 2,
	}))
	if err != nil {
		t.Fatalf("OrderActivityStat: %v", err)
	}

	preview := res.Msg.GetPreview()
	if preview.GetOrders_30D() != 2 {
		t.Fatalf("orders_30d = %d, want 2", preview.GetOrders_30D())
	}
	if preview.GetLastOrderUnix() == 0 {
		t.Fatalf("last_order_unix = 0 after two orders")
	}
}
