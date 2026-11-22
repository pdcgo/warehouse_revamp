package inventory_v1

import (
	"context"
	"strings"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// CustomShipmentMarkLost is the owning SELLING team giving an INBOUND parcel up while it is on its way
// (lost-is-set-only-before-the-box-arrives, applied alike — a-suppliers-reshipping-comes-in-as-a-custom-shipment, 🔄 A).
// Nothing moves: no stock, no money — the parcel's trail keeps the reason. A lost parcel that turns up is signed for
// (CustomShipmentArrive, a-late-lost-box-is-signed-for-as-arrived).
func (s *Service) CustomShipmentMarkLost(
	ctx context.Context,
	req *connect.Request[inventoryv1.CustomShipmentMarkLostRequest],
) (*connect.Response[inventoryv1.CustomShipmentMarkLostResponse], error) {
	msg := req.Msg
	reason := strings.TrimSpace(msg.GetReason())

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		cs, lockErr := lockInboundParcel(tx, msg.GetId(), msg.GetTeamId(), customShipmentOwner)
		if lockErr != nil {
			return lockErr
		}

		statusErr := requireCustomShipmentStatus(cs, "marked lost", models.CustomShipmentOnTheWay)
		if statusErr != nil {
			return statusErr
		}

		return moveInbound(tx, cs, models.CustomShipmentLost, actorFrom(ctx), overrideFrom(ctx),
			map[string]any{"lost_reason": reason}, reason)
	})
	if err != nil {
		return nil, inboundErr(err)
	}

	wire, err := customShipmentForWire(s.db.WithContext(ctx), msg.GetId(), msg.GetTeamId())
	if err != nil {
		return nil, inboundErr(err)
	}

	return connect.NewResponse(&inventoryv1.CustomShipmentMarkLostResponse{CustomShipment: wire}), nil
}
