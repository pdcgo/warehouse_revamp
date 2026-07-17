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

// RestockRequestFulfill is called by the TARGET WAREHOUSE (#105): it receives the stock and marks the
// request fulfilled — in ONE transaction, so the stock movement and the status can't diverge. The
// request is loaded FOR UPDATE scoped to this warehouse (another warehouse's request reads as
// NotFound), and must be PENDING (a re-fulfil is rejected as FailedPrecondition). The stock is applied
// with the same primitives as StockReceive.
//
// Accepting IS COUNTING (#133). A request is a promise; the delivery is a fact, and the two disagree
// often enough that the system must not conflate them: the warehouse opens the box and says how many
// of each line actually turned up, and STOCK RECEIVES THAT NUMBER — never the number that was asked
// for. Receiving the ask on the warehouse's behalf would be inventing stock it does not have.
//
// A short count still FULFILS the request: the goods arrived, the delivery happened, and the request
// has done its job. The shortfall is not hidden by that — both numbers live on the line forever
// (quantity asked, received_quantity arrived), so the gap stays on the record for whoever chases the
// supplier. What a short count must never do is quietly become the ask.
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

		// The count must cover the request EXACTLY: every line, once, and nothing that is not on it.
		counted := make(map[uint64]int64, len(req.Msg.GetLines()))

		for _, line := range req.Msg.GetLines() {
			if _, dup := counted[line.GetItemId()]; dup {
				return errRestockCountIncomplete
			}

			counted[line.GetItemId()] = line.GetReceivedQuantity()
		}

		if len(counted) != len(rr.Items) {
			return errRestockCountIncomplete
		}

		actor := actorFrom(ctx)

		// EVERY line is received, inside this one transaction: a request half-received is worse than
		// one not received at all, and the status flip below must mean all of it landed (#124).
		for i := range rr.Items {
			item := rr.Items[i]

			received, ok := counted[item.ID]
			if !ok {
				// The lengths match but the ids do not, so the caller counted a line belonging to some
				// other request while leaving one of this request's uncounted.
				return errRestockCountIncomplete
			}

			rr.Items[i].ReceivedQuantity = received

			countErr := tx.
				Model(&inventory_service_models.RestockRequestItem{}).
				Where("id = ?", item.ID).
				Updates(map[string]any{"received_quantity": received, "updated_at": time.Now()}).
				Error
			if countErr != nil {
				return countErr
			}

			// A line that did not turn up moves no stock. It is still counted (0 is recorded above and
			// stays on the record), but a zero movement would be a ledger entry saying nothing happened
			// — which is worse than no entry, because it reads as a receipt.
			if received == 0 {
				continue
			}

			// Received UNPLACED (#135): accepting says what arrived, not where it was shelved. Whether
			// the warehouse names a rack while counting is #137's open call — until it is answered, the
			// goods land "somewhere in this warehouse", which is the truth, and put-away (#136) is what
			// moves them onto a shelf.
			balance, applyErr := applyDelta(tx, rr.WarehouseID, item.ProductID, unplaced, received)
			if applyErr != nil {
				return applyErr
			}

			_, moveErr := appendMovement(
				tx,
				rr.WarehouseID,
				item.ProductID,
				unplaced,
				received,
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
