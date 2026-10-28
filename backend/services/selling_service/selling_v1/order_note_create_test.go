package selling_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_auth"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// A NOTE IS A TIMELINE ROW (a-note-is-a-timeline-row): no status, the trimmed text, the side the scope says, the caller
// as its actor — written by either end of the order, refused to everybody else as NotFound.

func writeNote(
	t *testing.T,
	svc *selling_v1.Service,
	ctx context.Context,
	teamID, orderID uint64,
	note string,
) (*sellingv1.OrderTimelineLog, error) {
	t.Helper()

	resp, err := svc.OrderNoteCreate(ctx, connect.NewRequest(&sellingv1.OrderNoteCreateRequest{
		TeamId: teamID, OrderId: orderID, Note: note,
	}))
	if err != nil {
		return nil, err
	}

	return resp.Msg.GetLog(), nil
}

// The selling team writes from selling, by the person asking, trimmed — and the row is on the order's timeline with no
// status, after the placement.
func TestOrderNoteCreate_SellingWritesFromSelling(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	seller := asUser(7)

	shopID := insertShop(t, db, 2, "Shop", "S1", "shopee")
	orderID := placeOrderAs(t, svc, seller, 2, shopID)

	log, err := writeNote(t, svc, seller, 2, orderID, "  buyer asks: wrap the glass one \n")
	if err != nil {
		t.Fatalf("OrderNoteCreate from selling: %v", err)
	}

	if log.GetId() == 0 || log.GetCreatedAtUnix() == 0 {
		t.Fatalf("the written row has no id or no time: %+v", log)
	}

	if log.GetStatus() != sellingv1.OrderStatus_ORDER_STATUS_UNSPECIFIED || log.GetNote() != "buyer asks: wrap the glass one" {
		t.Fatalf("the note = %v %q, want no status and the trimmed text", log.GetStatus(), log.GetNote())
	}

	if log.GetFrom() != sellingv1.OrderTimelineFrom_ORDER_TIMELINE_FROM_SELLING || log.GetActorId() != 7 {
		t.Fatalf("the note from %v by %d, want SELLING by 7", log.GetFrom(), log.GetActorId())
	}

	// On the detail: the placement, then the note — the same row the write answered.
	rows := timeline(t, svc, seller, 2, orderID)
	if len(rows) != 2 {
		t.Fatalf("%d timeline rows, want 2 (placed, the note): %+v", len(rows), rows)
	}

	got := rows[1]
	if got.GetId() != log.GetId() || got.GetStatus() != sellingv1.OrderStatus_ORDER_STATUS_UNSPECIFIED ||
		got.GetNote() != log.GetNote() || got.GetFrom() != log.GetFrom() || got.GetActorId() != 7 {
		t.Fatalf("the detail's note row = %+v, want the written one %+v", got, log)
	}

	// A note moves nothing: the order is still where it was.
	detail, err := svc.OrderDetail(seller, connect.NewRequest(&sellingv1.OrderDetailRequest{TeamId: 2, OrderId: orderID}))
	if err != nil {
		t.Fatalf("OrderDetail: %v", err)
	}

	if detail.Msg.GetOrder().GetStatus() != sellingv1.OrderStatus_ORDER_STATUS_PENDING {
		t.Fatalf("after a note the order is %v, want still PENDING", detail.Msg.GetOrder().GetStatus())
	}
}

// The order's warehouse writes from warehouse — the crew's "no goods on Rak A".
func TestOrderNoteCreate_WarehouseWritesFromWarehouse(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	crew := asUser(9)

	shopID := insertShop(t, db, 2, "Shop", "S1", "shopee")
	orderID := placeOrderAs(t, svc, asUser(7), 2, shopID)

	log, err := writeNote(t, svc, crew, testWarehouse, orderID, "no goods on Rak A")
	if err != nil {
		t.Fatalf("OrderNoteCreate from the warehouse: %v", err)
	}

	if log.GetFrom() != sellingv1.OrderTimelineFrom_ORDER_TIMELINE_FROM_WAREHOUSE || log.GetActorId() != 9 {
		t.Fatalf("the note from %v by %d, want WAREHOUSE by 9", log.GetFrom(), log.GetActorId())
	}

	// The selling team reads the warehouse's note on its own detail.
	rows := timeline(t, svc, asUser(7), 2, orderID)
	if len(rows) != 2 || rows[1].GetNote() != "no goods on Rak A" ||
		rows[1].GetStatus() != sellingv1.OrderStatus_ORDER_STATUS_UNSPECIFIED {
		t.Fatalf("the seller's timeline = %+v, want the placement then the warehouse's note", rows)
	}
}

// A team that is BOTH ends — its own warehouse — writes from selling.
func TestOrderNoteCreate_BothEndsWritesFromSelling(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	ctx := asUser(7)

	shopID := insertShop(t, db, 2, "Shop", "S1", "shopee")

	created, err := svc.OrderCreate(ctx, connect.NewRequest(&sellingv1.OrderCreateRequest{
		PlatformCreatedAtUnix: testPlatformDate,
		PlatformTotal:         testPlatformTotal,
		TeamId:                2, ShopId: shopID, WarehouseId: 2,
		CustomerName: "Budi",
		Items: []*sellingv1.OrderItem{
			{ProductId: 1, Sku: "SKU1", Name: "Widget", Quantity: 1},
		},
	}))
	if err != nil {
		t.Fatalf("OrderCreate shipping from itself: %v", err)
	}

	log, err := writeNote(t, svc, ctx, 2, created.Msg.GetOrder().GetId(), "packed by the owner")
	if err != nil {
		t.Fatalf("OrderNoteCreate: %v", err)
	}

	if log.GetFrom() != sellingv1.OrderTimelineFrom_ORDER_TIMELINE_FROM_SELLING {
		t.Fatalf("a team that is both ends wrote from %v, want SELLING", log.GetFrom())
	}
}

// Any other team — and the root team, which is neither end — reads NotFound, as an order that does not exist, and
// nothing is written.
func TestOrderNoteCreate_AnotherTeamIsNotFound(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	seller := asUser(7)

	shopID := insertShop(t, db, 2, "Shop", "S1", "shopee")
	orderID := placeOrderAs(t, svc, seller, 2, shopID)

	cases := []struct {
		name    string
		teamID  uint64
		orderID uint64
	}{
		{"another selling team", 3, orderID},
		{"another warehouse", testWarehouse + 1, orderID},
		{"the root team", san_auth.RootTeamID, orderID},
		{"an order that does not exist", 2, orderID + 1_000},
	}

	for _, c := range cases {
		_, err := writeNote(t, svc, seller, c.teamID, c.orderID, "not mine to write")
		if connect.CodeOf(err) != connect.CodeNotFound {
			t.Fatalf("%s: err = %v, want NotFound", c.name, err)
		}
	}

	rows := timeline(t, svc, seller, 2, orderID)
	if len(rows) != 1 {
		t.Fatalf("a refused note left %d timeline rows, want only the placement: %+v", len(rows), rows)
	}
}

// A note of spaces alone passes the proto's min_len and is refused here, writing nothing.
func TestOrderNoteCreate_BlankIsInvalid(t *testing.T) {
	db := san_testdb.DB(t)
	svc := newService(t, db)
	seller := asUser(7)

	shopID := insertShop(t, db, 2, "Shop", "S1", "shopee")
	orderID := placeOrderAs(t, svc, seller, 2, shopID)

	_, err := writeNote(t, svc, seller, 2, orderID, " \n\t ")
	if connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Fatalf("a blank note: err = %v, want InvalidArgument", err)
	}

	rows := timeline(t, svc, seller, 2, orderID)
	if len(rows) != 1 {
		t.Fatalf("a refused note left %d timeline rows, want only the placement: %+v", len(rows), rows)
	}
}
