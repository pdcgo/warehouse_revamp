package inventory_v1

import (
	"context"
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
// NOTE (#211): a DAMAGED/LOST adjust is also meant to WRITE OFF the frozen cost of the lost units to
// expense_service (owner's Q4). That value posting is a follow-up — this change lands the stock
// mechanics; the loss value is a separate cross-service hook (mirroring settlement's PostCODFee).
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

	var batchID uint64
	var batchPtr *uint64
	var batchDelta int64

	if batchReason {
		batchID = req.Msg.GetBatchId()
		qty := req.Msg.GetQuantity()
		if batchID == 0 || qty <= 0 {
			return nil, connect.NewError(connect.CodeInvalidArgument, errAdjustBatchArgs)
		}

		batchPtr = &batchID
		// FOUND adds; DAMAGED and LOST remove. The magnitude is always positive on the wire.
		if reasonType == inventoryv1.StockAdjustReason_STOCK_ADJUST_REASON_FOUND {
			batchDelta = qty
		} else {
			batchDelta = -qty
		}
	}

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

			fifoErr := attributeRecountFIFO(tx, warehouseID, productID, rackID, delta)
			if fifoErr != nil {
				return fifoErr
			}
		}

		mv, err = appendMovement(tx, warehouseID, productID, rackID, batchPtr, delta, balance,
			inventoryv1.MovementKind_MOVEMENT_KIND_ADJUST, req.Msg.GetReason(), "", actor)
		if err != nil {
			return err
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

// attributeRecountFIFO spreads a shelf recount's delta over the shelf's batches, oldest first (#211,
// owner's Q1). A gain lands on the oldest batch; a loss is drawn down the batches in age order, the way
// a pick would. A shelf with no batch rows (legacy stock) is left to the stock_levels recount alone.
func attributeRecountFIFO(tx *gorm.DB, warehouseID, productID uint64, rack *uint64, delta int64) error {
	if delta == 0 {
		return nil
	}

	type sbRow struct {
		ID  uint64
		Qty int64
	}

	var rows []sbRow

	err := tx.Raw(`
		SELECT sb.id, sb.qty
		FROM stock_shelf_batches sb
		JOIN stock_batches b ON b.id = sb.batch_id
		WHERE b.warehouse_id = ? AND b.product_id = ? AND sb.rack_id IS NOT DISTINCT FROM ?
		ORDER BY b.id ASC`,
		warehouseID, productID, rack).Scan(&rows).Error
	if err != nil {
		return err
	}

	if len(rows) == 0 {
		return nil
	}

	if delta > 0 {
		return tx.Exec(`UPDATE stock_shelf_batches SET qty = qty + ?, updated_at = NOW() WHERE id = ?`,
			delta, rows[0].ID).Error
	}

	// A loss: consume oldest-first until the shortfall is covered.
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
			return upErr
		}

		remaining -= take
	}

	return nil
}
