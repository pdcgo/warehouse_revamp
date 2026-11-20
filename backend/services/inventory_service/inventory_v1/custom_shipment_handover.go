package inventory_v1

import (
	"context"
	"strings"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// CustomShipmentHandover is the warehouse the parcel ships from handing it to the courier: PICKED → HANDED_OVER, final.
// The courier's cost follows who pays (the-courier-is-paid-by-the-team-or-by-the-warehouse):
//
//   - WAREHOUSE (*Gudang bayar*): the real cost it paid on the spot is REQUIRED — 0 allowed, an empty field is not 0 —
//     and stored on the parcel; the selling team owes it back through Team Balance (P4 listens), as a restock's
//     courier charge at the door (the-warehouse-cost-is-the-couriers-charge-at-the-door).
//   - TEAM (*Kami bayar*): a cost is REFUSED — the team's own cost stands and the warehouse does not know it
//     (the-warehouse-sees-the-ongkir-it-paid).
//
// The resi is optional. Any other team reads NotFound. After commit, CustomShipmentHandedOver carries the warehouse's
// cost (0 for a TEAM payer). The answer is read as the warehouse reads it — no seller money, its own cost shown.
func (s *Service) CustomShipmentHandover(
	ctx context.Context,
	req *connect.Request[inventoryv1.CustomShipmentHandoverRequest],
) (*connect.Response[inventoryv1.CustomShipmentHandoverResponse], error) {
	msg := req.Msg
	actor := actorFrom(ctx)
	override := overrideFrom(ctx)
	resi := strings.TrimSpace(msg.GetResi())

	var cs *models.CustomShipment

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var lockErr error

		cs, lockErr = lockCustomShipment(tx, msg.GetId(), msg.GetTeamId(), customShipmentShipper)
		if lockErr != nil {
			return lockErr
		}

		statusErr := requireCustomShipmentStatus(cs, "handed over", models.CustomShipmentPicked)
		if statusErr != nil {
			return statusErr
		}

		extra := map[string]any{"resi": resi}

		switch cs.Payer {
		case models.CustomShipmentPayerWarehouse:
			if msg.ShippingCost == nil {
				return errCustomShipmentCostNeeded
			}

			extra["shipping_cost"] = msg.GetShippingCost()
			cs.ShippingCost = msg.GetShippingCost()
		case models.CustomShipmentPayerTeam:
			if msg.ShippingCost != nil {
				return errCustomShipmentCostRefused
			}
		}

		cs.Resi = resi

		return moveCustomShipment(tx, cs, models.CustomShipmentHandedOver, actor, override, extra)
	})
	if err != nil {
		return nil, customShipmentMoveErr(err)
	}

	s.publishCustomShipmentEvent(ctx, customShipmentHandedOverEvent(cs, override))

	wire, err := customShipmentForWire(s.db.WithContext(ctx), cs.ID, msg.GetTeamId())
	if err != nil {
		return nil, customShipmentMoveErr(err)
	}

	return connect.NewResponse(&inventoryv1.CustomShipmentHandoverResponse{CustomShipment: wire}), nil
}
