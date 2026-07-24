package selling_v1

import (
	"errors"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// Order transition errors. A missing order is NotFound; an illegal transition is FailedPrecondition
// — the request was valid but the order's current state does not allow the move.
var (
	errOrderMissing     = errors.New("order not found")
	errNotPlaced        = errors.New("only a placed order can be confirmed")
	errAlreadyCancelled = errors.New("order is already cancelled")
	// #150: once the courier has it, the goods have left the building. Putting the stock back would
	// book them onto a shelf while they are on a van — what comes back now is a RETURN, not a cancel.
	errShippedCannotCancel = errors.New("a shipped order cannot be cancelled — it has already left")
)

// loadScopedOrder loads one order (with its lines) FOR UPDATE, constrained to the team. The team_id
// clause is the scope check — another team's order reads as not-found. The row lock makes the
// read-modify-write on status safe against a concurrent confirm/cancel on the same order.
func loadScopedOrder(tx *gorm.DB, teamID, orderID uint64, dst *selling_service_models.Order) error {
	return tx.
		Clauses(clause.Locking{Strength: "UPDATE"}).
		Preload("Items", func(db *gorm.DB) *gorm.DB {
			return db.Order("id ASC")
		}).
		Where("id = ? AND team_id = ?", orderID, teamID).
		First(dst).
		Error
}

// setOrderStatus writes the new status (stamping updated_at) and mirrors it onto the in-memory row
// so the caller can map the fresh state straight back to proto.
func setOrderStatus(tx *gorm.DB, order *selling_service_models.Order, status string) error {
	err := tx.
		Model(order).
		Updates(withUpdatedAt(map[string]any{"status": status})).
		Error
	if err != nil {
		return err
	}

	order.Status = status

	return nil
}

// mapOrderErr turns the internal transition errors into the right Connect codes.
func mapOrderErr(err error) error {
	switch {
	case errors.Is(err, gorm.ErrRecordNotFound):
		return connect.NewError(connect.CodeNotFound, errOrderMissing)
	case errors.Is(err, errNotPlaced), errors.Is(err, errAlreadyCancelled),
		errors.Is(err, errShippedCannotCancel), errors.Is(err, errWrongStateForStep):
		return connect.NewError(connect.CodeFailedPrecondition, err)
	default:
		return connect.NewError(connect.CodeInternal, err)
	}
}
