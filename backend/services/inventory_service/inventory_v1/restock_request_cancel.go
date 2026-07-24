package inventory_v1

import (
	"context"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// RestockRequestCancel is called by the REQUESTING team (#105): it cancels its own still-pending
// request. Scoped to requesting_team_id (another team's request reads as NotFound); a fulfilled or
// already-cancelled request is rejected (FailedPrecondition). No stock is touched.
func (s *Service) RestockRequestCancel(
	ctx context.Context,
	req *connect.Request[inventoryv1.RestockRequestCancelRequest],
) (*connect.Response[inventoryv1.RestockRequestCancelResponse], error) {
	teamID := req.Msg.GetTeamId()

	var rr inventory_service_models.RestockRequest

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		loadErr := tx.
			Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND requesting_team_id = ?", req.Msg.GetRequestId(), teamID).
			First(&rr).
			Error
		if loadErr != nil {
			return loadErr
		}

		if rr.Status != restockStatusPending {
			return errRestockNotPending
		}

		rr.Status = restockStatusCancelled

		return tx.
			Model(&rr).
			Updates(map[string]any{"status": restockStatusCancelled, "updated_at": time.Now()}).
			Error
	})
	if err != nil {
		return nil, restockErr(err)
	}

	return connect.NewResponse(&inventoryv1.RestockRequestCancelResponse{
		Request: restockRequestToProto(&rr),
	}), nil
}
