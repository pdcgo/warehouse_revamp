package settlement_v1_test

import (
	"context"
	"testing"
	"time"

	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_service_models"
	settlement_v1 "github.com/pdcgo/warehouse_revamp/backend/services/settlement_service/settlement_v1"
)

// settlement-opens-the-sale-from-the-order-event — the order's account is opened and cancelled from the
// order's own events, and a redelivery (Pub/Sub delivers at least once) posts nothing twice.

// The order's moment, 10:00 in Jakarta on the 29th — the day its rows count on.
var placedAt = time.Date(2026, 8, 29, 10, 0, 0, 0, time.FixedZone("WIB", 7*60*60))

func placedEvent(total int64) *eventsv1.Event {
	return &eventsv1.Event{
		EventId:    "order-placed:5001",
		OccurredAt: timestamppb.New(placedAt),
		Message: &eventsv1.Event_OrderPlaced{OrderPlaced: &eventsv1.OrderPlaced{
			TeamId: team, ShopId: shop, OrderId: order, MarketplaceTotal: total, ActorId: 42,
		}},
	}
}

func cancelledEvent(at time.Time) *eventsv1.Event {
	return &eventsv1.Event{
		EventId:    "order-cancelled:5001",
		OccurredAt: timestamppb.New(at),
		Message: &eventsv1.Event_OrderCancelled{OrderCancelled: &eventsv1.OrderCancelled{
			TeamId: team, ShopId: shop, OrderId: order, ActorId: 43,
		}},
	}
}

func orderRows(t *testing.T, db *gorm.DB, settlementType string) []settlement_service_models.SettlementLog {
	t.Helper()

	var rows []settlement_service_models.SettlementLog

	err := db.Where("order_id = ? AND settlement_type = ?", order, settlementType).Find(&rows).Error
	if err != nil {
		t.Fatalf("read rows: %v", err)
	}

	return rows
}

func deliver(t *testing.T, svc *settlement_v1.Service, event *eventsv1.Event) {
	t.Helper()

	err := svc.OrderSaleHandler()(context.Background(), event)
	if err != nil {
		t.Fatalf("delivering %s: %v", event.GetEventId(), err)
	}
}

// The placement opens the account — the platform total with the sign flipped, on the order's own day,
// by the person who placed it — and a second delivery of the same event writes nothing.
func TestOrderSale_ThePlacementOpensTheAccountOnce(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, nil)

	deliver(t, svc, placedEvent(sale))
	deliver(t, svc, placedEvent(sale)) // Pub/Sub delivers at least once

	rows := orderRows(t, db, "initial_total")
	if len(rows) != 1 {
		t.Fatalf("%d initial_total rows, want exactly 1 after two deliveries", len(rows))
	}

	got := rows[0]
	if got.Change != -sale || got.ShopID != shop || got.TeamID != team || got.ActorID != 42 ||
		got.UniqueID != "order-placed:5001" || got.OccurredOn.Format(time.DateOnly) != "2026-08-29" {
		t.Fatalf("unexpected opening row: %+v", got)
	}
}

// 0 means NOT RECORDED — an account opened at 0 is one nothing can compute against, so nothing opens,
// and the event is still ACKed.
func TestOrderSale_NoPlatformTotalOpensNothing(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, nil)

	deliver(t, svc, placedEvent(0))

	if rows := orderRows(t, db, "initial_total"); len(rows) != 0 {
		t.Fatalf("%d rows opened for an order with no platform total, want 0", len(rows))
	}
}

// The cancel posts the opposite row once, keyed by the order and the cancel's own day — so a
// redelivery, even one arriving after midnight, finds its row instead of crediting the account twice.
func TestOrderSale_TheCancelCancelsTheSaleOnce(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, nil)

	deliver(t, svc, placedEvent(sale))

	cancelledAt := placedAt.Add(2 * time.Hour)
	deliver(t, svc, cancelledEvent(cancelledAt))
	deliver(t, svc, cancelledEvent(cancelledAt))

	rows := orderRows(t, db, "initial_total_cancel")
	if len(rows) != 1 {
		t.Fatalf("%d initial_total_cancel rows, want exactly 1 after two deliveries", len(rows))
	}

	if rows[0].Change != sale || rows[0].ActorID != 43 || rows[0].OccurredOn.Format(time.DateOnly) != "2026-08-29" {
		t.Fatalf("unexpected cancel row: %+v", rows[0])
	}
}

// NOTHING TO CANCEL IS A NORMAL ANSWER — an order that never opened an account still cancels, and its
// event is ACKed rather than redelivered forever.
func TestOrderSale_ACancelWithNothingToCancelIsAcked(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, nil)

	deliver(t, svc, cancelledEvent(placedAt))

	if rows := orderRows(t, db, "initial_total_cancel"); len(rows) != 0 {
		t.Fatalf("%d cancel rows for an order with no account, want 0", len(rows))
	}
}

// A variant this handler does not consume is ACKed: redelivering it would be a loop, not a retry.
func TestOrderSale_AnotherVariantIsAcked(t *testing.T) {
	db := san_testdb.DB(t)
	svc := settlement_v1.NewService(db, nil, nil, nil)

	deliver(t, svc, &eventsv1.Event{
		EventId:    "member-removed:1",
		OccurredAt: timestamppb.New(placedAt),
		Message:    &eventsv1.Event_MemberRemoved{MemberRemoved: &eventsv1.MemberRemoved{}},
	})
}
