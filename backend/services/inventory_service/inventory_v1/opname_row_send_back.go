package inventory_v1

import (
	"context"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// OpnameRowSendBack is the admin's "recount Rak A": a counted row goes back to `created`, its count, its counter and its
// drafts cleared, and staff count it again blind (a-counted-row-is-read-only-until-sent-back). The row stays open — it is
// still the lock.
func (s *Service) OpnameRowSendBack(
	ctx context.Context,
	req *connect.Request[inventoryv1.OpnameRowSendBackRequest],
) (*connect.Response[inventoryv1.OpnameRowSendBackResponse], error) {
	warehouseID := req.Msg.GetTeamId()

	var row models.OpnameSessionSnapshot

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var lockErr error

		_, row, lockErr = lockOpnameRow(tx, warehouseID, req.Msg.GetRowId())
		if lockErr != nil {
			return lockErr
		}

		if row.Status != models.OpnameRowCounted {
			return errOpnameNotCounted
		}

		updateErr := tx.Model(&models.OpnameSessionSnapshot{}).Where("id = ?", row.ID).Updates(map[string]any{
			"status":                models.OpnameRowCreated,
			"recounted_stock_count": nil,
			"recounted":             false,
			"counted_by_id":         nil,
		}).Error
		if updateErr != nil {
			return updateErr
		}

		row.Status = models.OpnameRowCreated
		row.RecountedStockCount = nil
		row.Recounted = false
		row.CountedByID = nil

		return deleteOpnameDrafts(tx, row, true)
	})
	if err != nil {
		return nil, opnameErr(err)
	}

	mapped, err := opnameRowsProto(s.db.WithContext(ctx), row.OpnameSessionID, []models.OpnameSessionSnapshot{row}, nil, false)
	if err != nil {
		return nil, opnameErr(err)
	}

	return connect.NewResponse(&inventoryv1.OpnameRowSendBackResponse{Row: mapped[0]}), nil
}

// deleteOpnameDrafts removes a row's drafts — every one, or with broken=false only the system's lost and surplus.
func deleteOpnameDrafts(tx *gorm.DB, row models.OpnameSessionSnapshot, broken bool) error {
	problems := tx.Where("opname_session_id = ? AND product_id = ? AND placement_id = ?",
		row.OpnameSessionID, row.ProductID, row.PlacementID)
	if !broken {
		problems = problems.Where("problem_type = ?", models.ProblemLost)
	}

	err := problems.Delete(&models.OpnameProblemsDraft{}).Error
	if err != nil {
		return err
	}

	return tx.Where("opname_session_id = ? AND product_id = ? AND placement_id = ?",
		row.OpnameSessionID, row.ProductID, row.PlacementID).Delete(&models.OpnameSurplusDraft{}).Error
}
