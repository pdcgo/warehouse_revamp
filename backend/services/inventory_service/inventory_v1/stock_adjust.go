package inventory_v1

import (
	"context"
	"database/sql"
	"errors"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// A stock-take must say WHERE it counted (#139). Proto validation refuses this first; the error exists
// so a request arriving around it fails loudly rather than quietly correcting the unplaced pile.
var errAdjustNoPlace = errors.New("a stock-take must say which place it counted (a rack, or unplaced)")

// A batch reason (damaged/lost/found) must name its batch and a positive quantity (#211).
var errAdjustBatchArgs = errors.New("a damaged/lost/found adjust needs a batch and a positive quantity")

// StockAdjust corrects a shelf's stock (#139/#211). The REASON drives the model:
//
//   - RECOUNT (or unspecified, for back-compat) reconciles the whole shelf to a counted `on_hand`. It
//     is batch-agnostic on screen ("—"), but its delta is attributed to the OLDEST batch on the shelf
//     (FIFO, owner's Q1) so per-batch Ready keeps reconciling to on-hand.
//   - DAMAGED / LOST / FOUND touch a SPECIFIC batch's units by a signed `quantity`: goods of that batch
//     went bad, went missing, or turned up. They carry the batch and refuse to drive it below zero.
//
// Every reason writes one ADJUST movement (batch-tagged except a recount) so the correction is
// auditable, and returns the warehouse TOTAL after it — read back, not computed.
//
// A DAMAGED/LOST adjust MOVES MONEY TWICE, and both are wanted (#211, owner's Q4):
//
//   - the frozen cost of the lost units is WRITTEN OFF to expense_service — the warehouse's own P&L,
//     answering "what did our losses cost us". Posted AFTER the commit, best-effort.
//   - the same figure is a DEBT to the team that OWNS the goods (business_level §Warehouse 5) —
//     answering "who do we now have to pay". Posted INSIDE the transaction, because an obligation that
//     fails to commit leaves the owner's goods gone with nothing recorded.
//
// A FOUND adjust gives the reimbursement back as a REVERSAL against its own movement; the expense is
// not un-booked, because stock that turns up is not negative spending.
//
// ⚠ A RECOUNT HERE DOES NEITHER, AND THAT CONTRADICTS Q4, which says "a RECOUNT loss values at the
// oldest batch's cost". The behaviour below matches its test ("a RECOUNT is batch-agnostic
// value-wise"); the decision says otherwise, and the two have never been reconciled.
//
// StockOpname — which IS a recount, in bulk — follows Q4 on BOTH axes: it writes the value off and, as
// of 2026-08-20 (owner), reimburses the owner too. So RECOUNT is now the ONLY path of the three that
// books nothing, and the same physical loss still moves money or does not depending on which RPC
// counted it. Recorded in full under `# Contradiction` in plans/stock_service/brainstorming.md, with
// the recommendation to bring this branch in line — `attributeDeltaFIFOValued` now returns both
// numbers it would need (`Value` and `ByOwner`). Left alone here because changing a shipped, tested
// money path is the owner's call (HARD RULE 8).
func (s *Service) StockAdjust(
	ctx context.Context,
	req *connect.Request[inventoryv1.StockAdjustRequest],
) (*connect.Response[inventoryv1.StockAdjustResponse], error) {
	warehouseID := req.Msg.GetWarehouseId()
	productID := req.Msg.GetProductId()
	actor := actorFrom(ctx)

	if req.Msg.GetPlace() == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errAdjustNoPlace)
	}

	var rackID *uint64
	if id := req.Msg.GetRackId(); id != 0 {
		rackID = &id
	}

	reasonType := req.Msg.GetReasonType()
	batchReason := isBatchAdjust(reasonType)
	qtyMag := req.Msg.GetQuantity()

	var batchID uint64
	var batchPtr *uint64
	var batchDelta int64

	if batchReason {
		batchID = req.Msg.GetBatchId()
		if batchID == 0 || qtyMag <= 0 {
			return nil, connect.NewError(connect.CodeInvalidArgument, errAdjustBatchArgs)
		}

		batchPtr = &batchID
		// FOUND adds; DAMAGED and LOST remove. The magnitude is always positive on the wire.
		if reasonType == inventoryv1.StockAdjustReason_STOCK_ADJUST_REASON_FOUND {
			batchDelta = qtyMag
		} else {
			batchDelta = -qtyMag
		}
	}

	// A DAMAGED/LOST adjust writes off the value of the lost units (#211, owner's Q4): computed inside
	// the transaction from the batch's frozen cost, posted to expense AFTER it commits.
	var lossAmount int64
	var postLoss bool

	// And the DEBT it creates toward the team that owns the goods (business_level Â§Warehouse 5).
	// Posted inside the transaction, unlike the expense — see the call below.
	var (
		damageAmount   int64
		damageOwner    uint64
		damageReversal bool
	)

	var (
		mv    *inventory_service_models.StockMovement
		total int64
	)

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		if rackID != nil {
			exists, checkErr := rackExists(tx, warehouseID, *rackID)
			if checkErr != nil {
				return checkErr
			}
			if !exists {
				return errRackMissing
			}
		}

		var (
			delta   int64
			balance int64
			err     error
		)

		if batchReason {
			// The batch must be this warehouse's this product, and hold enough on the shelf to lose.
			ok, checkErr := batchBelongs(tx, warehouseID, productID, batchID)
			if checkErr != nil {
				return checkErr
			}
			if !ok {
				return errBatchMissing
			}

			adjErr := adjustShelfBatch(tx, batchID, rackID, batchDelta)
			if adjErr != nil {
				return adjErr
			}

			// THE VALUE OF THE UNITS, read for EVERY batch reason — a loss to write off, a find to give
			// back. An unknown-cost batch has no value either way (#74), so nothing is posted for it.
			//
			// The OWNER is read in the same query: the goods belong to the team that raised the restock
			// the batch was minted from, and that team is who the warehouse owes. Resolved here rather
			// than trusted from the caller, and inside the transaction, so it cannot drift from the
			// movement it is about to be charged against.
			var (
				unitCost sql.NullInt64
				owner    sql.NullInt64
			)

			costErr := tx.Raw(`
				SELECT b.unit_cost, r.requesting_team_id
				FROM stock_batches b
				JOIN restock_request_items ri ON ri.id = b.restock_request_item_id
				JOIN restock_requests r ON r.id = ri.restock_request_id
				WHERE b.id = ?`, batchID).Row().Scan(&unitCost, &owner)
			if costErr != nil {
				return costErr
			}

			if unitCost.Valid {
				value := qtyMag * unitCost.Int64

				// The EXPENSE is the warehouse's own P&L view, and only a loss is one. A find is not
				// negative spending — reversing it belongs to whatever reported the write-off.
				if reasonType != inventoryv1.StockAdjustReason_STOCK_ADJUST_REASON_FOUND {
					lossAmount = value
					postLoss = true
				}

				// The DEBT is the other half, and it has both directions. Stock nobody restocked here
				// has no owner to reimburse, which is why the owner must be present.
				if owner.Valid && owner.Int64 > 0 {
					damageAmount = value
					damageOwner = uint64(owner.Int64)
					damageReversal = reasonType == inventoryv1.StockAdjustReason_STOCK_ADJUST_REASON_FOUND
				}
			}

			delta = batchDelta
			balance, err = applyDelta(tx, warehouseID, productID, rackID, batchDelta)
			if err != nil {
				return err
			}
		} else {
			// RECOUNT — correct the shelf to the counted figure (absolute), and FIFO the difference onto
			// the oldest batch so shelf_batch stays reconciled.
			target := req.Msg.GetOnHand()

			var current int64
			err = tx.Raw(`
				SELECT on_hand FROM stock_levels
				WHERE warehouse_id = ? AND product_id = ? AND rack_id IS NOT DISTINCT FROM ?
				FOR UPDATE`,
				warehouseID, productID, rackID,
			).Scan(&current).Error
			if err != nil {
				return err
			}

			delta = target - current
			balance = target

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

			fifoErr := attributeDeltaFIFO(tx, warehouseID, productID, rackID, delta)
			if fifoErr != nil {
				return fifoErr
			}
		}

		mv, err = appendMovement(tx, warehouseID, productID, rackID, batchPtr, delta, balance,
			inventoryv1.MovementKind_MOVEMENT_KIND_ADJUST, req.Msg.GetReason(), "", actor)
		if err != nil {
			return err
		}

		// THE WAREHOUSE OWES THE OWNER for what it broke or lost, and is owed it back when the goods
		// turn up (business_level Â§Warehouse 5, balance_context 4 and 5).
		//
		// ⚠ INSIDE THE TRANSACTION, unlike the expense posting below — and the difference is the same
		// one SettlementPoster already draws. The expense is a DERIVED record: a dropped one is a gap a
		// report can find. This is an OBLIGATION: stock leaving the shelf while the debt for it does not
		// commit leaves the owning team's goods gone with nothing recorded, which is exactly the
		// situation the ledger exists to prevent.
		//
		// It needs the movement id, so it can only run once the movement exists — which is why it sits
		// here rather than beside the value lookup.
		//
		// ⚠ Damage at RECEIVING and on returned orders is NOT charged here (Â§Warehouse 6). Neither
		// travels this RPC: arrival breakage is a restock damage line, recorded before custody begins.
		if damageAmount > 0 && damageOwner != 0 && damageOwner != warehouseID {
			damageErr := s.settlement.PostStockDamage(ctx, tx, damageOwner, warehouseID, mv.ID,
				damageAmount, damageReversal)
			if damageErr != nil {
				return damageErr
			}
		}

		return tx.Raw(`
			SELECT COALESCE(SUM(on_hand), 0) FROM stock_levels
			WHERE warehouse_id = ? AND product_id = ?`,
			warehouseID, productID,
		).Scan(&total).Error
	})
	if err != nil {
		return nil, writeError(err)
	}

	// Post the loss value AFTER the stock left the shelf (#211). Best-effort by design: the correction
	// has committed regardless, and a dropped expense is a gap a report can find — not a reason to fail
	// a stock adjust because a downstream ledger hiccuped. See ExpensePoster.
	if postLoss && lossAmount > 0 {
		_ = s.expense.PostStockLoss(ctx, warehouseID, lossAmount, req.Msg.GetReason())
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

func isBatchAdjust(r inventoryv1.StockAdjustReason) bool {
	switch r {
	case inventoryv1.StockAdjustReason_STOCK_ADJUST_REASON_DAMAGED,
		inventoryv1.StockAdjustReason_STOCK_ADJUST_REASON_LOST,
		inventoryv1.StockAdjustReason_STOCK_ADJUST_REASON_FOUND:
		return true
	default:
		return false
	}
}

// adjustShelfBatch applies a SIGNED delta to one (batch, shelf) row (#211), creating it if the batch is
// arriving on a shelf it was not on (a FOUND). It refuses to drive the row below zero — you cannot lose
// more of a batch than the shelf holds.
func adjustShelfBatch(tx *gorm.DB, batchID uint64, rack *uint64, delta int64) error {
	err := tx.Exec(`
		INSERT INTO stock_shelf_batches (batch_id, rack_id, qty, updated_at)
		VALUES (?, ?, 0, NOW())
		ON CONFLICT (batch_id, rack_id) DO NOTHING`,
		batchID, rack).Error
	if err != nil {
		return err
	}

	res := tx.Exec(`
		UPDATE stock_shelf_batches SET qty = qty + ?, updated_at = NOW()
		WHERE batch_id = ? AND rack_id IS NOT DISTINCT FROM ? AND qty + ? >= 0`,
		delta, batchID, rack, delta)
	if res.Error != nil {
		return res.Error
	}

	if res.RowsAffected == 0 {
		return errInsufficientBatch
	}

	return nil
}

// attributeDeltaFIFO spreads a change in a shelf's on-hand over the batches sitting on it, oldest
// first (#211, owner's Q1). A gain lands on the oldest batch; a loss is drawn down the batches in age
// order. A shelf with no batch rows (legacy stock) is left to the stock_levels figure alone.
//
// Called by a recount, by a PICK and by the put-back that reverses one (#232). It was named for the
// recount while that was its only caller, and its own comment said a loss is drawn "the way a pick
// would" — which was true of the rule and not of the code: the pick never called it, so every draw
// left `stock_shelf_batches` untouched and every batch kept its arrival quantity as Ready forever.
// The warehouse's Prices and Batches tabs read that number, so both overstated stock by everything
// ever picked, and `used` (arrived − damaged − ready) stayed at 0 for goods that had shipped.
func attributeDeltaFIFO(tx *gorm.DB, warehouseID, productID uint64, rack *uint64, delta int64) error {
	_, err := attributeDeltaFIFOValued(tx, warehouseID, productID, rack, delta)

	return err
}

// fifoDraw is what a LOSS took out of the cost layers, in money.
//
// It exists because a shortfall found by counting is not only a quantity — the owner's Q4 makes it a
// value written off — and the only honest price for it is what the layers the draw actually consumed
// were worth.
type fifoDraw struct {
	// Whole rupiah consumed by a loss. 0 for a gain: stock that turns up is not a purchase.
	Value int64

	// ⚠ Whether `Value` is the WHOLE loss. A batch's `unit_cost` is nullable and nil means UNKNOWN,
	// never 0 (#74), and a shelf can also hold legacy stock with no batch rows at all. Either way some
	// units go out priced at nothing — so this false means "the loss is worth more than Value", which is
	// a different claim from "the loss was worth nothing", and a caller must be able to tell them apart.
	AllKnown bool

	// WHAT EACH OWNING TEAM LOST, keyed by team id — the reimbursement side of the same draw
	// (business_level §Warehouse 5).
	//
	// ⚠ ONE SHORTFALL CAN SPAN SEVERAL OWNERS. A shelf holds layers from whatever restocks filled it,
	// and a count that comes up 30 short may take 20 from one team's batch and 10 from another's.
	// Summing them into a single number would leave the second team unpaid, so the split is carried
	// rather than collapsed — it is the same reason `Value` is computed layer by layer.
	//
	// nil when nothing was lost. A team whose units all had an unknown cost is absent, not present as
	// 0: `AllKnown` is what says the picture is incomplete.
	ByOwner map[uint64]int64
}

// attributeDeltaFIFOValued is attributeDeltaFIFO, and additionally reports what a loss was WORTH.
//
// The two are one function rather than two because the valuation must consume exactly the layers the
// draw consumes. A second query that re-derived "the oldest batch's cost" would be a second definition
// of FIFO order, free to drift — and it would also be wrong whenever a shortfall spans more than one
// layer, pricing every missing unit at the oldest layer's cost when half of them came from a dearer one.
func attributeDeltaFIFOValued(
	tx *gorm.DB,
	warehouseID, productID uint64,
	rack *uint64,
	delta int64,
) (fifoDraw, error) {
	// Nothing moved, so nothing was consumed and there is nothing left unpriced.
	if delta == 0 {
		return fifoDraw{AllKnown: true}, nil
	}

	type sbRow struct {
		ID       uint64
		Qty      int64
		UnitCost sql.NullInt64
		// The team that raised the restock this layer was minted from — who owns the units, and who is
		// reimbursed if they go missing. A LEFT JOIN, because a batch whose restock chain is incomplete
		// still holds real stock that has to be drawn down; it simply has nobody to pay.
		OwnerTeamID sql.NullInt64
	}

	var rows []sbRow

	err := tx.Raw(`
		SELECT sb.id, sb.qty, b.unit_cost, r.requesting_team_id AS owner_team_id
		FROM stock_shelf_batches sb
		JOIN stock_batches b ON b.id = sb.batch_id
		LEFT JOIN restock_request_items ri ON ri.id = b.restock_request_item_id
		LEFT JOIN restock_requests r ON r.id = ri.restock_request_id
		WHERE b.warehouse_id = ? AND b.product_id = ? AND sb.rack_id IS NOT DISTINCT FROM ?
		ORDER BY b.id ASC`,
		warehouseID, productID, rack).Scan(&rows).Error
	if err != nil {
		return fifoDraw{}, err
	}

	if len(rows) == 0 {
		// Legacy stock: a level with no cost layers under it. A gain needs no layer, but a loss here has
		// gone out at a price nobody recorded — which the caller has to be told rather than shown as 0.
		return fifoDraw{AllKnown: delta > 0}, nil
	}

	if delta > 0 {
		err = tx.Exec(`UPDATE stock_shelf_batches SET qty = qty + ?, updated_at = NOW() WHERE id = ?`,
			delta, rows[0].ID).Error

		return fifoDraw{AllKnown: true}, err
	}

	// A loss: consume oldest-first until the shortfall is covered, pricing each layer as it goes.
	draw := fifoDraw{AllKnown: true}

	remaining := -delta
	for i := range rows {
		if remaining == 0 {
			break
		}

		take := rows[i].Qty
		if take > remaining {
			take = remaining
		}
		if take == 0 {
			continue
		}

		upErr := tx.Exec(`UPDATE stock_shelf_batches SET qty = qty - ?, updated_at = NOW() WHERE id = ?`,
			take, rows[i].ID).Error
		if upErr != nil {
			return fifoDraw{}, upErr
		}

		if rows[i].UnitCost.Valid {
			value := take * rows[i].UnitCost.Int64
			draw.Value += value

			// The reimbursement side, split by whoever owns this layer. Stock with no resolvable owner
			// is still written off — it just has nobody to pay, which is a different fact from
			// "worth nothing" and is why this is keyed rather than summed.
			if rows[i].OwnerTeamID.Valid && rows[i].OwnerTeamID.Int64 > 0 {
				if draw.ByOwner == nil {
					draw.ByOwner = map[uint64]int64{}
				}

				draw.ByOwner[uint64(rows[i].OwnerTeamID.Int64)] += value
			}
		} else {
			draw.AllKnown = false
		}

		remaining -= take
	}

	// The layers did not cover the whole shortfall — the level believed more than the batches did. Those
	// units leave unpriced, so the value reported is a floor.
	if remaining > 0 {
		draw.AllKnown = false
	}

	return draw, nil
}
