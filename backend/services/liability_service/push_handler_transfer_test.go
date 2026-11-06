package liability_service_test

import (
	"context"
	"testing"

	"google.golang.org/protobuf/types/known/timestamppb"

	eventsv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/events/v1"
	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_testdb"
	"github.com/pdcgo/warehouse_revamp/backend/services/liability_service"
	"github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_service_models"
	liability_v1 "github.com/pdcgo/warehouse_revamp/backend/services/liability_service/liability_v1"
)

// The sending warehouse A — never the creditor: the courier was paid at B's door.
const sendingWarehouse uint64 = 901

// transferAccepted is B counting transfer transferID in, with `charge` paid to the courier at its door.
func transferAccepted(transferID uint64, charge float64) *eventsv1.Event {
	return &eventsv1.Event{
		EventId:    "warehouse-transfer-accepted:test",
		OccurredAt: timestamppb.Now(),
		Message: &eventsv1.Event_WarehouseTransferAccepted{WarehouseTransferAccepted: &eventsv1.WarehouseTransferAccepted{
			TransferId: transferID, TeamId: sellingTeam, FromWarehouseId: sendingWarehouse, ToWarehouseId: warehouse,
			WarehouseAdditionalCost: charge, WarehouseAdditionalCostNote: "ongkir bongkar",
			ActorId: 34,
		}},
	}
}

// balance-posts-the-transfers-on-site-debt-from-the-event: the push handler routes Warehouse Transfer Accepted to a
// `transfer_fee` keyed by the transfer — the selling team owes B (to_warehouse_id), never A — posted EXACT
// (the-backend-never-rounds-money), and a redelivery posts nothing new.
func TestPushHandler_ATransferAcceptPostsATransferFeeOwedToTheReceiver(t *testing.T) {
	db := san_testdb.DB(t)
	handle := liability_service.NewLiabilityPushHandler(liability_v1.NewService(db, nil, nil, nil))

	for range 2 {
		err := handle(context.Background(), transferAccepted(6101, 5_000.4))
		if err != nil {
			t.Fatalf("deliver: %v", err)
		}
	}

	var legs []liability_service_models.LiabilityLog

	err := db.Where("source_id = ?", 6101).Order("id").Find(&legs).Error
	if err != nil {
		t.Fatalf("read legs: %v", err)
	}

	if len(legs) != 2 {
		t.Fatalf("%d legs, want one posting (2 legs)", len(legs))
	}

	for _, leg := range legs {
		if leg.SourceType != "transfer_fee" || leg.ActorID != 34 {
			t.Fatalf("leg %+v, want a transfer_fee by 34", leg)
		}

		switch leg.TeamID {
		case warehouse:
			if leg.Amount != 5_000.4 || leg.CounterpartyID != sellingTeam {
				t.Fatalf("receiver's leg %+v, want +5.000,4 owed by the selling team", leg)
			}
		case sellingTeam:
			if leg.Amount != -5_000.4 || leg.CounterpartyID != warehouse {
				t.Fatalf("selling team's leg %+v, want −5.000,4 owed to the receiving warehouse", leg)
			}
		default:
			t.Fatalf("leg in team %d's books — only the selling team and the RECEIVING warehouse take part", leg.TeamID)
		}
	}
}

// An accept with no courier charge — published after every accept — posts nothing and is ACKED.
func TestPushHandler_ATransferAcceptWithNoChargePostsNothing(t *testing.T) {
	db := san_testdb.DB(t)
	handle := liability_service.NewLiabilityPushHandler(liability_v1.NewService(db, nil, nil, nil))

	err := handle(context.Background(), transferAccepted(6102, 0))
	if err != nil {
		t.Fatalf("deliver: %v", err)
	}

	var count int64

	err = db.Model(&liability_service_models.LiabilityLog{}).Where("source_id = ?", 6102).Count(&count).Error
	if err != nil {
		t.Fatalf("count: %v", err)
	}

	if count != 0 {
		t.Fatalf("%d legs for a transfer with no charge, want 0", count)
	}
}
