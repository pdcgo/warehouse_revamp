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

// RestockRequestArrive is the warehouse signing for the box: ongoing or lost → arrived
// (the-warehouse-signs-and-accepts-the-team-does-the-rest, a-late-lost-box-is-signed-for-as-arrived). Any member of the
// RECEIVING warehouse may sign; scoped to warehouse_id, so another team's restock reads as NotFound.
//
// Signing moves no stock — the box is in the building, not yet counted. It opens the arrived window, in which the
// selling team may still change the lines (the-lines-stay-editable-until-accepted).
//
// THE COURIER'S CHARGE CAN BE NOTED HERE (the-courier-charge-is-noted-at-tiba-and-final-at-terima): when the courier
// asks for it at the door, which is now — its amount, its note and the photo of its slip, under Terima's rules, kept on
// the restock in the columns Terima writes. Terima opens with it and its figure is FINAL: it replaces this one, never
// adds to it (the-courier-is-paid-once-per-restock). NO MONEY MOVES HERE — the selling team owes the warehouse only from
// *Restock Accepted* (balance-posts-the-couriers-debt-from-the-event), and a sign publishes nothing; a box signed for is
// never lost or cancelled after (both are ongoing-only), so a noted charge becomes money through Terima alone.
//
// The row is loaded FOR UPDATE and the status checked under the lock: a sign racing the selling team's cancel or
// give-up must see the other's write, or a cancelled restock could be signed for. The charge is written under that same
// lock, on the row the sign already updates: a sign racing Terima queues on it, so a Terima that commits last writes the
// final figure, and a sign that comes after Terima is refused (a counted box has nothing left to sign).
//
// A LOST BOX THAT TURNS UP takes its lost back on Analytic's Restock on the day it is signed for
// (a-lost-box-that-turns-up-takes-its-lost-back-on-its-day): noted on the stock transaction's report and written as the
// transaction's last statement (restock_metric_fold.go). An ordinary sign counts nothing there.
func (s *Service) RestockRequestArrive(
	ctx context.Context,
	req *connect.Request[inventoryv1.RestockRequestArriveRequest],
) (*connect.Response[inventoryv1.RestockRequestArriveResponse], error) {
	// THE COURIER'S CHARGE, taken as Terima takes it (RestockRequestAccept): its note — what it was for — is OPTIONAL
	// (the-couriers-charge-note-is-optional), so an amount with no note is kept as it is; a note given is kept as typed.
	courierCharge := req.Msg.GetWarehouseAdditionalCost()
	courierNote := req.Msg.GetWarehouseAdditionalCostNote()

	// THE COURIER'S SLIP, optional (the-courier-slip-has-an-optional-photo) — kept beside the charge it belongs to, so
	// only with a charge: with none there is no slip, and a photo sent anyway is dropped, as at Terima.
	courierSlip := ""
	if courierCharge > 0 {
		courierSlip = req.Msg.GetWarehouseAdditionalCostFile()
	}

	var rr inventory_service_models.Restock

	err := inventory_ledgers.StockTransaction(s.db.WithContext(ctx), func(tx *gorm.DB) error {
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
		// The transaction's clock, so the sign and a lost box's take-back on Analytic share one day.
		now := inventory_ledgers.TxNow(tx)
		actor := actorFrom(ctx)

		rr.Status = restockStatusArrived
		rr.ArrivedAt = &now
		rr.ArrivedByUserID = actor

		// The charge noted at the door, on the row this transaction already holds — the columns Terima writes.
		rr.WarehouseAdditionalCost = courierCharge
		rr.WarehouseAdditionalCostNote = courierNote
		rr.WarehouseAdditionalCostFile = courierSlip

		// lost_at / lost_by stay as they are: the restock WAS given up, and the trail says so before it says it came.
		updErr := tx.
			Model(&rr).
			Updates(map[string]any{
				"status":                         restockStatusArrived,
				"arrived_at":                     now,
				"arrived_by_user_id":             actor,
				"warehouse_additional_cost":      courierCharge,
				"warehouse_additional_cost_note": courierNote,
				"warehouse_additional_cost_file": courierSlip,
				"updated_at":                     now,
			}).
			Error
		if updErr != nil {
			return updErr
		}

		logErr := recordRestockLog(tx, rr.ID, from, restockStatusArrived, actor, overrideFrom(ctx), restockLogArrived, now)
		if logErr != nil {
			return logErr
		}

		itemsErr := tx.Where("restock_id = ?", rr.ID).Order("id").Find(&rr.Items).Error
		if itemsErr != nil {
			return itemsErr
		}

		if from != restockStatusLost {
			return nil
		}

		// The box was given up and turned up: lost reads what is still lost — every line taken back, as ordered.
		return inventory_ledgers.NoteRestockFacts(tx, restockShareFacts(&rr, rr.Items, restockLost, -1)...)
	})
	if err != nil {
		return nil, restockErr(err)
	}

	return connect.NewResponse(&inventoryv1.RestockRequestArriveResponse{
		Request: restockRequestToProto(&rr),
	}), nil
}
