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

// RestockRequestAccept is the receiving WAREHOUSE counting the box in (any-warehouse-member-counts-what-arrived): per
// line, what is in the box and how many of those are broken; the short units are the difference, written as MISSING
// (a-short-unit-at-the-door-is-missing). The good units become stock on the placements named, in ONE transaction with
// the status — the restock row is locked first, and only an ongoing or arrived restock is accepted
// (accept-locks-the-restock).
//
// More in the box than the line says is refused: the selling team adds the extra by an edit first
// (accept-refuses-more-than-the-line-says, extra-units-are-added-by-the-selling-teams-edit).
func (s *Service) RestockRequestAccept(
	ctx context.Context,
	req *connect.Request[inventoryv1.RestockRequestAcceptRequest],
) (*connect.Response[inventoryv1.RestockRequestAcceptResponse], error) {
	warehouseID := req.Msg.GetTeamId()

	// THE COURIER'S CHARGE AT THE DOOR — one per restock, with its note (the-courier-is-paid-once-per-restock). Checked
	// before anything is written: the note rule spans two fields, which protovalidate cannot express.
	courierCharge := req.Msg.GetWarehouseAdditionalCost()
	courierNote := req.Msg.GetWarehouseAdditionalCostNote()

	if courierCharge > 0 && courierNote == "" {
		return nil, restockErr(errRestockCostNoteMissing)
	}

	var rr inventory_service_models.RestockRequest

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		loadErr := tx.
			Clauses(clause.Locking{Strength: "UPDATE"}).
			// The lock is on the restock row — the SAME lock cancel takes, so an accept and a cancel at the same
			// second queue on it and the second sees what the first did. Lines load separately (FOR UPDATE and a
			// join do not mix).
			Preload("Items", func(db *gorm.DB) *gorm.DB { return db.Order("id ASC") }).
			Where("id = ? AND warehouse_id = ?", req.Msg.GetRequestId(), warehouseID).
			First(&rr).
			Error
		if loadErr != nil {
			return loadErr
		}

		if rr.Status != restockStatusOngoing && rr.Status != restockStatusArrived {
			return errRestockNotAcceptable
		}

		if len(rr.Items) == 0 {
			return errRestockNoItems
		}

		type placement struct {
			rack     uint64
			quantity int64
		}

		type countedLine struct {
			received    int64
			broken      int64
			brokenNote  string
			missingNote string
			placements  []placement
		}

		counted := make(map[uint64]countedLine, len(req.Msg.GetLines()))

		for _, line := range req.Msg.GetLines() {
			if _, dup := counted[line.GetItemId()]; dup {
				return errRestockCountIncomplete
			}

			cl := countedLine{
				received:    line.GetReceivedCount(),
				broken:      line.GetBrokenCount(),
				brokenNote:  line.GetBrokenNote(),
				missingNote: line.GetMissingNote(),
			}

			if cl.broken > cl.received {
				return errRestockBrokenOverReceived
			}

			// WHERE THE GOOD UNITS WENT. Every unit in stock is on a placement (there-is-no-unplaced-pile), each named
			// once, and together they hold exactly received − broken.
			var placed int64

			seen := make(map[uint64]struct{}, len(line.GetPlacements()))

			for _, p := range line.GetPlacements() {
				id := p.GetPlacementId()

				if _, dup := seen[id]; dup {
					return errRestockPlacementDuplicate
				}

				seen[id] = struct{}{}

				// A placement of the ACCEPTING warehouse — another warehouse's reads as NotFound.
				exists, checkErr := rackExists(tx, warehouseID, id)
				if checkErr != nil {
					return checkErr
				}

				if !exists {
					return errRackMissing
				}

				placed += p.GetQuantity()

				cl.placements = append(cl.placements, placement{rack: id, quantity: p.GetQuantity()})
			}

			good := cl.received - cl.broken

			if good > 0 && len(cl.placements) == 0 {
				return errRestockLineNoPlace
			}

			if placed != good {
				return errRestockPlacementMismatch
			}

			counted[line.GetItemId()] = cl
		}

		if len(counted) != len(rr.Items) {
			return errRestockCountIncomplete
		}

		// Nothing above the line's count — checked against the line, which only the loaded rows know.
		for i := range rr.Items {
			line, ok := counted[rr.Items[i].ID]
			if !ok {
				return errRestockCountIncomplete
			}

			if line.received > rr.Items[i].Quantity {
				return errRestockOverCount
			}
		}

		actor := actorFrom(ctx)

		// THE FROZEN COST each batch carries (#209), one batch per line with good units (one-batch-per-line). Same
		// integer-floor arithmetic as stock_cost.go's unitCosts, scoped to THIS restock: line total per good unit,
		// plus the freight spread over every good unit. The courier's charge is part of what the goods cost to get
		// here (the-couriers-ask-is-in-the-unit-price) — outside the restock's total, inside the unit price.
		var goodTotal int64
		for _, cl := range counted {
			goodTotal += cl.received - cl.broken
		}

		freight := rr.ShippingCost + courierCharge

		var freightPerUnit int64
		if goodTotal > 0 {
			freightPerUnit = freight / goodTotal
		}

		for i := range rr.Items {
			item := rr.Items[i]
			line := counted[item.ID]
			good := line.received - line.broken

			// `received_quantity` stores the GOOD units, as it always has; the contract reads received_count back as
			// good + broken (restockRequestToProto).
			rr.Items[i].ReceivedQuantity = good

			countErr := tx.
				Model(&inventory_service_models.RestockRequestItem{}).
				Where("id = ?", item.ID).
				Updates(map[string]any{
					"received_quantity": good,
					"updated_at":        time.Now(),
				}).
				Error
			if countErr != nil {
				return countErr
			}

			// THE PROBLEM ROWS, written before stock moves: broken as typed, missing worked out. Their worth is filled
			// from the line on read (the-problem-price-is-filled-by-the-system), never typed here.
			problems := make([]inventory_service_models.RestockDamagedUnit, 0, 2)

			if line.broken > 0 {
				problems = append(problems, inventory_service_models.RestockDamagedUnit{
					RestockRequestItemID: item.ID,
					Quantity:             line.broken,
					Reason:               noteOr(line.brokenNote, restockProblemBrokenDefaultNote),
					DamageType:           restockProblemBroken,
				})
			}

			if missing := item.Quantity - line.received; missing > 0 {
				problems = append(problems, inventory_service_models.RestockDamagedUnit{
					RestockRequestItemID: item.ID,
					Quantity:             missing,
					Reason:               noteOr(line.missingNote, restockProblemMissingDefaultNote),
					DamageType:           restockProblemMissing,
				})
			}

			for p := range problems {
				problemErr := tx.Create(&problems[p]).Error
				if problemErr != nil {
					return problemErr
				}

				rr.Items[i].Damaged = append(rr.Items[i].Damaged, problems[p])
			}

			// A line that brought nothing good moves no stock and mints no batch.
			if good == 0 {
				continue
			}

			unitCost := item.TotalPrice/good + freightPerUnit

			// ⚠ THE BATCH KEEPS ITS OLD BUCKETS until the backend step reshapes `stock_batches`. Its reads
			// (batch_detail.go's lostExpr) take `lost` from the line's MISSING rows (stored as 'lost') and count it
			// INSIDE arrived and damaged — arrived = broken + lost + used + ready. Leaving the missing out here made a
			// short line with nothing broken read as broken −1, so the missing are counted in, exactly as every batch
			// accepted before the rewrite was.
			missing := item.Quantity - line.received

			batch := inventory_service_models.StockBatch{
				WarehouseID:          rr.WarehouseID,
				ProductID:            item.ProductID,
				DeliveryID:           rr.ID,
				RestockRequestItemID: item.ID,
				UnitCost:             &unitCost,
				// The line's units: the good, the broken and the missing. Only the good became stock.
				ArrivedQty: line.received + missing,
				DamagedQty: line.broken + missing,
				AcceptedBy: actor,
				// Stamped explicitly: a zero time.Time would win over the column's DEFAULT NOW().
				AcceptedAt: time.Now(),
			}

			batchErr := tx.Create(&batch).Error
			if batchErr != nil {
				return batchErr
			}

			// ONE MOVEMENT PER PLACEMENT — counting and shelving are one act.
			for _, p := range line.placements {
				rack := p.rack

				balance, applyErr := applyDelta(tx, rr.WarehouseID, item.ProductID, &rack, p.quantity)
				if applyErr != nil {
					return applyErr
				}

				_, moveErr := appendMovement(
					tx,
					rr.WarehouseID,
					item.ProductID,
					&rack,
					&batch.ID,
					p.quantity,
					balance,
					inventoryv1.MovementKind_MOVEMENT_KIND_RECEIVE,
					"restock request",
					rr.Receipt,
					actor,
				)
				if moveErr != nil {
					return moveErr
				}

				stored := inventory_service_models.RestockReceivedPlacement{
					RestockRequestItemID: item.ID,
					RackID:               &rack,
					Quantity:             p.quantity,
				}

				placeErr := tx.Create(&stored).Error
				if placeErr != nil {
					return placeErr
				}

				rr.Items[i].Placements = append(rr.Items[i].Placements, stored)

				shelf := inventory_service_models.StockShelfBatch{
					BatchID: batch.ID,
					RackID:  &rack,
					Qty:     p.quantity,
				}

				shelfErr := tx.Create(&shelf).Error
				if shelfErr != nil {
					return shelfErr
				}
			}
		}

		rr.Status = restockStatusAccepted

		acceptedAt := time.Now()

		rr.AcceptedByUserID = actor
		rr.AcceptedAt = &acceptedAt

		// The courier's charge, stored as the restock's one cost line beside the goods it was paid for.
		if courierCharge > 0 {
			cost := inventory_service_models.RestockCostLine{
				RestockRequestID: rr.ID,
				Kind:             restockCostIncidental,
				Amount:           courierCharge,
				Note:             courierNote,
				ActorID:          actor,
				CreatedAt:        acceptedAt,
			}

			costErr := tx.Create(&cost).Error
			if costErr != nil {
				return costErr
			}

			rr.CostLines = []inventory_service_models.RestockCostLine{cost}
		}

		statusErr := tx.
			Model(&rr).
			Updates(map[string]any{
				"status":              restockStatusAccepted,
				"accepted_by_user_id": actor,
				"accepted_at":         acceptedAt,
				"updated_at":          acceptedAt,
			}).
			Error
		if statusErr != nil {
			return statusErr
		}

		// The trail: the charge first, then the acceptance — the money changes hands before the box is opened.
		if courierCharge > 0 {
			costEventErr := recordRestockEvent(tx, rr.ID, restockEventCostRecorded, actor, acceptedAt)
			if costEventErr != nil {
				return costEventErr
			}
		}

		acceptEventErr := recordRestockEvent(tx, rr.ID, restockEventAccepted, actor, acceptedAt)
		if acceptEventErr != nil {
			return acceptEventErr
		}

		// WHAT THE SELLING TEAM NOW OWES THE WAREHOUSE for the charge, in this same transaction — a debt must never
		// ride an event that can be lost (the-couriers-debt-is-written-in-the-accept). Nothing is posted for 0.
		if courierCharge > 0 {
			return s.liability.PostRestockOutlay(
				ctx, tx, rr.RequestingTeamID, rr.WarehouseID, rr.ID, actor, courierCharge)
		}

		return nil
	})
	if err != nil {
		return nil, restockErr(err)
	}

	// AFTER the commit, never inside: downstream folds must not be able to fail the accept.
	s.publishAccepted(ctx, &rr)

	return connect.NewResponse(&inventoryv1.RestockRequestAcceptResponse{
		Request: restockRequestToProto(&rr),
	}), nil
}

// noteOr is the warehouse's note, or the words stored in its place while the column still refuses an empty one.
func noteOr(note, fallback string) string {
	if note == "" {
		return fallback
	}

	return note
}
