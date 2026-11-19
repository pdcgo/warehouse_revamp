package selling_v1_test

import (
	"context"
	"testing"

	"connectrpc.com/connect"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// A LOST ORDER'S PARCEL, FOUND (a-found-lost-parcel-is-a-found-stock-in) — the order side of inventory's found report:
// the order it names, read by id, and the note naming the request on its timeline. The order STAYS LOST.
func TestFoundOrder_ReadsTheOrderAndNotesTheFoundWhileItStaysLost(t *testing.T) {
	const (
		team      uint64 = 9_100_101
		warehouse uint64 = 9_100_102
		take      uint64 = 8_101
	)

	db := san_testdb.DB(t)
	svc := newService(t, db)
	shop := insertShop(t, db, team, "Toko Hilang", "HLG", "shopee")

	takeID := take
	order := selling_service_models.Order{
		IdempotencyKey: newOrderKey(),
		TeamID:         team, ShopID: shop, WarehouseID: warehouse, Status: "lost", TransactionID: &takeID,
		Address: &selling_service_models.OrderAddress{CustomerName: "Budi"},
	}

	err := db.Create(&order).Error
	if err != nil {
		t.Fatalf("insert order: %v", err)
	}

	got, ok, err := selling_v1.FoundOrderOf(context.Background(), db, order.ID)
	if err != nil || !ok {
		t.Fatalf("FoundOrderOf: %v %v", ok, err)
	}

	if got.ID != order.ID || got.TeamID != team || got.WarehouseID != warehouse || !got.Lost() || got.TakeTransactionID != take {
		t.Fatalf("read %+v, want order %d of team %d from warehouse %d, lost, take %d", got, order.ID, team, warehouse, take)
	}

	_, ok, err = selling_v1.FoundOrderOf(context.Background(), db, order.ID+1_000_000)
	if err != nil || ok {
		t.Fatalf("an order that does not exist: ok %v err %v — want absent", ok, err)
	}

	err = selling_v1.RecordFoundNote(context.Background(), db, selling_v1.FoundNote{
		OrderID: order.ID, FoundRequestID: 12, Count: 2, ProductCode: "SBN-01", ProductName: "Sabun Mandi", RackCode: "a-3",
		ActorID: 41,
	})
	if err != nil {
		t.Fatalf("RecordFoundNote: %v", err)
	}

	logs := timeline(t, svc, asUser(41), team, order.ID)
	if len(logs) != 1 {
		t.Fatalf("%d timeline rows, want the one note", len(logs))
	}

	note := logs[0]
	want := "Found at the warehouse: 2 × SBN-01 Sabun Mandi on rack a-3 — found request #12. The order stays lost."

	if note.GetStatus() != sellingv1.OrderStatus_ORDER_STATUS_UNSPECIFIED || note.GetNote() != want ||
		note.GetFrom() != sellingv1.OrderTimelineFrom_ORDER_TIMELINE_FROM_WAREHOUSE || note.GetActorId() != 41 {
		t.Fatalf("the note = %+v, want a warehouse note by 41 reading %q", note, want)
	}

	// THE ORDER STAYS LOST — the note moved nothing.
	detail, err := svc.OrderDetail(asUser(41), connect.NewRequest(&sellingv1.OrderDetailRequest{TeamId: team, OrderId: order.ID}))
	if err != nil {
		t.Fatalf("OrderDetail: %v", err)
	}

	if detail.Msg.GetOrder().GetStatus() != sellingv1.OrderStatus_ORDER_STATUS_LOST {
		t.Fatalf("the order is %v after the found note, want LOST", detail.Msg.GetOrder().GetStatus())
	}

	err = selling_v1.RecordFoundNote(context.Background(), db, selling_v1.FoundNote{FoundRequestID: 12})
	if err == nil {
		t.Fatal("a note naming no order was written")
	}
}
