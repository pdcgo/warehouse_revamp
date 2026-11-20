package inventory_v1

import (
	"context"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// CustomShipmentPicked is the warehouse the parcel ships from saying it has picked and packed it: REQUESTED → PICKED
// (the-selling-team-asks-the-warehouse-ships). From here on the selling team cannot cancel
// (a-custom-shipment-is-cancelled-only-while-requested) — the parcel row's lock makes a cancel and a pick of one parcel
// queue, and exactly one of them wins. Any other team reads NotFound. A sample's units already left stock at create, so
// nothing moves in the ledgers; no event (nothing listens for a pick). The answer is read as the warehouse reads it —
// no seller money.
func (s *Service) CustomShipmentPicked(
	ctx context.Context,
	req *connect.Request[inventoryv1.CustomShipmentPickedRequest],
) (*connect.Response[inventoryv1.CustomShipmentPickedResponse], error) {
	msg := req.Msg
	actor := actorFrom(ctx)
	override := overrideFrom(ctx)

	var cs *models.CustomShipment

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var lockErr error

		cs, lockErr = lockCustomShipment(tx, msg.GetId(), msg.GetTeamId(), customShipmentShipper)
		if lockErr != nil {
			return lockErr
		}

		statusErr := requireCustomShipmentStatus(cs, "picked", models.CustomShipmentRequested)
		if statusErr != nil {
			return statusErr
		}

		return moveCustomShipment(tx, cs, models.CustomShipmentPicked, actor, override, nil)
	})
	if err != nil {
		return nil, customShipmentMoveErr(err)
	}

	wire, err := customShipmentForWire(s.db.WithContext(ctx), cs.ID, msg.GetTeamId())
	if err != nil {
		return nil, customShipmentMoveErr(err)
	}

	return connect.NewResponse(&inventoryv1.CustomShipmentPickedResponse{CustomShipment: wire}), nil
}
