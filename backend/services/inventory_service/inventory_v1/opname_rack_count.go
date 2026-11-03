package inventory_v1

import (
	"context"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// OpnameRackCount is one rack as its counter sees it: every row on it, by product name, BLIND — a row not yet counted
// carries no book figure, whoever asks (a-count-is-blind-then-revealed); a counted one carries its figures and drafts.
// Unpaged: it is bounded by what one shelf holds, as the proto argues (RULE 9). A rack the count does not visit reads as
// not found.
func (s *Service) OpnameRackCount(
	ctx context.Context,
	req *connect.Request[inventoryv1.OpnameRackCountRequest],
) (*connect.Response[inventoryv1.OpnameRackCountResponse], error) {
	db := s.db.WithContext(ctx)

	session, err := opnameSessionOf(db, req.Msg.GetTeamId(), req.Msg.GetSessionId(), "")
	if err != nil {
		return nil, opnameErr(err)
	}

	rack, err := opnameRackOf(db, session, req.Msg.GetPlacementId())
	if err != nil {
		return nil, opnameErr(err)
	}

	var rows []models.OpnameSessionSnapshot

	err = db.Where("opname_session_id = ? AND placement_id = ?", session.ID, rack.PlacementID).
		Order("product_name, id").
		Find(&rows).Error
	if err != nil {
		return nil, opnameErr(err)
	}

	mapped, err := opnameRowsProto(db, session.ID, rows, map[uint64]string{rack.PlacementID: rack.Code}, true)
	if err != nil {
		return nil, opnameErr(err)
	}

	return connect.NewResponse(&inventoryv1.OpnameRackCountResponse{Rack: rack.proto(), Rows: mapped}), nil
}

// opnameRackOf is one rack of the session with its progress — not found when the count does not visit it.
func opnameRackOf(db *gorm.DB, session models.OpnameSession, placementID uint64) (opnameRackRow, error) {
	var racks []opnameRackRow

	err := opnameRacksQuery(db, session).Where("racks.placement_id = ?", placementID).Scan(&racks).Error
	if err != nil {
		return opnameRackRow{}, err
	}

	if len(racks) == 0 {
		return opnameRackRow{}, errOpnameRackNotHere
	}

	return racks[0], nil
}
