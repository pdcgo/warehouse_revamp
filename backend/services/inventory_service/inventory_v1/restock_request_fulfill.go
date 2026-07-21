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
		type placement struct {
			rack     *uint64
			quantity int64
		}

		type countedLine struct {
			quantity   int64
			placements []placement
			damaged    []inventory_service_models.RestockDamagedUnit
		}

		counted := make(map[uint64]countedLine, len(req.Msg.GetLines()))

		for _, line := range req.Msg.GetLines() {
			if _, dup := counted[line.GetItemId()]; dup {
				return errRestockCountIncomplete
			}

			cl := countedLine{quantity: line.GetReceivedQuantity()}

			// WHERE IT WENT (#137/#154). Goods that arrived are somewhere, and the system is told
			// rather than left to guess — but a line can now name SEVERAL shelves, because a delivery
			// of 100 does not go on one.
			//
			// The placements must SUM to the count beside them. A person who says "8 arrived" and then
			// puts 7 away has made a mistake in one of the two, and which one is not knowable from
			// here: refused, never interpreted, exactly as an incomplete count is (#133).
			var placed int64

			seenRack := make(map[uint64]struct{}, len(line.GetPlacements()))
			// The unplaced pile is a place like any other, so it also gets named at most once — and
			// nil cannot be a map key, so it is tracked separately.
			var seenUnplaced bool

			for _, p := range line.GetPlacements() {
				var rack *uint64

				if id := p.GetRackId(); id != 0 {
					if _, dup := seenRack[id]; dup {
						return errRestockPlacementDuplicate
					}

					seenRack[id] = struct{}{}

					// The shelf must belong to the ACCEPTING warehouse — another warehouse's rack reads
					// as NotFound, or the error itself would confirm the id exists.
					exists, checkErr := rackExists(tx, warehouseID, id)
					if checkErr != nil {
						return checkErr
					}

					if !exists {
						return errRackMissing
					}

					rack = &id
				} else {
					if !p.GetUnplaced() {
						// Neither arm of the oneof was set: a placement that names no place at all.
						return errRestockLineNoPlace
					}

					if seenUnplaced {
						return errRestockPlacementDuplicate
					}

					seenUnplaced = true
				}

				placed += p.GetQuantity()

				cl.placements = append(cl.placements, placement{rack: rack, quantity: p.GetQuantity()})
			}

			// Checked BEFORE the sum, so the clearer error wins. Naming no place at all and naming
			// places that come up short are different mistakes, and "you did not say where it went"
			// is what the person actually needs to hear.
			if cl.quantity > 0 && len(cl.placements) == 0 {
				return errRestockLineNoPlace
			}

			// A line counted 0 owes no placement — and must not have one either, which the sum check
			// enforces without needing a case of its own: 0 placed against 0 counted agrees.
			if placed != cl.quantity {
				return errRestockPlacementMismatch
			}

			// WHAT ARRIVED BROKEN (#154). Never enters stock, so it is recorded and nothing else.
			for _, d := range line.GetDamaged() {
				cl.damaged = append(cl.damaged, inventory_service_models.RestockDamagedUnit{
					Quantity: d.GetQuantity(),
					Reason:   d.GetReason(),
					Value:    d.GetValue(),
				})
			}

			counted[line.GetItemId()] = cl
		}

		if len(counted) != len(rr.Items) {
			return errRestockCountIncomplete
		}

		actor := actorFrom(ctx)

		// EVERY line is received, inside this one transaction: a request half-received is worse than
		// one not received at all, and the status flip below must mean all of it landed (#124).
		for i := range rr.Items {
			item := rr.Items[i]

			line, ok := counted[item.ID]
			if !ok {
				// The lengths match but the ids do not, so the caller counted a line belonging to some
				// other request while leaving one of this request's uncounted.
				return errRestockCountIncomplete
			}

			rr.Items[i].ReceivedQuantity = line.quantity

			countErr := tx.
				Model(&inventory_service_models.RestockRequestItem{}).
				Where("id = ?", item.ID).
				Updates(map[string]any{
					"received_quantity": line.quantity,
					"updated_at":        time.Now(),
				}).
				Error
			if countErr != nil {
				return countErr
			}

			// WHAT ARRIVED BROKEN (#154), recorded before the stock moves so a failure here cannot
			// leave goods on a shelf with their losses unwritten. These units never enter stock: they
			// are not sellable, and stock that cannot be sold is stock that fails at the shelf.
			for _, d := range line.damaged {
				d.RestockRequestItemID = item.ID

				damageErr := tx.Create(&d).Error
				if damageErr != nil {
					return damageErr
				}

				rr.Items[i].Damaged = append(rr.Items[i].Damaged, d)
			}

			// A line that brought nothing usable moves no stock. It is still counted (0 is recorded
			// above and stays on the record), but a zero movement would be a ledger entry saying
			// nothing happened — worse than no entry, because it reads as a receipt.
			if line.quantity == 0 {
				continue
			}

			// ONE MOVEMENT PER PLACE (#154). Straight onto the shelves the warehouse named, because
			// counting and shelving are one act (#137) — and a delivery of 100 across three shelves is
			// three ledger rows, not one row averaging a location it never sat in.
			//
			// A nil rack is the warehouse saying "unplaced" out loud — a legal answer for goods it has
			// not shelved yet — not a value nobody supplied.
			for _, p := range line.placements {
				balance, applyErr := applyDelta(tx, rr.WarehouseID, item.ProductID, p.rack, p.quantity)
				if applyErr != nil {
					return applyErr
				}

				_, moveErr := appendMovement(
					tx,
					rr.WarehouseID,
					item.ProductID,
					p.rack,
					p.quantity,
					balance,
					inventoryv1.MovementKind_MOVEMENT_KIND_RECEIVE,
					"restock request",
					rr.ShippingCode,
					actor,
				)
				if moveErr != nil {
					return moveErr
				}

				stored := inventory_service_models.RestockReceivedPlacement{
					RestockRequestItemID: item.ID,
					RackID:               p.rack,
					Quantity:             p.quantity,
				}

				placeErr := tx.Create(&stored).Error
				if placeErr != nil {
					return placeErr
				}

				rr.Items[i].Placements = append(rr.Items[i].Placements, stored)
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
