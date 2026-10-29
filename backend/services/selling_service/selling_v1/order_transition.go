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
	errAlreadyCancelled = errors.New("order is already cancelled")
	// Only a pending order is cancelled (who-may-cancel-a-pending-order). The warehouse hands a processed
	// or picked order back to pending first; once the courier has it, what comes back is a RETURN.
	errOnlyPendingCancels = errors.New("only a pending order can be cancelled — " +
		"the warehouse hands a processed or picked order back to pending first")
)

// moveSide is which end of an order may make a move: its warehouse, its selling team, or either.
type moveSide int

const (
	sideWarehouse moveSide = 1 << iota
	sideSelling
)

// orderMove is one edge of the status diagram.
type orderMove struct {
	from, to string
}

// orderMoveRule says who may make a move, and whether it needs a note.
type orderMoveRule struct {
	by        moveSide
	needsNote bool
}

// orderMoves is the status diagram's PLAIN moves (the-status-move-is-the-only-journey), the table
// OrderStatusChange reads (one-status-change-for-every-plain-move). Each line is an edge of the
// owner's §Status Move with who makes it.
//
// Two edges are NOT here, because they do more than move a status and keep their own RPCs:
// pending → cancel (OrderCancel: stock back, the sale cancelled) and return → return_completed (the
// return accept: the warehouse recorded, borrowed units relabelled, stock back).
var orderMoves = map[orderMove]orderMoveRule{
	// The warehouse.
	{orderStatusPending, orderStatusProcessed}: {by: sideWarehouse},
	{orderStatusProcessed, orderStatusPending}: {by: sideWarehouse, needsNote: true}, // goods on no rack
	{orderStatusProcessed, orderStatusPicked}:  {by: sideWarehouse},
	{orderStatusPicked, orderStatusPending}:    {by: sideWarehouse, needsNote: true}, // platform cancelled, unpacked
	{orderStatusPicked, orderStatusShipping}:   {by: sideWarehouse},                  // the handover scan

	// Customer service, from the platform.
	{orderStatusShipping, orderStatusShipped}:  {by: sideSelling},
	{orderStatusShipped, orderStatusCompleted}: {by: sideSelling},
	{orderStatusShipped, orderStatusProblem}:   {by: sideSelling},
	{orderStatusShipped, orderStatusLost}:      {by: sideSelling},
	{orderStatusProblem, orderStatusCompleted}: {by: sideSelling},
	{orderStatusProblem, orderStatusLost}:      {by: sideSelling},
	{orderStatusReturn, orderStatusLost}:       {by: sideSelling}, // the parcel never came back

	// A return: claimed by customer service, or forced by the warehouse.
	{orderStatusShipping, orderStatusReturn}:  {by: sideSelling | sideWarehouse},
	{orderStatusShipped, orderStatusReturn}:   {by: sideSelling | sideWarehouse},
	{orderStatusProblem, orderStatusReturn}:   {by: sideSelling | sideWarehouse},
	{orderStatusCompleted, orderStatusReturn}: {by: sideSelling | sideWarehouse},
}

// loadScopedOrder loads one order (with its lines) FOR UPDATE, constrained to the team. The team_id
// clause is the scope check — another team's order reads as not-found. The row lock makes the
// read-modify-write on status safe against a concurrent move or cancel on the same order.
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
// history with its note, and mirrors both onto the in-memory row so the caller can map the fresh state
// straight back to proto.
//
// The history write lives HERE, at the single choke point every transition already passes through,
// rather than in the handlers that call it. A handler that forgot the line would leave a gap in a
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
	from string,
	actor uint64,
	note string,
) error {
	_, err := setOrdersStatus(tx, []timelineMove{{order: order, from: from}}, status, actor, note)

	return err
}

// timelineMove is one order of a batch move, and the side its timeline row is written from — per order, because
// one caller may be the warehouse of one order and the selling team of another.
type timelineMove struct {
	order *selling_service_models.Order
	from  string
}

// setOrdersStatus is setOrderStatus for a batch that all moves INTO the same status: one UPDATE and one
// multi-row timeline INSERT, whatever the size of the batch (a-batch-move-saves-in-one-transaction). The
// orders must be distinct and already locked by the caller. An empty batch writes nothing.
//
// It returns the timeline rows it wrote, in the batch's order and with their ids — what each move's
// OrderStatusChanged is derived from.
func setOrdersStatus(
	tx *gorm.DB,
	moves []timelineMove,
	status string,
	actor uint64,
	note string,
) ([]selling_service_models.OrderTimelineLog, error) {
	if len(moves) == 0 {
		return nil, nil
	}

	// The moment is taken ONCE and written to the rows, the in-memory models AND the events, so a caller
	// that publishes an event about this transition can take the time from the ORDER rather than calling
	// time.Now() again at the publish site. Two clocks for one fact would file a boundary transition in
	// different days depending on who read it (guidelines/event-guideline.md #2).
	now := time.Now()

	ids := make([]uint64, 0, len(moves))
	logs := make([]selling_service_models.OrderTimelineLog, 0, len(moves))

	for _, move := range moves {
		ids = append(ids, move.order.ID)
		logs = append(logs, selling_service_models.OrderTimelineLog{
			OrderID:   move.order.ID,
			Status:    status,
			Note:      note,
			From:      move.from,
			ActorID:   actor,
			CreatedAt: now,
		})
	}

	err := tx.
		Model(&selling_service_models.Order{}).
		Where("id IN ?", ids).
		Updates(map[string]any{"status": status, "updated_at": now}).
		Error
	if err != nil {
		return nil, err
	}

	// The timeline row names the status moved INTO (order-timeline-logs-replaces-order-events).
	err = recordTimelineLogs(tx, logs)
	if err != nil {
		return nil, err
	}

	for _, move := range moves {
		move.order.Status = status
		move.order.UpdatedAt = now
	}

	return logs, nil
}

// mapOrderErr turns the internal transition errors into the right Connect codes.
func mapOrderErr(err error) error {
	switch {
	case errors.Is(err, gorm.ErrRecordNotFound):
		return connect.NewError(connect.CodeNotFound, errOrderMissing)
	case errors.Is(err, errAlreadyCancelled), errors.Is(err, errOnlyPendingCancels):
		return connect.NewError(connect.CodeFailedPrecondition, err)
	default:
		return connect.NewError(connect.CodeInternal, err)
	}
}
