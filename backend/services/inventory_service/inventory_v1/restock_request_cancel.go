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

// RestockRequestCancel is called by the REQUESTING team (#105): it cancels its own still-pending
// request. Scoped to team_id (another team's request reads as NotFound); a fulfilled or
// already-cancelled request is rejected (FailedPrecondition). No stock is touched — but the cancel takes the restock's
// ORDERED back on Analytic's Restock on its own day (a-cancelled-restock-takes-its-ordered-back-on-its-day), noted on the
// stock transaction's report and written as the transaction's last statement (restock_metric_fold.go).
func (s *Service) RestockRequestCancel(
	ctx context.Context,
	req *connect.Request[inventoryv1.RestockRequestCancelRequest],
) (*connect.Response[inventoryv1.RestockRequestCancelResponse], error) {
	teamID := req.Msg.GetTeamId()

	var rr inventory_service_models.Restock

	err := inventory_ledgers.StockTransaction(s.db.WithContext(ctx), func(tx *gorm.DB) error {
		loadErr := tx.
			Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND team_id = ?", req.Msg.GetRequestId(), teamID).
			First(&rr).
			Error
		if loadErr != nil {
			return loadErr
		}

		// Ongoing only (a-restock-is-cancelled-only-while-ongoing): a box that arrived is in the building, a lost one
		// was paid for, and a cancelled one must not refund twice.
		if rr.Status != restockStatusOngoing {
			return errRestockNotOngoing
		}

		// WHEN it was called off, stamped here rather than left to `updated_at`: any later write would
		// move that column, and "cancelled last Tuesday" has to stay true afterwards. The transaction's clock, so the
		// cancel and its take-back on Analytic share one day.
		now := inventory_ledgers.TxNow(tx)
		actor := actorFrom(ctx)

		rr.Status = restockStatusCancelled
		rr.CancelledAt = &now
		// WHO called it off (00019) — from the caller's identity, exactly as created-by and accepted-by
		// are. Before this the cancelled step on the timeline could name a date and nobody, while every
		// other step named somebody.
		rr.CancelledByUserID = actor

		updateErr := tx.
			Model(&rr).
			Updates(map[string]any{
				"status":               restockStatusCancelled,
				"cancelled_at":         now,
				"cancelled_by_user_id": actor,
				"updated_at":           now,
			}).
			Error
		if updateErr != nil {
			return updateErr
		}

		// Same transaction, same instant as the column above — see recordRestockLog. Whether the money came back is
		// the trail's to say (a-restock-names-its-paying-account): it is a fact about this cancel, not a column.
		description := restockLogCancelled + " — money not returned"
		if req.Msg.GetMoneyReturned() {
			description = restockLogCancelled + " — money returned"
		}

		logErr := recordRestockLog(tx, rr.ID, restockStatusOngoing, restockStatusCancelled, actor, overrideFrom(ctx), description, now)
		if logErr != nil {
			return logErr
		}

		// The lines, for the amount the cancel announces.
		itemsErr := tx.Where("restock_id = ?", rr.ID).Order("id").Find(&rr.Items).Error
		if itemsErr != nil {
			return itemsErr
		}

		// The ordered taken back, every line, on the cancel day: ordered reads what is still on order.
		return inventory_ledgers.NoteRestockFacts(tx, restockShareFacts(&rr, rr.Items, restockOrdered, -1)...)
	})
	if err != nil {
		return nil, restockErr(err)
	}

	// AFTER the commit: the paying account hears it was called off, and whether the money came back
	// (a-restock-names-its-paying-account).
	s.publishRestockMoney(ctx, restockCancelledEvent(&rr, req.Msg.GetMoneyReturned()))

	return connect.NewResponse(&inventoryv1.RestockRequestCancelResponse{
		Request: restockRequestToProto(&rr),
	}), nil
}
