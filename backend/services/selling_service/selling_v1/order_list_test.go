package selling_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// listOrders is the call under test, kept short so the assertions below read as the question they ask.
func listOrders(
	t *testing.T,
	svc *selling_v1.Service,
	teamID uint64,
	status sellingv1.OrderStatus,
) *sellingv1.OrderListResponse {
	t.Helper()

	res, err := svc.OrderList(context.Background(), connect.NewRequest(&sellingv1.OrderListRequest{
		TeamId: teamID,
		Page:   &commonv1.PageFilter{Page: 1, Limit: 50},
		Status: status,
	}))
	if err != nil {
		t.Fatalf("OrderList(team=%d, status=%v): %v", teamID, status, err)
	}

	return res.Msg
}

// #151 — the WAREHOUSE can list the orders shipping from it. Until this, OrderList matched only the
// selling team, so a crew could not see the orders it was expected to pick: the queue had no read.
//
// The selling team and the warehouse are different teams (2 vs testWarehouse), so this passing means
// the second leg of the OR is genuinely doing the work — it cannot be the team_id clause in disguise.
func TestOrderList_TheWarehouseSeesOrdersShippingFromIt(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	id := confirmedOrder(t, svc, shop)

	got := listOrders(t, svc, testWarehouse, sellingv1.OrderStatus_ORDER_STATUS_UNSPECIFIED)

	if len(got.GetOrders()) != 1 {
		t.Fatalf("the warehouse sees %d orders, want 1", len(got.GetOrders()))
	}
	if got.GetOrders()[0].GetId() != id {
		t.Fatalf("the warehouse sees order %d, want %d", got.GetOrders()[0].GetId(), id)
	}

	// The selling team still sees its own — extending the read must not have taken the original away.
	mine := listOrders(t, svc, 2, sellingv1.OrderStatus_ORDER_STATUS_UNSPECIFIED)
	if len(mine.GetOrders()) != 1 {
		t.Fatalf("the selling team sees %d orders, want 1", len(mine.GetOrders()))
	}
}

// #151 — a team that is NEITHER end of the order sees nothing. The OR widened the read, and this is
// what pins that it widened it by exactly one leg rather than opening it up.
func TestOrderList_AnUnrelatedTeamSeesNothing(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	confirmedOrder(t, svc, shop)

	const strangerTeam uint64 = 902

	got := listOrders(t, svc, strangerTeam, sellingv1.OrderStatus_ORDER_STATUS_UNSPECIFIED)
	if len(got.GetOrders()) != 0 {
		t.Fatalf("an unrelated team sees %d orders, want 0", len(got.GetOrders()))
	}
	if got.GetPageInfo().GetTotalItems() != 0 {
		t.Fatalf("an unrelated team's total = %d, want 0", got.GetPageInfo().GetTotalItems())
	}
}

// #151 — the status filter, which is what turns the list into a PICK QUEUE: "the confirmed orders
// shipping from my warehouse", not "everything that ever shipped from here".
func TestOrderList_FiltersByStatus(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := context.Background()
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	// One left CONFIRMED (waiting to be picked) and one walked on to PICKING (already being worked).
	waiting := confirmedOrder(t, svc, shop)
	inProgress := confirmedOrder(t, svc, shop)

	_, err := svc.OrderPick(ctx, connect.NewRequest(&sellingv1.OrderPickRequest{
		TeamId: testWarehouse, OrderId: inProgress,
	}))
	if err != nil {
		t.Fatalf("pick: %v", err)
	}

	queue := listOrders(t, svc, testWarehouse, sellingv1.OrderStatus_ORDER_STATUS_CONFIRMED)

	if len(queue.GetOrders()) != 1 {
		t.Fatalf("the pick queue holds %d orders, want 1", len(queue.GetOrders()))
	}
	if queue.GetOrders()[0].GetId() != waiting {
		t.Fatalf("the queue holds order %d, want the un-picked %d", queue.GetOrders()[0].GetId(), waiting)
	}

	// The count must respect the filter too. It drives the pager: an unfiltered total would page a
	// one-order queue as if it held two.
	if got := queue.GetPageInfo().GetTotalItems(); got != 1 {
		t.Fatalf("the filtered total = %d, want 1", got)
	}

	// And UNSPECIFIED still means all of them.
	all := listOrders(t, svc, testWarehouse, sellingv1.OrderStatus_ORDER_STATUS_UNSPECIFIED)
	if len(all.GetOrders()) != 2 {
		t.Fatalf("unfiltered = %d orders, want 2", len(all.GetOrders()))
	}
}

// #151 — the status filter must narrow BOTH legs of the OR, asked from the SELLING side.
//
// The warehouse-side filter test above cannot show this: if the filter ever bound to the warehouse leg
// alone — the classic precedence failure for `a OR b AND c` — that test stays green while a selling
// team's filtered list quietly returns every status. So the selling side gets its own assertion.
//
// Honest note on what this does and does not pin: removing the parentheses from the handler does NOT
// fail this test, because GORM wraps a chained OR-Where before AND-ing the next one (checked against
// the emitted SQL). This is a BEHAVIOURAL pin — "filtering works from either end" — and it would catch
// the bug if the query were ever rebuilt as hand-written SQL, which is exactly when it could return.
func TestOrderList_TheStatusFilterAppliesToTheSellingSideToo(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := context.Background()
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	// A PLACED order (never confirmed) alongside a CONFIRMED one.
	placed, err := svc.OrderCreate(ctx, connect.NewRequest(orderReq(shop)))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	confirmed := confirmedOrder(t, svc, shop)

	got := listOrders(t, svc, 2, sellingv1.OrderStatus_ORDER_STATUS_CONFIRMED)

	if len(got.GetOrders()) != 1 {
		t.Fatalf("the selling team's CONFIRMED list holds %d orders, want 1 — if this is 2, the status "+
			"filter is not reaching the selling leg of the OR", len(got.GetOrders()))
	}
	if got.GetOrders()[0].GetId() != confirmed {
		t.Fatalf("filtered list holds order %d, want the confirmed %d (the placed one is %d)",
			got.GetOrders()[0].GetId(), confirmed, placed.Msg.GetOrder().GetId())
	}
}
