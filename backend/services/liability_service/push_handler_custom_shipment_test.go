package liability_service_test

import (
	"context"
	"testing"

	"google.golang.org/protobuf/types/known/timestamppb"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/liability_service"
	"github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_service_models"
	liability_v1 "github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_v1"
)

// customShipmentHandedOver is warehouse `warehouse` handing parcel parcelID to the courier, paid by `payer`, with
// `cost` typed as what the warehouse paid on the spot.
func customShipmentHandedOver(
	parcelID uint64,
	payer inventoryv1.CustomShipmentPayer,
	cost float64,
	override bool,
) *eventsv1.Event {
	return &eventsv1.Event{
		EventId:    "custom-shipment-handed-over:test",
		OccurredAt: timestamppb.Now(),
		Message: &eventsv1.Event_CustomShipmentHandedOver{CustomShipmentHandedOver: &eventsv1.CustomShipmentHandedOver{
			CustomShipmentId: parcelID, TeamId: sellingTeam, WarehouseId: warehouse,
			Kind: inventoryv1.CustomShipmentKind_CUSTOM_SHIPMENT_KIND_SAMPLE, Payer: payer,
			WarehouseCost: cost, ActorId: 36, ActorIsOverride: override,
			HandedOverAtUnix: timestamppb.Now().GetSeconds(),
		}},
	}
}

// the-courier-is-paid-by-the-team-or-by-the-warehouse, *Gudang bayar*: the push handler routes Custom Shipment Handed
// Over to a `custom_shipment_fee` keyed by the parcel — the selling team owes the warehouse it shipped from — posted
// EXACT (the-backend-never-rounds-money), the override stamped, and the same event twice is one posting.
func TestPushHandler_AWarehousePaidHandoverPostsACustomShipmentFee(t *testing.T) {
	db := san_testdb.DB(t)
	handle := liability_service.NewLiabilityPushHandler(liability_v1.NewService(db, nil, nil, nil))

	for range 2 {
		err := handle(context.Background(),
			customShipmentHandedOver(8801, inventoryv1.CustomShipmentPayer_CUSTOM_SHIPMENT_PAYER_WAREHOUSE, 9_000.25, true))
		if err != nil {
			t.Fatalf("deliver: %v", err)
		}
	}

	var legs []liability_service_models.LiabilityLog

	err := db.Where("source_id = ?", 8801).
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
		if leg.SourceType != "custom_shipment_fee" || leg.ActorID != 36 || !leg.IsOverride {
			t.Fatalf("leg %+v, want a custom_shipment_fee by 36, stamped as an override", leg)
		}

		switch leg.TeamID {
		case warehouse:
			if leg.Amount != 9_000.25 || leg.CounterpartyID != sellingTeam {
				t.Fatalf("warehouse's leg %+v, want +9.000,25 owed by the selling team", leg)
			}
		case sellingTeam:
			if leg.Amount != -9_000.25 || leg.CounterpartyID != warehouse {
				t.Fatalf("selling team's leg %+v, want −9.000,25 owed to the warehouse that shipped", leg)
			}
		default:
			t.Fatalf("leg in team %d's books — only the selling team and the shipping warehouse take part", leg.TeamID)
		}
	}
}

// ⚠ A WAREHOUSE NEVER SEES THE TEAM'S MONEY (the-custom-shipments-prototype-is-accepted: *nor in the data it
// receives*). A *Kami bayar* parcel's courier is an expense on the team's own account: its handover posts NOTHING on
// Team Balance — not even when the event carries a cost (inventory sends 0; the handler does not trust it), so the
// team's figure never lands in the warehouse's books. An unknown payer is not a debt either. Each is ACKED.
func TestPushHandler_ATeamPaidHandoverPostsNothingInTheWarehousesBooks(t *testing.T) {
	db := san_testdb.DB(t)
	handle := liability_service.NewLiabilityPushHandler(liability_v1.NewService(db, nil, nil, nil))

	for i, payer := range []inventoryv1.CustomShipmentPayer{
		inventoryv1.CustomShipmentPayer_CUSTOM_SHIPMENT_PAYER_TEAM,
		inventoryv1.CustomShipmentPayer_CUSTOM_SHIPMENT_PAYER_UNSPECIFIED,
	} {
		err := handle(context.Background(), customShipmentHandedOver(8802+uint64(i), payer, 18_000, false))
		if err != nil {
			t.Fatalf("deliver %v: %v — a team payer's handover is ACKED", payer, err)
		}
	}

	var count int64

	err := db.Model(&liability_service_models.LiabilityLog{}).
		Where("team_id = ? OR counterparty_id = ?", warehouse, warehouse).
		Count(&count).
		Error
	if err != nil {
		t.Fatalf("count: %v", err)
	}

	if count != 0 {
		t.Fatalf("%d legs in or against the warehouse's books for a team-paid parcel, want 0", count)
	}
}

// A handover the warehouse paid nothing for (0 is allowed) posts nothing and is ACKED.
func TestPushHandler_AWarehousePaidHandoverOfZeroPostsNothing(t *testing.T) {
	db := san_testdb.DB(t)
	handle := liability_service.NewLiabilityPushHandler(liability_v1.NewService(db, nil, nil, nil))

	err := handle(context.Background(),
		customShipmentHandedOver(8804, inventoryv1.CustomShipmentPayer_CUSTOM_SHIPMENT_PAYER_WAREHOUSE, 0, false))
	if err != nil {
		t.Fatalf("deliver: %v", err)
	}

	var count int64

	err = db.Model(&liability_service_models.LiabilityLog{}).
		Where("source_id = ?", 8804).
		Count(&count).
		Error
	if err != nil {
		t.Fatalf("count: %v", err)
	}

	if count != 0 {
		t.Fatalf("%d legs for a handover with no courier cost, want 0", count)
	}
}
