package inventory_v1

import (
	"context"
	"strings"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// CustomShipmentResiSet is the owning SELLING team's *Ubah Resi* on an INBOUND parcel, only while it is on its way — the
// resi until Tiba, as a restock's (a-suppliers-reshipping-comes-in-as-a-custom-shipment, 🔄 A). One trail row of its own
// kind, the old and new resi — no money, both sides read it. A resi that does not change writes nothing.
func (s *Service) CustomShipmentResiSet(
	ctx context.Context,
	req *connect.Request[inventoryv1.CustomShipmentResiSetRequest],
) (*connect.Response[inventoryv1.CustomShipmentResiSetResponse], error) {
	msg := req.Msg
	resi := strings.TrimSpace(msg.GetResi())

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		cs, lockErr := lockInboundParcel(tx, msg.GetId(), msg.GetTeamId(), customShipmentOwner)
		if lockErr != nil {
			return lockErr
		}

		statusErr := requireCustomShipmentStatus(cs, "given a new resi", models.CustomShipmentOnTheWay)
		if statusErr != nil {
			return statusErr
		}

		if cs.Resi == resi {
			return nil
		}

		// The words before the UPDATE: GORM writes the new value into the row in hand.
		description := resiText(cs.Resi) + " → " + resiText(resi)

		updateErr := tx.
			Model(cs).
			Updates(map[string]any{"resi": resi, "updated_at": inventoryNow()}).
			Error
		if updateErr != nil {
			return updateErr
		}

		return writeCustomShipmentLog(tx, &models.CustomShipmentLog{
			CustomShipmentID: cs.ID,
			Kind:             models.CustomShipmentLogResiEdit,
			FromStatus:       cs.Status,
			ToStatus:         cs.Status,
			ActorUserID:      actorFrom(ctx),
			IsOverride:       overrideFrom(ctx),
			Description:      description,
		})
	})
	if err != nil {
		return nil, inboundErr(err)
	}

	wire, err := customShipmentForWire(s.db.WithContext(ctx), msg.GetId(), msg.GetTeamId())
	if err != nil {
		return nil, inboundErr(err)
	}

	return connect.NewResponse(&inventoryv1.CustomShipmentResiSetResponse{CustomShipment: wire}), nil
}

// resiText is a resi as the trail says it — "—" for none.
func resiText(resi string) string {
	if resi == "" {
		return "—"
	}

	return resi
}
