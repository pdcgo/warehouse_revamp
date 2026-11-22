package inventory_v1

import (
	"context"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// CustomShipmentArrive is Tiba: the warehouse an INBOUND parcel comes to signs for it — on its way, or a lost one that
// turned up (a-late-lost-box-is-signed-for-as-arrived) — as a restock box (a-suppliers-reshipping-comes-in-as-a-custom-
// shipment, 🔄 A). The courier's charge at the door may be noted (a note above 0), KEPT on the parcel and shown to both
// sides; Terima opens with it and its figure is final, replacing this one (the-courier-charge-is-noted-at-tiba-and-
// final-at-terima). NO money moves here: nothing is published, the debt is posted only from Terima's event. The owning
// team and any other warehouse read NotFound.
func (s *Service) CustomShipmentArrive(
	ctx context.Context,
	req *connect.Request[inventoryv1.CustomShipmentArriveRequest],
) (*connect.Response[inventoryv1.CustomShipmentArriveResponse], error) {
	msg := req.Msg

	charge, note, err := doorCharge(msg.GetDoorCharge(), msg.GetDoorChargeNote())
	if err != nil {
		return nil, inboundErr(err)
	}

	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		cs, lockErr := lockInboundParcel(tx, msg.GetId(), msg.GetTeamId(), customShipmentShipper)
		if lockErr != nil {
			return lockErr
		}

		statusErr := requireCustomShipmentStatus(cs, "signed for", models.CustomShipmentOnTheWay,
			models.CustomShipmentLost)
		if statusErr != nil {
			return statusErr
		}

		return moveInbound(tx, cs, models.CustomShipmentArrived, actorFrom(ctx), overrideFrom(ctx),
			map[string]any{"shipping_cost": charge, "charge_note": note}, doorChargeText(charge, note))
	})
	if err != nil {
		return nil, inboundErr(err)
	}

	wire, err := customShipmentForWire(s.db.WithContext(ctx), msg.GetId(), msg.GetTeamId())
	if err != nil {
		return nil, inboundErr(err)
	}

	return connect.NewResponse(&inventoryv1.CustomShipmentArriveResponse{CustomShipment: wire}), nil
}
