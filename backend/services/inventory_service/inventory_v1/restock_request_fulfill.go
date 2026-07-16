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
			// The lock is on the request row; its lines are loaded separately (FOR UPDATE and a join
			// do not mix), which is safe because the PENDING guard below is what serialises fulfils.
			Preload("Items", func(db *gorm.DB) *gorm.DB { return db.Order("id ASC") }).
			Where("id = ? AND warehouse_id = ?", req.Msg.GetRequestId(), warehouseID).
			First(&rr).
			Error
		if loadErr != nil {
			return loadErr
		}

		if rr.Status != restockStatusPending {
			return errRestockNotPending
		}

		// A request with no lines receives nothing — that is a broken row, not a no-op fulfil.
		if len(rr.Items) == 0 {
			return errRestockNoItems
		}

		actor := actorFrom(ctx)

		// EVERY line is received, inside this one transaction: a request half-received is worse than
		// one not received at all, and the status flip below must mean all of it landed (#124).
		for i := range rr.Items {
			item := rr.Items[i]

			balance, applyErr := applyDelta(tx, rr.WarehouseID, item.ProductID, item.Quantity)
			if applyErr != nil {
				return applyErr
			}

			_, moveErr := appendMovement(
				tx,
				rr.WarehouseID,
				item.ProductID,
				item.Quantity,
				balance,
				inventoryv1.MovementKind_MOVEMENT_KIND_RECEIVE,
				"restock request",
				rr.ShippingCode,
				actor,
			)
			if moveErr != nil {
				return moveErr
			}
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
