package inventory_v1

import (
	"context"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// RestockRequestFulfill is called by the TARGET WAREHOUSE (#105): it receives the requested stock and
// marks the request fulfilled — in ONE transaction, so the stock movement and the status can't
// diverge. The request is loaded FOR UPDATE scoped to this warehouse (another warehouse's request
// reads as NotFound), and must be PENDING (a re-fulfil is rejected as FailedPrecondition). The stock
// is applied with the same primitives as StockReceive.
func (s *Service) RestockRequestFulfill(
	ctx context.Context,
	req *connect.Request[inventoryv1.RestockRequestFulfillRequest],
) (*connect.Response[inventoryv1.RestockRequestFulfillResponse], error) {
	warehouseID := req.Msg.GetTeamId()

	var rr inventory_service_models.RestockRequest

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		loadErr := tx.
			Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND warehouse_id = ?", req.Msg.GetRequestId(), warehouseID).
			First(&rr).
			Error
		if loadErr != nil {
			return loadErr
		}

		if rr.Status != restockStatusPending {
			return errRestockNotPending
		}

		balance, applyErr := applyDelta(tx, rr.WarehouseID, rr.ProductID, rr.Quantity)
		if applyErr != nil {
			return applyErr
		}

		_, moveErr := appendMovement(
			tx,
			rr.WarehouseID,
			rr.ProductID,
			rr.Quantity,
			balance,
			inventoryv1.MovementKind_MOVEMENT_KIND_RECEIVE,
			"restock request",
			rr.ShippingCode,
			actorFrom(ctx),
		)
		if moveErr != nil {
			return moveErr
		}

		rr.Status = restockStatusFulfilled

		return tx.
			Model(&rr).
			Updates(map[string]any{"status": restockStatusFulfilled, "updated_at": time.Now()}).
			Error
	})
	if err != nil {
		return nil, restockErr(err)
	}

	return connect.NewResponse(&inventoryv1.RestockRequestFulfillResponse{
		Request: restockRequestToProto(&rr),
	}), nil
}
