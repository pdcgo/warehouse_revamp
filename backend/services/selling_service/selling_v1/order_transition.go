package selling_v1

import (
	"errors"
	"time"

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

// setOrderStatus writes the new status (stamping updated_at), RECORDS THE TRANSITION on the order's
// history, and mirrors both onto the in-memory row so the caller can map the fresh state straight back
// to proto.
//
// The history write lives HERE, at the single choke point every transition already passes through,
// rather than in the five handlers that call it. A handler that forgot the line would leave a gap in a
// timeline nothing else can reconstruct — the row keeps only its current status — and that gap is
// invisible until somebody opens the order weeks later and finds a step missing.
//
// `actor` is the caller (eventActor), 0 when unidentifiable. It is a parameter rather than read from a
// context in here because this function has no ctx and should not grow one for a field: the handler
// knows who is asking.
func setOrderStatus(
	tx *gorm.DB,
	order *selling_service_models.Order,
	status string,
	actor uint64,
) error {
	// The moment is taken ONCE and written to the row, the in-memory model AND the event, so a caller
	// that publishes an event about this transition can take the time from the ORDER rather than calling
	// time.Now() again at the publish site. Two clocks for one fact would file a boundary transition in
	// different days depending on who read it (guidelines/event-guideline.md #2).
	now := time.Now()

	err := tx.
		Model(order).
		Updates(map[string]any{"status": status, "updated_at": now}).
		Error
	if err != nil {
		return err
	}

	// The kind IS the status moved into — see the orderEvent* constants for why the two vocabularies
	// are written down separately despite being equal today.
	err = recordOrderEvent(tx, order.ID, status, actor, now)
	if err != nil {
		return err
	}

	order.Status = status
	order.UpdatedAt = now

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
