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

	// WHAT THIS DELIVERY COST THE WAREHOUSE (00021), validated before anything is written: a bad line
	// must not be discovered halfway through receiving goods onto shelves.
	//
	// The pair rule protovalidate cannot express — OTHER needs a note — is checked here, because a
	// constraint between two fields is not a constraint on either one of them.
	costLines := make([]inventory_service_models.RestockCostLine, 0, len(req.Msg.GetCostLines()))
	var costLineTotal int64

	for _, line := range req.Msg.GetCostLines() {
		kind := restockCostKindToText(line.GetKind())
		if kind == "" {
			return nil, connect.NewError(connect.CodeInvalidArgument, errCostLineKind)
		}

		note := line.GetNote()
		if kind == restockCostOther && note == "" {
			return nil, connect.NewError(connect.CodeInvalidArgument, errCostLineNote)
		}

		costLines = append(costLines, inventory_service_models.RestockCostLine{
			Kind:   kind,
			Amount: line.GetAmount(),
			Note:   note,
		})
		costLineTotal += line.GetAmount()
	}

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

			// WHAT ARRIVED BROKEN OR LOST (#154). Never enters stock, so it is recorded and nothing else.
			for _, d := range line.GetDamaged() {
				cl.damaged = append(cl.damaged, inventory_service_models.RestockDamagedUnit{
					Quantity:   d.GetQuantity(),
					Reason:     d.GetReason(),
					DamageType: restockDamageTypeToText(d.GetType()),
				})
			}

			counted[line.GetItemId()] = cl
		}

		if len(counted) != len(rr.Items) {
			return errRestockCountIncomplete
		}

		actor := actorFrom(ctx)

		// THE FROZEN COST each batch will carry (#209). A batch is a cost layer, and its unit cost is
		// the HPP StockCost computes — line total per sellable unit, plus this delivery's freight spread
		// over every sellable unit that arrived. Frozen here, at acceptance, rather than recomputed on
		// read: a later delivery's price must not rewrite what this layer cost. Same integer-floor
		// arithmetic as stock_cost.go's unitCosts, scoped to THIS request.
		var sellableTotal int64
		for _, cl := range counted {
			sellableTotal += cl.quantity
		}

		// EVERY OUTLAY IS FREIGHT. `shipping_cost` is what the requesting team already paid to have the
		// goods sent; the cost lines are what the warehouse paid to get them in. Different pockets,
		// same question here — getting the goods here is part of what they cost, so all of it feeds the
		// HPP that becomes an order's COGS. Who is out of pocket is settled below, not in the cost.
		freight := rr.ShippingCost + costLineTotal

		var freightPerUnit int64
		if sellableTotal > 0 {
			freightPerUnit = freight / sellableTotal
		}

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

			// MINT THE BATCH for this received line (#209) — one product's units from one delivery, the
			// cost layer they carry. The line IS the batch (#207): its id is what makes that unique. The
			// units then place as shelf_batch rows below, mirroring the restock_received_placements.
			var damagedQty int64
			for _, d := range line.damaged {
				damagedQty += d.Quantity
			}

			unitCost := item.TotalPrice/line.quantity + freightPerUnit

			batch := inventory_service_models.StockBatch{
				WarehouseID:          rr.WarehouseID,
				ProductID:            item.ProductID,
				DeliveryID:           rr.ID,
				RestockRequestItemID: item.ID,
				UnitCost:             &unitCost,
				// Arrived is what physically turned up on the line — the sellable count plus the breakage
				// that never entered stock. Ready (= Σ shelf_batch.qty) equals line.quantity right now.
				ArrivedQty: line.quantity + damagedQty,
				DamagedQty: damagedQty,
				// The same actor the request itself now records as its acceptor, written in this one
				// transaction so a batch and its delivery can never name two different people.
				AcceptedBy: actor,
				// WHEN it was accepted. Stamped explicitly, even though the column DEFAULTs to NOW():
				// AcceptedAt is a non-pointer time.Time, so GORM includes it in the INSERT whatever its
				// value, and the zero value wins over the default. Every batch written before this read
				// as accepted in the year 1 — invisible on a detail page that only prints a date, and
				// wrong the moment anything sorted or aggregated on it.
				AcceptedAt: time.Now(),
			}

			batchErr := tx.Create(&batch).Error
			if batchErr != nil {
				return batchErr
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
					&batch.ID,
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

				// The batch's units on THIS shelf — the (shelf × batch) grain the stock feature turns on
				// (#209). Mirrors the placement row above; on-hand for a (product, rack) is the sum of
				// these across the batches on it.
				shelf := inventory_service_models.StockShelfBatch{
					BatchID: batch.ID,
					RackID:  p.rack,
					Qty:     p.quantity,
				}

				shelfErr := tx.Create(&shelf).Error
				if shelfErr != nil {
					return shelfErr
				}
			}
		}

		rr.Status = restockStatusFulfilled

		// WHO COUNTED IT, AND WHEN (owner) — the same actor and moment the batches above record, so a
		// delivery and its cost layers can never disagree about who accepted them. Stamped rather than
		// read back off `updated_at`, which any later write would move.
		acceptedAt := time.Now()

		rr.AcceptedByUserID = actor
		rr.AcceptedAt = &acceptedAt

		// WHAT THE DELIVERY COST THE WAREHOUSE (00021), in the same transaction as the goods it was
		// spent on. The lines were validated before the transaction opened; here they only need the
		// delivery, the person and the moment — the same three the acceptance itself records.
		//
		// They are written even though `freight` already used their total, because the total is not the
		// record: "the requesting team owes 180.000" is unanswerable without the lines that say why.
		for i := range costLines {
			costLines[i].RestockRequestID = rr.ID
			costLines[i].ActorID = actor
			costLines[i].CreatedAt = acceptedAt

			costErr := tx.Create(&costLines[i]).Error
			if costErr != nil {
				return costErr
			}
		}

		rr.CostLines = costLines

		statusErr := tx.
			Model(&rr).
			Updates(map[string]any{
				"status":              restockStatusFulfilled,
				"accepted_by_user_id": actor,
				"accepted_at":         acceptedAt,
				"updated_at":          acceptedAt,
			}).
			Error
		if statusErr != nil {
			return statusErr
		}

		// WHAT THE WAREHOUSE PAID, AS ITS OWN STEP (owner) — written FIRST, so the timeline reads "paid
		// for the delivery, then counted the goods in". That is the order it physically happened: the
		// money changes hands before the box is open, and the acceptance is what it bought.
		//
		// Two steps rather than one because they are two claims about two different pockets. ACCEPTED
		// says goods landed; this says the warehouse is out of pocket for goods it does not own, which
		// is exactly the debt PostRestockOutlay records below (#184). Folded into the acceptance, the
		// payment is invisible on the requesting team's timeline — and that team has to settle it.
		//
		// It shares `acceptedAt` with the acceptance rather than taking its own time.Now(): both are the
		// same act. The ORDER comes from the insert order — Detail sorts by `at ASC, id ASC`, so the row
		// written first reads first when the second is the same.
		//
		// Nothing is written when there are no cost lines, on the same reasoning that stops the ledger
		// posting below: most deliveries cost the warehouse nothing, and a step saying "paid nothing" is
		// a claim about an event that did not occur.
		if costLineTotal > 0 {
			costEventErr := recordRestockEvent(tx, rr.ID, restockEventCostRecorded, actor, acceptedAt)
			if costEventErr != nil {
				return costEventErr
			}
		}

		// The delivery's entry in the history (00019), carrying the SAME instant as `accepted_at` above
		// — the timeline and the accepted-date filter must name the same second.
		acceptEventErr := recordRestockEvent(tx, rr.ID, restockEventAccepted, actor, acceptedAt)
		if acceptEventErr != nil {
			return acceptEventErr
		}

		// THE OBLIGATION THE OUTLAY CREATES (#184), in this same transaction.
		//
		// The warehouse has just paid for a delivery of goods it does not own, so the requesting team
		// owes it that money. Until now the number reached the order's COGS and stopped there —
		// correct for costing, and completely silent on who is owed it or whether it was ever repaid.
		//
		// ⚠ THIS DOES NOT CHANGE WHAT THE COSTS DO TODAY. They still flow into HPP and into the
		// order's COGS; that is *costing* and it stays. Liability adds the missing half. The same
		// rupiah answers two different questions, and recording it here must not remove it from the
		// other.
		//
		// ONE ENTRY FOR THE WHOLE DELIVERY, not one per line. What the team owes is a single debt for
		// a single delivery; the lines are the answer to "why", and they live on the restock beside the
		// goods they arrived with.
		//
		// In the transaction rather than after it, because the failure it prevents is the exact
		// situation this whole service exists to fix: goods on the shelf, money out of the warehouse's
		// pocket, and no record that anybody owes it.
		//
		// A total of 0 posts NOTHING. Most deliveries cost the warehouse nothing, and an entry of zero
		// would be a ledger row saying nothing happened — worse than no row, because it reads as a debt
		// of nothing rather than the absence of one.
		if costLineTotal > 0 {
			return s.liability.PostRestockOutlay(
				ctx, tx, rr.RequestingTeamID, rr.WarehouseID, rr.ID, costLineTotal)
		}

		return nil
	})
	if err != nil {
		return nil, restockErr(err)
	}

	return connect.NewResponse(&inventoryv1.RestockRequestFulfillResponse{
		Request: restockRequestToProto(&rr),
	}), nil
}
