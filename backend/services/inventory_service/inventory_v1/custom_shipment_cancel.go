package inventory_v1

import (
	"context"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_ledgers"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_mutations"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// CustomShipmentCancel is the owning SELLING team calling a parcel off — only while REQUESTED, before the warehouse
// picked it (a-custom-shipment-is-cancelled-only-while-requested, only-the-selling-team-cancels). The warehouse never
// cancels: its call reads NotFound.
//
//   - A SAMPLE's take is undone in the same transaction (RollbackParcelSample — the in-person sample's RollbackTake guard
//     is untouched): every unit back on the batch and the rack it left (a-rollback-reverses-its-log-rows). A rack a stock
//     count holds refuses the whole cancel, naming the count, and the parcel stays requested
//     (a-lock-stops-sales-and-cancels-too).
//   - A RESHIP moved no stock: cancelled, its broken units drop out of the live reships' sum and can go on another one.
//
// Locks, in order: the parcel row, then (a sample) its take's row, the batches and the racks — the transfer cancel's
// order — and the stock reports last. After commit, CustomShipmentCancelled gives a TEAM payer's posted cost back.
func (s *Service) CustomShipmentCancel(
	ctx context.Context,
	req *connect.Request[inventoryv1.CustomShipmentCancelRequest],
) (*connect.Response[inventoryv1.CustomShipmentCancelResponse], error) {
	msg := req.Msg
	actor := actorFrom(ctx)
	override := overrideFrom(ctx)

	var cs *models.CustomShipment

	err := inventory_ledgers.StockTransaction(s.db.WithContext(ctx), func(tx *gorm.DB) error {
		var lockErr error

		cs, lockErr = lockCustomShipment(tx, msg.GetId(), msg.GetTeamId(), customShipmentOwner)
		if lockErr != nil {
			return lockErr
		}

		statusErr := requireCustomShipmentStatus(cs, "cancelled", models.CustomShipmentRequested)
		if statusErr != nil {
			return statusErr
		}

		if cs.Kind == models.CustomShipmentSample {
			_, rollbackErr := inventory_mutations.RollbackParcelSample(tx, cs.ID, actor)
			if rollbackErr != nil {
				return rollbackErr
			}
		}

		return moveCustomShipment(tx, cs, models.CustomShipmentCancelled, actor, override, nil)
	})
	if err != nil {
		return nil, customShipmentMoveErr(err)
	}

	s.publishCustomShipmentEvent(ctx, customShipmentCancelledEvent(cs, override))

	wire, err := customShipmentForWire(s.db.WithContext(ctx), cs.ID, msg.GetTeamId())
	if err != nil {
		return nil, customShipmentMoveErr(err)
	}

	return connect.NewResponse(&inventoryv1.CustomShipmentCancelResponse{CustomShipment: wire}), nil
}
