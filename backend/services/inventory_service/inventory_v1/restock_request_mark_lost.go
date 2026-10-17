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

// RestockRequestMarkLost is the selling team giving the parcel up: ongoing → lost
// (lost-is-set-only-before-the-box-arrives). Scoped to requesting_team_id: another team's restock reads as NotFound.
//
// Only while ongoing. A box already in the building is not lost — a unit missing from it is a problem row at the count
// — and a counted or called-off restock is closed. A lost box that turns up after all is signed for as arrived
// (a-late-lost-box-is-signed-for-as-arrived). Nothing moves money here: the parcel was paid for, and giving it up
// returns nothing.
func (s *Service) RestockRequestMarkLost(
	ctx context.Context,
	req *connect.Request[inventoryv1.RestockRequestMarkLostRequest],
) (*connect.Response[inventoryv1.RestockRequestMarkLostResponse], error) {
	var rr inventory_service_models.RestockRequest

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		loadErr := tx.
			Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND requesting_team_id = ?", req.Msg.GetRequestId(), req.Msg.GetTeamId()).
			First(&rr).
			Error
		if loadErr != nil {
			return loadErr
		}

		if rr.Status != restockStatusOngoing {
			return errRestockNotOngoing
		}

		now := time.Now()
		actor := actorFrom(ctx)

		rr.Status = restockStatusLost
		rr.LostAt = &now
		rr.LostByUserID = actor

		updErr := tx.
			Model(&rr).
			Updates(map[string]any{
				"status":          restockStatusLost,
				"lost_at":         now,
				"lost_by_user_id": actor,
				"updated_at":      now,
			}).
			Error
		if updErr != nil {
			return updErr
		}

		// The selling team's why, if it gave one, is the trail row's words.
		description := restockLogLost
		if why := req.Msg.GetDescription(); why != "" {
			description = restockLogLost + " — " + why
		}

		logErr := recordRestockLog(tx, rr.ID, restockStatusOngoing, restockStatusLost, actor, description, now)
		if logErr != nil {
			return logErr
		}

		return tx.Where("restock_request_id = ?", rr.ID).Order("id").Find(&rr.Items).Error
	})
	if err != nil {
		return nil, restockErr(err)
	}

	return connect.NewResponse(&inventoryv1.RestockRequestMarkLostResponse{
		Request: restockRequestToProto(&rr),
	}), nil
}
