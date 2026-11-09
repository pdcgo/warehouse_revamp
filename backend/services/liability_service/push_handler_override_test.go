package liability_service_test

import (
	"context"
	"testing"

	"google.golang.org/protobuf/types/known/timestamppb"
	"gorm.io/gorm"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/liability_service"
	"github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_service_models"
	liability_v1 "github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_v1"
)

const (
	sellingTeam  uint64 = 2
	warehouse    uint64 = 900
	productOwner uint64 = 3
)

func ptr(v float64) *float64 { return &v }

func placed(orderID uint64, override bool) *eventsv1.Event {
	return &eventsv1.Event{
		EventId:    "order-placed:test",
		OccurredAt: timestamppb.Now(),
		Message: &eventsv1.Event_OrderPlaced{OrderPlaced: &eventsv1.OrderPlaced{
			TeamId: sellingTeam, WarehouseId: warehouse, OrderId: orderID, WarehouseFee: ptr(12_000),
			Lines:           []*eventsv1.OrderPlacedLine{{OwningTeamId: productOwner, Quantity: 2, Total: 72_000}},
			ActorId:         42,
			ActorIsOverride: override,
		}},
	}
}

func cancelled(orderID uint64, override bool) *eventsv1.Event {
	return &eventsv1.Event{
		EventId:    "order-cancelled:test",
		OccurredAt: timestamppb.Now(),
		Message: &eventsv1.Event_OrderCancelled{OrderCancelled: &eventsv1.OrderCancelled{
			TeamId: sellingTeam, OrderId: orderID, ActorId: 43, ActorIsOverride: override,
		}},
	}
}

func restockAccepted(restockID uint64, override bool) *eventsv1.Event {
	return &eventsv1.Event{
		EventId:    "restock-accepted:test",
		OccurredAt: timestamppb.Now(),
		Message: &eventsv1.Event_RestockAccepted{RestockAccepted: &eventsv1.RestockAccepted{
			RestockId: restockID, TeamId: sellingTeam, WarehouseId: warehouse,
			WarehouseAdditionalCost: 25_000, WarehouseAdditionalCostNote: "courier",
			ActorId: 31, ActorIsOverride: override,
		}},
	}
}

// returnAccepted is the warehouse accepting order orderID's return with a courier charge at the door.
func returnAccepted(orderID uint64, override bool) *eventsv1.Event {
	return &eventsv1.Event{
		EventId:    "order-return-accepted:test",
		OccurredAt: timestamppb.Now(),
		Message: &eventsv1.Event_OrderReturnAccepted{OrderReturnAccepted: &eventsv1.OrderReturnAccepted{
			OrderId: orderID, TeamId: sellingTeam, WarehouseId: warehouse,
			CourierCharge: 15_000, CourierChargeNote: "ongkir retur",
			ActorId: 32, ActorIsOverride: override,
		}},
	}
}

// legFlags is is_override on every leg the event posted for one source — the charges, or their reversals.
func legFlags(t *testing.T, db *gorm.DB, sourceType string, sourceID uint64, reversal bool) []bool {
	t.Helper()

	var rows []liability_service_models.LiabilityLog

	err := db.Where("source_type = ? AND source_id = ? AND reversal = ?", sourceType, sourceID, reversal).
		Order("id").Find(&rows).Error
	if err != nil {
		t.Fatalf("read %s %d legs: %v", sourceType, sourceID, err)
	}

	out := make([]bool, 0, len(rows))
	for _, r := range rows {
		out = append(out, r.IsOverride)
	}

	return out
}

func allAre(flags []bool, want bool) bool {
	for _, f := range flags {
		if f != want {
			return false
		}
	}

	return len(flags) > 0
}

// AN OVERRIDE IS STAMPED DOWNSTREAM OF AN EVENT (an-override-is-stamped-in-every-service): a leg this consumer posts
// names the event's actor, so it carries the event's `actor_is_override` — the order's fees the placement's, their
// reversal the CANCEL's own, each courier charge — a restock's and a return's — its accept's. A push has no caller; the event is the only source.
func TestPushHandler_EachLegCarriesItsEventsStamp(t *testing.T) {
	db := san_testdb.DB(t)
	handle := liability_service.NewLiabilityPushHandler(liability_v1.NewService(db, nil, nil, nil))

	deliver := func(event *eventsv1.Event) {
		t.Helper()

		err := handle(context.Background(), event)
		if err != nil {
			t.Fatalf("deliver %v: %v", event.GetMessage(), err)
		}
	}

	// Order 7001: Root places it from outside, the team's own person cancels it. Order 7002: the other way round.
	deliver(placed(7001, true))
	deliver(cancelled(7001, false))
	deliver(placed(7002, false))
	deliver(cancelled(7002, true))

	// Restock 8001 counted in by Root from outside the warehouse; 8002 by the warehouse's own staff.
	deliver(restockAccepted(8001, true))
	deliver(restockAccepted(8002, false))

	// Order 9001's return accepted by Root from outside the warehouse; 9002's by the warehouse's own staff.
	deliver(returnAccepted(9001, true))
	deliver(returnAccepted(9002, false))

	for _, c := range []struct {
		name       string
		sourceType string
		sourceID   uint64
		reversal   bool
		want       bool
	}{
		{"7001's fees (Root placed)", "order_fee", 7001, false, true},
		{"7001's product fee (Root placed)", "product_fee", 7001, false, true},
		{"7001's reversals (the CS cancelled)", "order_fee", 7001, true, false},
		{"7002's fees (the CS placed)", "order_fee", 7002, false, false},
		{"7002's product fee (the CS placed)", "product_fee", 7002, false, false},
		{"7002's reversals (Root cancelled)", "order_fee", 7002, true, true},
		{"7002's product fee reversal (Root cancelled)", "product_fee", 7002, true, true},
		{"8001's courier charge (Root counted)", "incidental_fee", 8001, false, true},
		{"8002's courier charge (staff counted)", "incidental_fee", 8002, false, false},
		{"9001's return courier charge (Root accepted)", "return_incidental_fee", 9001, false, true},
		{"9002's return courier charge (staff accepted)", "return_incidental_fee", 9002, false, false},
	} {
		got := legFlags(t, db, c.sourceType, c.sourceID, c.reversal)
		if len(got) != 2 || !allAre(got, c.want) {
			t.Errorf("%s: is_override on the legs = %v, want both %v", c.name, got, c.want)
		}
	}
}
