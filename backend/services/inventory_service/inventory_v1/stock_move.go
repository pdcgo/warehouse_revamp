package inventory_v1

import (
	"context"
	"errors"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// A move has to go somewhere else (#136). Moving stock onto the place it already sits is not a
// correction or a no-op worth recording — it is a mistake, and honouring it would write a ledger PAIR
// that says nothing happened twice.
var errMoveSamePlace = errors.New("a move must have two different places")

// Both ends of a move must be NAMED. An absent place and "unplaced" are both nil by the time they
// reach the stock primitives, so an unanswered end would silently become a real answer — goods moved
// to or from a pile nobody named.
var errMoveNoPlace = errors.New("a move must say both where the stock is and where it is going")

// StockMove moves stock from one place to another INSIDE one warehouse (#136): shelving what arrived,
// or re-organising a shelf. The warehouse's TOTAL never changes — only where the goods sit — and that
// is what makes this a different fact from a receive.
//
// It is one verb for both jobs the issue names, because they are one act with different arguments:
// `from: unplaced → to: rack` shelves what arrived, `from: rack → to: rack` re-organises. Nothing
// about the mechanics differs, so splitting them would be two handlers with one body.
//
// Both legs land in ONE transaction. A move that took stock off a shelf without putting it anywhere
// would be worse than no move at all — it would destroy goods that are physically in the building —
// so the two applyDelta calls and their ledger rows commit together or not at all.
//
// Ordering matters: the source is decremented FIRST. applyDelta's guard refuses to take a place below
// zero, so doing the take first means an over-move is rejected before anything has been credited
// anywhere. Crediting first and discovering the source was short would leave the transaction to roll
// back — correct, but it would have written a positive movement for goods that were never there.
func (s *Service) StockMove(
	ctx context.Context,
	req *connect.Request[inventoryv1.StockMoveRequest],
) (*connect.Response[inventoryv1.StockMoveResponse], error) {
	warehouseID := req.Msg.GetWarehouseId()
	productID := req.Msg.GetProductId()
	qty := req.Msg.GetQuantity()
	actor := actorFrom(ctx)

	// Which batch's units are moving (#210). 0 keeps the pre-batch behaviour; a real batch relocates the
	// shelf_batch rows too and rides on both ledger legs.
	batchID := req.Msg.GetBatchId()

	var batchPtr *uint64
	if batchID != 0 {
		batchPtr = &batchID
	}

	// Both ends must be NAMED. Proto validation requires them, but this re-checks rather than reading
	// the zero value, because an absent place is indistinguishable from "unplaced" once it reaches
	// placeRack — both are nil — and silently moving goods to or from a pile nobody named is exactly
	// the guess this RPC exists to refuse. Unit tests bypass the validation interceptor, so without
	// this the guard would be enforced only in production (cf. StockAdjust, #139).
	if req.Msg.GetFrom().GetPlace() == nil || req.Msg.GetTo().GetPlace() == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errMoveNoPlace)
	}

	from := placeRack(req.Msg.GetFrom())
	to := placeRack(req.Msg.GetTo())

	if samePlace(from, to) {
		return nil, connect.NewError(connect.CodeInvalidArgument, errMoveSamePlace)
	}

	var fromMv, toMv *inventory_service_models.StockMovement

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// Every named rack must belong to THIS warehouse. Checked for both ends before anything moves:
		// another warehouse's rack reads as NotFound, never PermissionDenied, or the error would
		// confirm the id exists.
		for _, rack := range []*uint64{from, to} {
			if rack == nil {
				continue
			}

			exists, checkErr := rackExists(tx, warehouseID, *rack)
			if checkErr != nil {
				return checkErr
			}

			if !exists {
				return errRackMissing
			}
		}

		// A named batch relocates the (shelf × batch) rows too, and must belong to this warehouse's this
		// product — another product's or warehouse's batch reads as NotFound. Done before the shelf
		// totals move, so an over-move of a batch is refused before anything is credited anywhere.
		if batchID != 0 {
			ok, checkErr := batchBelongs(tx, warehouseID, productID, batchID)
			if checkErr != nil {
				return checkErr
			}
			if !ok {
				return errBatchMissing
			}

			moveErr := moveShelfBatch(tx, batchID, from, to, qty)
			if moveErr != nil {
				return moveErr
			}
		}

		fromBalance, err := applyDelta(tx, warehouseID, productID, from, -qty)
		if err != nil {
			return err
		}

		fromMv, err = appendMovement(tx, warehouseID, productID, from, batchPtr, -qty, fromBalance,
			inventoryv1.MovementKind_MOVEMENT_KIND_MOVE, req.Msg.GetReason(), "", actor)
		if err != nil {
			return err
		}

		toBalance, err := applyDelta(tx, warehouseID, productID, to, qty)
		if err != nil {
			return err
		}

		toMv, err = appendMovement(tx, warehouseID, productID, to, batchPtr, qty, toBalance,
			inventoryv1.MovementKind_MOVEMENT_KIND_MOVE, req.Msg.GetReason(), "", actor)

		return err
	})
	if err != nil {
		return nil, writeError(err)
	}

	return connect.NewResponse(&inventoryv1.StockMoveResponse{
		FromMovement: movementToProto(fromMv),
		ToMovement:   movementToProto(toMv),
	}), nil
}

// placeRack reads a StockPlace into the rack pointer the stock primitives take: a rack id, or nil for
// the unplaced pile. Proto validation makes the oneof required, so an absent place cannot reach here —
// and if one ever did, nil is the unplaced pile, which is a real place rather than a guess.
func placeRack(p *inventoryv1.StockPlace) *uint64 {
	if id := p.GetRackId(); id != 0 {
		return &id
	}

	return nil
}

// samePlace compares two places, counting unplaced as equal to itself — nil is a PLACE here, not a
// missing value, so two nils are the same shelf and not two unknowns.
func samePlace(a, b *uint64) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}

	return *a == *b
}

// batchBelongs reports whether a batch is this warehouse's this product — the scope check every
// batch-aware write makes before touching it, so a batch id cannot reach another building's stock.
func batchBelongs(tx *gorm.DB, warehouseID, productID, batchID uint64) (bool, error) {
	var n int64

	err := tx.
		Raw(`SELECT COUNT(*) FROM stock_batches WHERE id = ? AND warehouse_id = ? AND product_id = ?`,
			batchID, warehouseID, productID).
		Scan(&n).
		Error

	return n > 0, err
}

// moveShelfBatch relocates `qty` of one batch from one shelf to another (#210): debit the source —
// refused if it does not hold that many OF THE BATCH — then credit the destination. Both inside the
// caller's transaction, so this pair is atomic with the shelf-total move it accompanies.
func moveShelfBatch(tx *gorm.DB, batchID uint64, from, to *uint64, qty int64) error {
	res := tx.Exec(`
		UPDATE stock_shelf_batches SET qty = qty - ?, updated_at = NOW()
		WHERE batch_id = ? AND rack_id IS NOT DISTINCT FROM ? AND qty >= ?`,
		qty, batchID, from, qty)
	if res.Error != nil {
		return res.Error
	}

	if res.RowsAffected == 0 {
		return errInsufficientBatch
	}

	// Credit the destination — a new (batch, rack) row, or add to the one already there. NULLS NOT
	// DISTINCT on the unique index makes ON CONFLICT match the unplaced pile the same way.
	return tx.Exec(`
		INSERT INTO stock_shelf_batches (batch_id, rack_id, qty, updated_at)
		VALUES (?, ?, ?, NOW())
		ON CONFLICT (batch_id, rack_id) DO UPDATE SET
		    qty = stock_shelf_batches.qty + EXCLUDED.qty, updated_at = NOW()`,
		batchID, to, qty).Error
}
