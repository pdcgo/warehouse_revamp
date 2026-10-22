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

// RestockRequestArrive is the warehouse signing for the box: ongoing or lost → arrived
// (the-warehouse-signs-and-accepts-the-team-does-the-rest, a-late-lost-box-is-signed-for-as-arrived). Any member of the
// RECEIVING warehouse may sign; scoped to warehouse_id, so another team's restock reads as NotFound.
//
// Signing moves no stock — the box is in the building, not yet counted. It opens the arrived window, in which the
// selling team may still change the lines (the-lines-stay-editable-until-accepted).
//
// The row is loaded FOR UPDATE and the status checked under the lock: a sign racing the selling team's cancel or
// give-up must see the other's write, or a cancelled restock could be signed for.
func (s *Service) RestockRequestArrive(
	ctx context.Context,
	req *connect.Request[inventoryv1.RestockRequestArriveRequest],
) (*connect.Response[inventoryv1.RestockRequestArriveResponse], error) {
	var rr inventory_service_models.Restock

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		loadErr := tx.
			Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND warehouse_id = ?", req.Msg.GetRequestId(), req.Msg.GetTeamId()).
			First(&rr).
			Error
		if loadErr != nil {
			return loadErr
		}

		// On its way, or given up and then turned up after all. A box already signed for, counted or called off has
		// nothing left to sign.
		if rr.Status != restockStatusOngoing && rr.Status != restockStatusLost {
			return errRestockNotArrivable
		}

		from := rr.Status
		now := time.Now()
		actor := actorFrom(ctx)

		rr.Status = restockStatusArrived
		rr.ArrivedAt = &now
		rr.ArrivedByUserID = actor

		// lost_at / lost_by stay as they are: the restock WAS given up, and the trail says so before it says it came.
		updErr := tx.
			Model(&rr).
			Updates(map[string]any{
				"status":             restockStatusArrived,
				"arrived_at":         now,
				"arrived_by_user_id": actor,
				"updated_at":         now,
			}).
			Error
		if updErr != nil {
			return updErr
		}

		logErr := recordRestockLog(tx, rr.ID, from, restockStatusArrived, actor, restockLogArrived, now)
		if logErr != nil {
			return logErr
		}

		return tx.Where("restock_id = ?", rr.ID).Order("id").Find(&rr.Items).Error
	})
	if err != nil {
		return nil, restockErr(err)
	}

	return connect.NewResponse(&inventoryv1.RestockRequestArriveResponse{
		Request: restockRequestToProto(&rr),
	}), nil
}
