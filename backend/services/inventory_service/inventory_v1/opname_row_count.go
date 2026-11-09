package inventory_v1

import (
	"context"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// OpnameRowCount takes a row's count of SELLABLE units (a-count-is-of-sellable-units). The first is the blind count; the
// second is the one recount, which replaces it (a-row-keeps-only-its-latest-count); a third is refused. It answers the
// row revealed — the book figure, the difference — with the system's draft (a-short-rack-gets-a-lost-draft-from-the-system,
// a-surplus-draft-is-counted-by-the-system): a short rack's `lost` for the whole shortage, an over rack's `surplus`, each
// waiting for its reason. Whoever enters the count that stands is the row's counter (a-snapshot-row-names-its-counter).
//
// A counted row takes no count — the admin sends it back first (a-counted-row-is-read-only-until-sent-back). Two people
// counting the same row queue on its lock; the second one's count is the recount.
func (s *Service) OpnameRowCount(
	ctx context.Context,
	req *connect.Request[inventoryv1.OpnameRowCountRequest],
) (*connect.Response[inventoryv1.OpnameRowCountResponse], error) {
	warehouseID := req.Msg.GetTeamId()
	count := req.Msg.GetCount()
	actor := actorFrom(ctx)

	var row models.OpnameSessionSnapshot

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var lockErr error

		_, row, lockErr = lockOpnameRow(tx, warehouseID, req.Msg.GetRowId())
		if lockErr != nil {
			return lockErr
		}

		if row.Status == models.OpnameRowCounted {
			return errOpnameRowCounted
		}

		if row.Recounted {
			return errOpnameRecountUsed
		}

		updates := map[string]any{"recounted_stock_count": count}
		if row.Revealed() {
			updates["recounted"] = true
			row.Recounted = true
		}

		row.RecountedStockCount = &count

		if actor != 0 {
			updates["counted_by_id"] = actor
			row.CountedByID = &actor
		}

		updateErr := tx.Model(&models.OpnameSessionSnapshot{}).Where("id = ?", row.ID).Updates(updates).Error
		if updateErr != nil {
			return updateErr
		}

		// The system's draft follows the count; the counter's broken comes with Mark Counted.
		return writeSystemDraft(tx, row)
	})
	if err != nil {
		return nil, opnameErr(err)
	}

	mapped, err := opnameRowsProto(s.db.WithContext(ctx), row.OpnameSessionID, []models.OpnameSessionSnapshot{row}, nil, true)
	if err != nil {
		return nil, opnameErr(err)
	}

	return connect.NewResponse(&inventoryv1.OpnameRowCountResponse{Row: mapped[0]}), nil
}

// writeSystemDraft replaces a row's lost and surplus drafts with what its count now says — a short rack's `lost` for the
// whole shortage, an over rack's `surplus` for the over, none at an exact count. Their reasons are typed at Mark Counted.
func writeSystemDraft(tx *gorm.DB, row models.OpnameSessionSnapshot) error {
	err := deleteOpnameDrafts(tx, row, false)
	if err != nil {
		return err
	}

	diff := row.Count() - row.SystemStockCount

	switch {
	case diff < 0:
		return tx.Create(&models.OpnameProblemsDraft{
			WarehouseID: row.WarehouseID, TeamID: row.TeamID, ProductID: row.ProductID, PlacementID: row.PlacementID,
			OpnameSessionID: row.OpnameSessionID, ProblemType: models.ProblemLost, ProblemStockCount: -diff,
		}).Error
	case diff > 0:
		return tx.Create(&models.OpnameSurplusDraft{
			WarehouseID: row.WarehouseID, TeamID: row.TeamID, ProductID: row.ProductID, PlacementID: row.PlacementID,
			OpnameSessionID: row.OpnameSessionID, SurplusStockCount: diff,
		}).Error
	default:
		return nil
	}
}
