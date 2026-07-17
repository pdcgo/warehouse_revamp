package inventory_v1

import (
	"context"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// StockAdjust corrects on-hand to a counted figure (absolute, not a delta). It records the
// difference as an ADJUST movement, so the correction is auditable in the ledger.
//
// ⚠ It counts the UNPLACED pile, and only that (#135). That is exactly today's behaviour, because
// today every warehouse's stock is unplaced — so this is a faithful no-op of a change, not a new rule.
//
// It is NOT the final answer, and the gap is deliberate rather than overlooked: a stock-take is
// physically a count of a SHELF, so once #136 puts stock on racks, "set product X at warehouse Y to
// 68" stops having one meaning — 68 on which shelf? Adjusting the unplaced pile while racks hold the
// rest would silently correct the wrong number. **#136 must decide whether a stock-take names a rack
// before it places any stock**; that question is recorded on the issue, and this scope is what keeps
// the model change (#135) honest and invisible until it is answered.
func (s *Service) StockAdjust(
	ctx context.Context,
	req *connect.Request[inventoryv1.StockAdjustRequest],
) (*connect.Response[inventoryv1.StockAdjustResponse], error) {
	warehouseID := req.Msg.GetWarehouseId()
	productID := req.Msg.GetProductId()
	target := req.Msg.GetOnHand()
	actor := actorFrom(ctx)

	var mv *inventory_service_models.StockMovement

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// Current on-hand of the unplaced pile, locked (0 if the level does not exist yet).
		//
		// `IS NOT DISTINCT FROM NULL`, never `= NULL`: the latter is never true in SQL — not even
		// against a NULL row — so it would read 0, "correct" a full pile to the target, and write an
		// ADJUST movement claiming a discrepancy that never existed.
		var current int64

		err := tx.Raw(`
			SELECT on_hand FROM stock_levels
			WHERE warehouse_id = ? AND product_id = ? AND rack_id IS NOT DISTINCT FROM NULL
			FOR UPDATE`,
			warehouseID, productID,
		).Scan(&current).Error
		if err != nil {
			return err
		}

		delta := target - current

		// Set on-hand to the counted target (not += delta) — the count is authoritative.
		err = tx.Exec(`
			INSERT INTO stock_levels (warehouse_id, product_id, rack_id, on_hand, updated_at)
			VALUES (?, ?, NULL, ?, NOW())
			ON CONFLICT (warehouse_id, product_id, rack_id)
			DO UPDATE SET on_hand = EXCLUDED.on_hand, updated_at = NOW()`,
			warehouseID, productID, target,
		).Error
		if err != nil {
			return err
		}

		mv, err = appendMovement(tx, warehouseID, productID, unplaced, delta, target,
			inventoryv1.MovementKind_MOVEMENT_KIND_ADJUST, req.Msg.GetReason(), "", actor)

		return err
	})
	if err != nil {
		return nil, writeError(err)
	}

	level := &inventory_service_models.StockLevel{
		WarehouseID: warehouseID,
		ProductID:   productID,
		RackID:      unplaced,
		OnHand:      target,
	}

	return connect.NewResponse(&inventoryv1.StockAdjustResponse{
		Movement: movementToProto(mv),
		Level:    levelToProto(level),
	}), nil
}
