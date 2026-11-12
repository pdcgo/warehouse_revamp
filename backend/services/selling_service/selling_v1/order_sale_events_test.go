package selling_v1_test

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	selling_v1 "github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// THE DAY's SALES AS THE ORDERS ANNOUNCED THEM (OrderSaleEventsOn — the supplier sales re-fold's log): every placement
// and cancel of the day reads back under the id and moment its event was published with, carrying what a sales fold
// reads — the lines, the platform total, the take. Another day holds none of them.
func TestOrderSaleEventsOn_AreTheEventsTheOrdersPublished(t *testing.T) {
	db := san_testdb.DB(t)
	rec := &moveRecorder{}
	svc := newServiceWithEvents(t, db, rec.send)
	shop := insertShop(t, db, 2, "Shop", "S1", "shopee")

	kept := placeOrder(t, svc, 2, shop)
	dropped := placeOrder(t, svc, 2, shop)

	_, err := svc.OrderCancel(context.Background(), connect.NewRequest(&sellingv1.OrderCancelRequest{TeamId: 2, OrderId: dropped}))
	if err != nil {
		t.Fatalf("cancel: %v", err)
	}

	published := map[string]*eventsv1.Event{}
	for _, event := range rec.events {
		published[event.GetEventId()] = event
	}

	day := published["order-placed:"+itoa(kept)].GetOccurredAt().AsTime().In(time.FixedZone("WIB", 7*60*60)).Format("2006-01-02")

	events, err := selling_v1.OrderSaleEventsOn(db, day)
	if err != nil {
		t.Fatalf("OrderSaleEventsOn: %v", err)
	}

	read := map[string]*eventsv1.Event{}
	for _, event := range events {
		read[event.GetEventId()] = event
	}

	for _, id := range []string{"order-placed:" + itoa(kept), "order-placed:" + itoa(dropped), "order-cancelled:" + itoa(dropped)} {
		got, want := read[id], published[id]
		if got == nil || want == nil {
			t.Fatalf("%s: read %v, published %v — want both", id, got, want)
		}

		// The stored instant is Postgres's microsecond, the published one Go's nanosecond — the same moment.
		if gap := got.GetOccurredAt().AsTime().Sub(want.GetOccurredAt().AsTime()).Abs(); gap > time.Microsecond {
			t.Fatalf("%s: occurred_at %v, published %v", id, got.GetOccurredAt().AsTime(), want.GetOccurredAt().AsTime())
		}

		if cancel := got.GetOrderCancelled(); cancel != nil {
			if cancel.GetOrderId() != dropped || cancel.GetTeamId() != 2 || cancel.GetIdempotencyKey() != want.GetOrderCancelled().GetIdempotencyKey() {
				t.Fatalf("%s = %v, published %v", id, cancel, want.GetOrderCancelled())
			}

			continue
		}

		placed, sent := got.GetOrderPlaced(), want.GetOrderPlaced()
		if placed.GetOrderId() != sent.GetOrderId() || placed.GetTeamId() != sent.GetTeamId() ||
			placed.GetPlatformTotal() != sent.GetPlatformTotal() || placed.GetTransactionId() != sent.GetTransactionId() ||
			len(placed.GetLines()) != len(sent.GetLines()) {
			t.Fatalf("%s = %v\npublished %v", id, placed, sent)
		}

		for i, line := range placed.GetLines() {
			s := sent.GetLines()[i]
			if line.GetProductId() != s.GetProductId() || line.GetQuantity() != s.GetQuantity() || line.GetTotal() != s.GetTotal() {
				t.Fatalf("%s line %d = %v, published %v", id, i, line, s)
			}
		}
	}

	other, err := selling_v1.OrderSaleEventsOn(db, "2026-01-01")
	if err != nil || len(other) != 0 {
		t.Fatalf("another day = %v (err %v), want nothing", other, err)
	}

	_, err = selling_v1.OrderSaleEventsOn(db, "yesterday")
	if err == nil {
		t.Fatal("a day that is not one was read")
	}
}
