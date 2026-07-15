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
		// Current on-hand, locked (0 if the level does not exist yet).
		var current int64

		err := tx.Raw(
			`SELECT on_hand FROM stock_levels WHERE warehouse_id = ? AND product_id = ? FOR UPDATE`,
			warehouseID, productID,
		).Scan(&current).Error
		if err != nil {
			return err
		}

		delta := target - current

		// Set on-hand to the counted target (not += delta) — the count is authoritative.
		err = tx.Exec(`
			INSERT INTO stock_levels (warehouse_id, product_id, on_hand, updated_at)
			VALUES (?, ?, ?, NOW())
			ON CONFLICT (warehouse_id, product_id)
			DO UPDATE SET on_hand = EXCLUDED.on_hand, updated_at = NOW()`,
			warehouseID, productID, target,
		).Error
		if err != nil {
			return err
		}

		mv, err = appendMovement(tx, warehouseID, productID, delta, target,
			inventoryv1.MovementKind_MOVEMENT_KIND_ADJUST, req.Msg.GetReason(), "", actor)

		return err
	})
	if err != nil {
		return nil, writeError(err)
	}

	level := &inventory_service_models.StockLevel{
		WarehouseID: warehouseID,
		ProductID:   productID,
		OnHand:      target,
	}

	return connect.NewResponse(&inventoryv1.StockAdjustResponse{
		Movement: movementToProto(mv),
		Level:    levelToProto(level),
	}), nil
}
