package inventory_v1

import (
	"context"
	"errors"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// A stock-take must say WHERE it counted (#139). Proto validation refuses this first; the error exists
// so a request arriving around it fails loudly rather than quietly correcting the unplaced pile.
var errAdjustNoPlace = errors.New("a stock-take must say which place it counted (a rack, or unplaced)")

// StockAdjust corrects ONE PLACE's on-hand to a counted figure (absolute, not a delta) and records the
// difference as an ADJUST movement, so the correction is auditable in the ledger.
//
// A stock-take counts a SHELF (#139, owner's call): someone stands in front of A-01-3 and counts what
// is on it, so the request says which shelf that was — a rack, or explicitly the unplaced pile. It is
// required, because a warehouse-level figure would need a rule for spreading a correction across a
// product's shelves, and every such rule invents a fact nobody observed. A stock-take that corrects the
// wrong shelf is worse than none, because it is believed.
//
// The response's `Level` is the warehouse's TOTAL after the correction, not the corrected shelf: the
// shelf's own new figure is the movement's `balance`, and the two answer different questions ("this
// shelf is now 68" / "the warehouse now holds 135").
func (s *Service) StockAdjust(
	ctx context.Context,
	req *connect.Request[inventoryv1.StockAdjustRequest],
) (*connect.Response[inventoryv1.StockAdjustResponse], error) {
	warehouseID := req.Msg.GetWarehouseId()
	productID := req.Msg.GetProductId()
	target := req.Msg.GetOnHand()
	actor := actorFrom(ctx)

	// The place counted. Proto validation (a required oneof) rejects a request that names none, but
	// this re-checks it rather than reading the zero value: `GetRackId()` returns 0 both for
	// "unplaced" and for "said nothing", and silently treating the second as the first is precisely
	// the bug this field exists to prevent — a stock-take correcting a pile nobody counted. The guard
	// is what makes the distinction real to the handler rather than only to the interceptor.
	if req.Msg.GetPlace() == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errAdjustNoPlace)
	}

	var rackID *uint64

	if id := req.Msg.GetRackId(); id != 0 {
		rackID = &id
	}

	var (
		mv    *inventory_service_models.StockMovement
		total int64
	)

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if rackID != nil {
			// The shelf must be one of THIS warehouse's — another warehouse's rack reads as NotFound,
			// never PermissionDenied, or the error itself would confirm the id exists.
			exists, checkErr := rackExists(tx, warehouseID, *rackID)
			if checkErr != nil {
				return checkErr
			}

			if !exists {
				return errRackMissing
			}
		}

		// Current on-hand OF THAT PLACE, locked (0 if it holds nothing yet).
		//
		// `IS NOT DISTINCT FROM`, never `=`: for the unplaced pile the latter is `rack_id = NULL`,
		// which is never true in SQL — not even against a NULL row — so it would read 0, "correct" a
		// full pile up to the target, and write an ADJUST movement claiming a discrepancy that never
		// existed.
		var current int64

		err := tx.Raw(`
			SELECT on_hand FROM stock_levels
			WHERE warehouse_id = ? AND product_id = ? AND rack_id IS NOT DISTINCT FROM ?
			FOR UPDATE`,
			warehouseID, productID, rackID,
		).Scan(&current).Error
		if err != nil {
			return err
		}

		delta := target - current

		// Set that place's on-hand to the counted target (not += delta) — the count is authoritative.
		err = tx.Exec(`
			INSERT INTO stock_levels (warehouse_id, product_id, rack_id, on_hand, updated_at)
			VALUES (?, ?, ?, ?, NOW())
			ON CONFLICT (warehouse_id, product_id, rack_id)
			DO UPDATE SET on_hand = EXCLUDED.on_hand, updated_at = NOW()`,
			warehouseID, productID, rackID, target,
		).Error
		if err != nil {
			return err
		}

		mv, err = appendMovement(tx, warehouseID, productID, rackID, delta, target,
			inventoryv1.MovementKind_MOVEMENT_KIND_ADJUST, req.Msg.GetReason(), "", actor)
		if err != nil {
			return err
		}

		// The warehouse's total AFTER the correction — read back rather than computed, so it is the
		// number the next reader will see and not this handler's opinion of it.
		return tx.Raw(`
			SELECT COALESCE(SUM(on_hand), 0) FROM stock_levels
			WHERE warehouse_id = ? AND product_id = ?`,
			warehouseID, productID,
		).Scan(&total).Error
	})
	if err != nil {
		return nil, writeError(err)
	}

	level := &inventory_service_models.StockLevel{
		WarehouseID: warehouseID,
		ProductID:   productID,
		OnHand:      total,
	}

	return connect.NewResponse(&inventoryv1.StockAdjustResponse{
		Movement: movementToProto(mv),
		Level:    levelToProto(level),
	}), nil
}
