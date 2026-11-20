package inventory_v1

import (
	"context"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_ledgers"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// RestockRequestMarkLost is the selling team giving the parcel up: ongoing → lost
// (lost-is-set-only-before-the-box-arrives). Scoped to team_id: another team's restock reads as NotFound.
//
// Only while ongoing. A box already in the building is not lost — a unit missing from it is a problem row at the count
// — and a counted or called-off restock is closed. A lost box that turns up after all is signed for as arrived
// (a-late-lost-box-is-signed-for-as-arrived). Nothing moves money here: the parcel was paid for, and giving it up
// returns nothing. Analytic's Restock counts it LOST ON THE WAY on this day (the-restock-before-the-accept-prototype-is-
// accepted) — every line as ordered, noted on the stock transaction's report and written as its last statement.
func (s *Service) RestockRequestMarkLost(
	ctx context.Context,
	req *connect.Request[inventoryv1.RestockRequestMarkLostRequest],
) (*connect.Response[inventoryv1.RestockRequestMarkLostResponse], error) {
	var rr inventory_service_models.Restock

	err := inventory_ledgers.StockTransaction(s.db.WithContext(ctx), func(tx *gorm.DB) error {
		loadErr := tx.
			Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND team_id = ?", req.Msg.GetRequestId(), req.Msg.GetTeamId()).
			First(&rr).
			Error
		if loadErr != nil {
			return loadErr
		}

		if rr.Status != restockStatusOngoing {
			return errRestockNotOngoing
		}

		// The transaction's clock, so the trail's lost step and the lost on Analytic share one day.
		now := inventory_ledgers.TxNow(tx)
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

		logErr := recordRestockLog(tx, rr.ID, restockStatusOngoing, restockStatusLost, actor, overrideFrom(ctx), description, now)
		if logErr != nil {
			return logErr
		}

		itemsErr := tx.Where("restock_id = ?", rr.ID).Order("id").Find(&rr.Items).Error
		if itemsErr != nil {
			return itemsErr
		}

		// Lost on the way: every line's units and its share of the total, as ordered now (a lost restock is never edited).
		return inventory_ledgers.NoteRestockFacts(tx, restockShareFacts(&rr, rr.Items, restockLost, 1)...)
	})
	if err != nil {
		return nil, restockErr(err)
	}

	return connect.NewResponse(&inventoryv1.RestockRequestMarkLostResponse{
		Request: restockRequestToProto(&rr),
	}), nil
}
