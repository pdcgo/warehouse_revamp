package liability_service_test

import (
	"context"
	"net/http"
	"testing"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/types/known/timestamppb"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/liability_service"
	"github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_service_models"
	liability_v1 "github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_v1"
)

// customShipmentReceived is warehouse `warehouse` counting in INBOUND parcel parcelID (a supplier's reshipping), the
// courier's charge at the door final at `charge`.
func customShipmentReceived(parcelID uint64, charge float64) *eventsv1.Event {
	return &eventsv1.Event{
		EventId:    "custom-shipment-received:test",
		OccurredAt: timestamppb.Now(),
		Message: &eventsv1.Event_CustomShipmentReceived{CustomShipmentReceived: &eventsv1.CustomShipmentReceived{
			CustomShipmentId: parcelID, TeamId: sellingTeam, WarehouseId: warehouse, RestockId: 77, ResolutionId: 5,
			DoorCharge: charge, ActorId: 36, ReceivedAtUnix: timestamppb.Now().GetSeconds(),
		}},
	}
}

// AN INBOUND PARCEL'S DOOR CHARGE (backlog #101 — a-suppliers-reshipping-comes-in-as-a-custom-shipment, 🔄 A: the
// restock's door charge, the-courier-charge-is-noted-at-tiba-and-final-at-terima): its Terima's final charge is a
// `custom_shipment_fee` keyed by the parcel — the selling team owes the warehouse it came to — EXACT, once for two
// deliveries; 0 posts nothing. Through the REAL mux, as the emulator calls it: the route is mounted.
func TestRegister_AnInboundParcelsDoorChargeReachesTheLedger(t *testing.T) {
	db := san_testdb.DB(t)
	mux := http.NewServeMux()
	liability_service.NewRegister(mux, liability_v1.NewService(db, nil, nil, nil), connect.WithInterceptors())()

	for range 2 {
		deliver(t, mux, liability_service.CustomShipmentReceivedSubscription, customShipmentReceived(8821, 7_500.5))
	}

	var legs []liability_service_models.LiabilityLog

	err := db.Where("source_type = ? AND source_id = ?", "custom_shipment_fee", 8821).
		Order("id").
		Find(&legs).
		Error
	if err != nil {
		t.Fatalf("read legs: %v", err)
	}

	if len(legs) != 2 {
		t.Fatalf("%d legs, want one posting (2 legs)", len(legs))
	}

	for _, leg := range legs {
		switch leg.TeamID {
		case warehouse:
			if leg.Amount != 7_500.5 || leg.CounterpartyID != sellingTeam || leg.ActorID != 36 {
				t.Fatalf("warehouse's leg %+v, want +7.500,5 owed by the selling team", leg)
			}
		case sellingTeam:
			if leg.Amount != -7_500.5 || leg.CounterpartyID != warehouse {
				t.Fatalf("selling team's leg %+v, want −7.500,5 owed to the warehouse it came to", leg)
			}
		default:
			t.Fatalf("a leg for team %d", leg.TeamID)
		}
	}

	handle := liability_service.NewLiabilityPushHandler(liability_v1.NewService(db, nil, nil, nil))

	err = handle(context.Background(), customShipmentReceived(8822, 0))
	if err != nil {
		t.Fatalf("deliver a 0 charge: %v", err)
	}

	var n int64

	err = db.Model(&liability_service_models.LiabilityLog{}).
		Where("source_id = ?", 8822).
		Count(&n).
		Error
	if err != nil {
		t.Fatalf("count: %v", err)
	}

	if n != 0 {
		t.Fatalf("a 0 door charge posted %d legs", n)
	}
}
