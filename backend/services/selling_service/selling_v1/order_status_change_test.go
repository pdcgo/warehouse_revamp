package selling_v1_test

import (
	"context"
	"strings"
	"testing"

	"connectrpc.com/connect"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// changeStatus is the call under test: one move, for the orders given, by the team given.
func changeStatus(
	t *testing.T,
	svc *selling_v1.Service,
	teamID uint64,
	to sellingv1.OrderStatus,
	note string,
	orderIDs ...uint64,
) []*sellingv1.OrderStatusChangeResult {
	t.Helper()

	res, err := svc.OrderStatusChange(context.Background(), connect.NewRequest(&sellingv1.OrderStatusChangeRequest{
		TeamId: teamID, OrderIds: orderIDs, To: to, Note: note,
	}))
	if err != nil {
		t.Fatalf("OrderStatusChange(team=%d, to=%v): %v", teamID, to, err)
	}

	return res.Msg.GetResults()
}

// moveOrder makes one move that must go through.
func moveOrder(t *testing.T, svc *selling_v1.Service, teamID, orderID uint64, to sellingv1.OrderStatus, note string) {
	t.Helper()

	got := changeStatus(t, svc, teamID, to, note, orderID)
	if !got[0].GetMoved() {
		t.Fatalf("moving order %d to %v was refused: %s", orderID, to, got[0].GetRefusedReason())
	}
}

// processedOrder places an order and has its warehouse confirm it — the state the pick starts from.
func processedOrder(t *testing.T, svc *selling_v1.Service, shopID uint64) uint64 {
	t.Helper()

	created, err := svc.OrderCreate(context.Background(), connect.NewRequest(orderReq(shopID)))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	id := created.Msg.GetOrder().GetId()
	moveOrder(t, svc, testWarehouse, id, sellingv1.OrderStatus_ORDER_STATUS_PROCESSED, "")

	return id
}

// orderStatus reads an order's status from its warehouse's side.
func orderStatus(t *testing.T, svc *selling_v1.Service, orderID uint64) sellingv1.OrderStatus {
	t.Helper()

	got, err := svc.OrderDetail(context.Background(), connect.NewRequest(&sellingv1.OrderDetailRequest{
		TeamId: testWarehouse, OrderId: orderID,
	}))
	if err != nil {
		t.Fatalf("detail of %d: %v", orderID, err)
	}

	return got.Msg.GetOrder().GetStatus()
}

// one-status-change-for-every-plain-move — the warehouse takes an order from pending to the courier,
// one move at a time, and each move is a row on its history.
func TestOrderStatusChange_TheWarehouseWalksTheOrderToTheCourier(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	id := processedOrder(t, svc, shop)
	moveOrder(t, svc, testWarehouse, id, sellingv1.OrderStatus_ORDER_STATUS_PICKED, "")
	moveOrder(t, svc, testWarehouse, id, sellingv1.OrderStatus_ORDER_STATUS_SHIPPING, "")

	got, err := svc.OrderDetail(context.Background(), connect.NewRequest(&sellingv1.OrderDetailRequest{
		TeamId: 2, OrderId: id,
	}))
	if err != nil {
		t.Fatalf("detail: %v", err)
	}

	if got.Msg.GetOrder().GetStatus() != sellingv1.OrderStatus_ORDER_STATUS_SHIPPING {
		t.Fatalf("status = %v, want SHIPPING", got.Msg.GetOrder().GetStatus())
	}

	want := []sellingv1.OrderEventKind{
		sellingv1.OrderEventKind_ORDER_EVENT_KIND_PENDING,
		sellingv1.OrderEventKind_ORDER_EVENT_KIND_PROCESSED,
		sellingv1.OrderEventKind_ORDER_EVENT_KIND_PICKED,
		sellingv1.OrderEventKind_ORDER_EVENT_KIND_SHIPPING,
	}

	events := got.Msg.GetOrder().GetEvents()
	if len(events) != len(want) {
		t.Fatalf("history has %d rows, want %d", len(events), len(want))
	}

	for i, kind := range want {
		if events[i].GetKind() != kind {
			t.Fatalf("history row %d = %v, want %v", i, events[i].GetKind(), kind)
		}
	}
}

// After the handover the order is customer service's: it follows the parcel on the platform.
func TestOrderStatusChange_CustomerServiceFollowsItOnThePlatform(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	id := processedOrder(t, svc, shop)
	moveOrder(t, svc, testWarehouse, id, sellingv1.OrderStatus_ORDER_STATUS_PICKED, "")
	moveOrder(t, svc, testWarehouse, id, sellingv1.OrderStatus_ORDER_STATUS_SHIPPING, "")

	// The selling team, 2 — not the warehouse.
	moveOrder(t, svc, 2, id, sellingv1.OrderStatus_ORDER_STATUS_SHIPPED, "")
	moveOrder(t, svc, 2, id, sellingv1.OrderStatus_ORDER_STATUS_COMPLETED, "")

	if got := orderStatus(t, svc, id); got != sellingv1.OrderStatus_ORDER_STATUS_COMPLETED {
		t.Fatalf("status = %v, want COMPLETED", got)
	}
}

// Each end makes only its own moves: the selling team cannot confirm for the warehouse, and the
// warehouse cannot say what the platform shows.
func TestOrderStatusChange_EachEndMakesOnlyItsOwnMoves(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := context.Background()
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	created, err := svc.OrderCreate(ctx, connect.NewRequest(orderReq(shop)))
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	id := created.Msg.GetOrder().GetId()

	got := changeStatus(t, svc, 2, sellingv1.OrderStatus_ORDER_STATUS_PROCESSED, "", id)
	if got[0].GetMoved() || !strings.Contains(got[0].GetRefusedReason(), "only the warehouse") {
		t.Fatalf("the selling team confirming = moved %v, %q — want refused, only the warehouse",
			got[0].GetMoved(), got[0].GetRefusedReason())
	}
	if got[0].GetStatus() != sellingv1.OrderStatus_ORDER_STATUS_PENDING {
		t.Fatalf("a refused move reports %v, want the unchanged PENDING", got[0].GetStatus())
	}

	moveOrder(t, svc, testWarehouse, id, sellingv1.OrderStatus_ORDER_STATUS_PROCESSED, "")
	moveOrder(t, svc, testWarehouse, id, sellingv1.OrderStatus_ORDER_STATUS_PICKED, "")
	moveOrder(t, svc, testWarehouse, id, sellingv1.OrderStatus_ORDER_STATUS_SHIPPING, "")

	got = changeStatus(t, svc, testWarehouse, sellingv1.OrderStatus_ORDER_STATUS_SHIPPED, "", id)
	if got[0].GetMoved() || !strings.Contains(got[0].GetRefusedReason(), "only the selling team") {
		t.Fatalf("the warehouse marking shipped = moved %v, %q — want refused, only the selling team",
			got[0].GetMoved(), got[0].GetRefusedReason())
	}
}

// A move back to pending says why, and the why is kept on the history.
func TestOrderStatusChange_AMoveBackNeedsANote(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	id := processedOrder(t, svc, shop)

	got := changeStatus(t, svc, testWarehouse, sellingv1.OrderStatus_ORDER_STATUS_PENDING, "  ", id)
	if got[0].GetMoved() || !strings.Contains(got[0].GetRefusedReason(), "a note is required") {
		t.Fatalf("a move back with a blank note = moved %v, %q — want refused for the note",
			got[0].GetMoved(), got[0].GetRefusedReason())
	}

	moveOrder(t, svc, testWarehouse, id, sellingv1.OrderStatus_ORDER_STATUS_PENDING, "goods on no rack")

	detail, err := svc.OrderDetail(context.Background(), connect.NewRequest(&sellingv1.OrderDetailRequest{
		TeamId: testWarehouse, OrderId: id,
	}))
	if err != nil {
		t.Fatalf("detail: %v", err)
	}

	events := detail.Msg.GetOrder().GetEvents()
	last := events[len(events)-1]

	if last.GetKind() != sellingv1.OrderEventKind_ORDER_EVENT_KIND_PENDING || last.GetNote() != "goods on no rack" {
		t.Fatalf("the last history row = %v %q, want PENDING with its note", last.GetKind(), last.GetNote())
	}
}

// A handover scan of a batch moves what it can and says why not for the rest, in the order sent.
func TestOrderStatusChange_ABatchMovesWhatItCanAndSaysWhyNot(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	first := processedOrder(t, svc, shop)
	notPicked := processedOrder(t, svc, shop)
	last := processedOrder(t, svc, shop)

	moveOrder(t, svc, testWarehouse, first, sellingv1.OrderStatus_ORDER_STATUS_PICKED, "")
	moveOrder(t, svc, testWarehouse, last, sellingv1.OrderStatus_ORDER_STATUS_PICKED, "")

	got := changeStatus(t, svc, testWarehouse, sellingv1.OrderStatus_ORDER_STATUS_SHIPPING, "", first, notPicked, last)

	if len(got) != 3 || got[0].GetOrderId() != first || got[1].GetOrderId() != notPicked || got[2].GetOrderId() != last {
		t.Fatalf("the results are not one per order in the order sent: %v", got)
	}
	if !got[0].GetMoved() || !got[2].GetMoved() {
		t.Fatalf("the two picked orders were not handed over: %v", got)
	}
	if got[1].GetMoved() || got[1].GetRefusedReason() != "processed cannot move to shipping" {
		t.Fatalf("the unpicked order = moved %v, %q — want refused, processed cannot move to shipping",
			got[1].GetMoved(), got[1].GetRefusedReason())
	}

	if s := orderStatus(t, svc, notPicked); s != sellingv1.OrderStatus_ORDER_STATUS_PROCESSED {
		t.Fatalf("the refused order is %v, want it left PROCESSED", s)
	}
}

// Another team's order reads as not ours, so a caller cannot probe for which ids exist.
func TestOrderStatusChange_AnotherTeamsOrderIsNotOurs(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	id := processedOrder(t, svc, shop)

	got := changeStatus(t, svc, 902, sellingv1.OrderStatus_ORDER_STATUS_PICKED, "", id)
	if got[0].GetMoved() || got[0].GetRefusedReason() != "not one of this team's orders" {
		t.Fatalf("a stranger team = moved %v, %q", got[0].GetMoved(), got[0].GetRefusedReason())
	}
	if got[0].GetStatus() != sellingv1.OrderStatus_ORDER_STATUS_UNSPECIFIED {
		t.Fatalf("a stranger team is told the status %v, want UNSPECIFIED", got[0].GetStatus())
	}
}

// Cancel and the return accept do more than move a status, so they are refused here — and moving an
// order to where it already is says so.
func TestOrderStatusChange_RefusesTheMovesWithTheirOwnActions(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	id := processedOrder(t, svc, shop)

	cases := []struct {
		team uint64
		to   sellingv1.OrderStatus
		want string
	}{
		{2, sellingv1.OrderStatus_ORDER_STATUS_CANCEL, "a cancel is its own action"},
		{testWarehouse, sellingv1.OrderStatus_ORDER_STATUS_RETURN_COMPLETED, "the warehouse's accept"},
		{testWarehouse, sellingv1.OrderStatus_ORDER_STATUS_PROCESSED, "already processed"},
	}

	for _, c := range cases {
		got := changeStatus(t, svc, c.team, c.to, "", id)
		if got[0].GetMoved() || !strings.Contains(got[0].GetRefusedReason(), c.want) {
			t.Fatalf("to %v = moved %v, %q — want refused, %q", c.to, got[0].GetMoved(), got[0].GetRefusedReason(), c.want)
		}
	}
}

// A return is claimed by customer service or forced by the warehouse — either end may make it.
func TestOrderStatusChange_EitherEndMayForceAReturn(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	shop := insertShop(t, db, 2, "Toko A", "TOKO-A", "shopee")

	byWarehouse := processedOrder(t, svc, shop)
	bySeller := processedOrder(t, svc, shop)

	for _, id := range []uint64{byWarehouse, bySeller} {
		moveOrder(t, svc, testWarehouse, id, sellingv1.OrderStatus_ORDER_STATUS_PICKED, "")
		moveOrder(t, svc, testWarehouse, id, sellingv1.OrderStatus_ORDER_STATUS_SHIPPING, "")
	}

	moveOrder(t, svc, testWarehouse, byWarehouse, sellingv1.OrderStatus_ORDER_STATUS_RETURN, "")
	moveOrder(t, svc, 2, bySeller, sellingv1.OrderStatus_ORDER_STATUS_RETURN, "")

	// And a return that never arrives goes lost — customer service's call.
	moveOrder(t, svc, 2, bySeller, sellingv1.OrderStatus_ORDER_STATUS_LOST, "")
}
