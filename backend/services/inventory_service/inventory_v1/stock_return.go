package inventory_v1

import (
	"context"
	"errors"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

var (
	// Returning a ref that never picked anything is NotFound rather than a silent success: "the stock
	// is back" must not be true when none ever left.
	errNothingToReturn = errors.New("no stock was picked under this reference")
	// Returning twice would CREATE stock — the second reversal has nothing to reverse but would still
	// add. Refused, and this is the guard that makes a retrying caller safe.
	errAlreadyReturned = errors.New("this pick has already been returned")
)

// StockReturn puts a pick back (#70/#149): a cancelled order, or an order that died after its stock
// had already been taken.
//
// It reverses the RECORDED movements rather than a quantity the caller supplies, and that is what
// makes it exact — the stock goes back precisely where it came from, including the split across
// shelves that the drain order produced. A caller passing its own numbers could disagree with what was
// actually taken, and the ledger would have no way to notice.
//
// Nothing physically moved, which is why "back where it came from" is the truthful answer rather than
// the convenient one: an order is cancelled before anyone has walked to a shelf, so the goods are still
// sitting exactly where the pick said they were. Once physical picking exists (#71), a cancel AFTER
// someone has actually carried the box will need revisiting — by then the goods really have moved, and
// where they end up is a question for whoever put them down.
func (s *Service) StockReturn(
	ctx context.Context,
	req *connect.Request[inventoryv1.StockReturnRequest],
) (*connect.Response[inventoryv1.StockReturnResponse], error) {
	warehouseID := req.Msg.GetWarehouseId()
	ref := req.Msg.GetRef()
	actor := actorFrom(ctx)

	var returned []*inventory_service_models.StockMovement

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// Everything this reference took. Locked, so two concurrent returns cannot both read the same
		// picks and each decide to reverse them.
		var picks []inventory_service_models.StockMovement

		err := tx.
			Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("warehouse_id = ? AND ref = ? AND kind = ?",
				warehouseID, ref, int32(inventoryv1.MovementKind_MOVEMENT_KIND_PICK)).
			Order("id ASC").
			Find(&picks).
			Error
		if err != nil {
			return err
		}

		if len(picks) == 0 {
			return errNothingToReturn
		}

		// Already given back? Returning twice would CREATE stock: the second pass has nothing left to
		// reverse but would add anyway. This is what makes a retrying caller safe.
		var already int64

		err = tx.
			Model(&inventory_service_models.StockMovement{}).
			Where("warehouse_id = ? AND ref = ? AND kind = ?",
				warehouseID, ref, int32(inventoryv1.MovementKind_MOVEMENT_KIND_RETURN)).
			Count(&already).
			Error
		if err != nil {
			return err
		}

		if already > 0 {
			return errAlreadyReturned
		}

		for i := range picks {
			// A pick's delta is negative, so the return is its opposite — same product, same shelf,
			// same quantity, opposite sign.
			give := -picks[i].Delta

			balance, applyErr := applyDelta(tx, warehouseID, picks[i].ProductID, picks[i].RackID, give)
			if applyErr != nil {
				return applyErr
			}

			mv, moveErr := appendMovement(tx, warehouseID, picks[i].ProductID, picks[i].RackID,
				nil, give, balance, inventoryv1.MovementKind_MOVEMENT_KIND_RETURN, "order returned", ref, actor)
			if moveErr != nil {
				return moveErr
			}

			returned = append(returned, mv)
		}

		return nil
	})
	if err != nil {
		switch {
		case errors.Is(err, errNothingToReturn):
			return nil, connect.NewError(connect.CodeNotFound, errNothingToReturn)
		case errors.Is(err, errAlreadyReturned):
			return nil, connect.NewError(connect.CodeFailedPrecondition, errAlreadyReturned)
		default:
			return nil, writeError(err)
		}
	}

	out := make([]*inventoryv1.StockMovement, 0, len(returned))
	for i := range returned {
		out = append(out, movementToProto(returned[i]))
	}

	return connect.NewResponse(&inventoryv1.StockReturnResponse{Movements: out}), nil
}
