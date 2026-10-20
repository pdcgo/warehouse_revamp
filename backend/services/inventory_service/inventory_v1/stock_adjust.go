package inventory_v1

import (
	"context"
	"errors"
	"fmt"
	"math"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_ledgers"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_mutations"
)

var (
	// A stock-take must say WHERE it counted (#139). Proto validation refuses this first; the error exists so a request
	// arriving around it fails loudly.
	errAdjustNoPlace = errors.New("a stock-take must say which rack it counted")
	// Every unit is on a rack (there-is-no-unplaced-pile), so "unplaced" is no place to count.
	errAdjustUnplaced = errors.New("every unit is on a rack — name the rack that was counted")
	// A batch reason (damaged/lost/found) must name its batch and a positive quantity (#211).
	errAdjustBatchArgs = errors.New("a damaged/lost/found adjust needs a batch and a positive quantity")
)

// StockAdjust corrects a rack's stock — PROVISIONALLY, on the ledgers, keeping what it did before the cut-over
// (old-shelf-corrections-move-onto-the-ledgers-provisionally; its open points are adjustment_clarify.md). The REASON
// drives it:
//
//   - RECOUNT (or unspecified) corrects one product on one rack TO a counted figure: a shortfall leaves the owner's
//     batches oldest first, a surplus is minted at the owner's newest price here, an exact count writes a 0 rack row.
//     It moves no money, as before (adjustment Q2 asks whether it should).
//   - DAMAGED / LOST take a NAMED batch's units off a rack; FOUND puts them back. A damaged or lost unit is written off
//     to expense after commit and owed to its owner inside the transaction; a found one gives that debt back.
//
// Each call is one `adjustment` transaction of the product's owner.
func (s *Service) StockAdjust(
	ctx context.Context,
	req *connect.Request[inventoryv1.StockAdjustRequest],
) (*connect.Response[inventoryv1.StockAdjustResponse], error) {
	msg := req.Msg
	warehouseID := msg.GetWarehouseId()
	productID := msg.GetProductId()
	actor := actorFrom(ctx)

	if msg.GetPlace() == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errAdjustNoPlace)
	}

	rackID := msg.GetRackId()
	if rackID == 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, errAdjustUnplaced)
	}

	reason := msg.GetReasonType()
	batchReason := isBatchAdjust(reason)

	if batchReason && (msg.GetBatchId() == 0 || msg.GetQuantity() <= 0) {
		return nil, connect.NewError(connect.CodeInvalidArgument, errAdjustBatchArgs)
	}

	var (
		movement *inventoryv1.StockMovement
		lossNote = msg.GetReason()
		loss     float64
		total    int64
	)

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		exists, checkErr := rackExists(tx, warehouseID, rackID)
		if checkErr != nil {
			return checkErr
		}

		if !exists {
			return errRackMissing
		}

		if batchReason {
			found := reason == inventoryv1.StockAdjustReason_STOCK_ADJUST_REASON_FOUND

			adjusted, adjustErr := inventory_mutations.PostBatchAdjust(tx, inventory_mutations.BatchAdjust{
				WarehouseID: warehouseID,
				ProductID:   productID,
				PlacementID: rackID,
				BatchID:     msg.GetBatchId(),
				Count:       msg.GetQuantity(),
				Found:       found,
				ActorID:     actor,
				Description: msg.GetReason(),
			})
			if adjustErr != nil {
				return adjustErr
			}

			delta := -msg.GetQuantity()
			if found {
				delta = msg.GetQuantity()
			} else {
				loss = adjusted.Value
			}

			movement = adjustMovement(adjusted.Transaction.ID, warehouseID, productID, rackID, msg.GetBatchId(),
				delta, adjusted.RackAfter, msg.GetReason(), actor)

			// THE WAREHOUSE OWES THE OWNER for what it broke or lost, and is owed it back when the goods turn up
			// (business_level §Warehouse 5) — inside the transaction, keyed by the adjustment.
			amount := int64(math.Round(adjusted.Value))
			if amount > 0 && adjusted.OwnerTeamID != warehouseID {
				damageErr := s.liability.PostStockDamage(ctx, tx, adjusted.OwnerTeamID, warehouseID,
					adjusted.Transaction.ID, actor, amount, damageKindOf(reason))
				if damageErr != nil {
					return damageErr
				}
			}
		} else {
			posted, lines, recountErr := inventory_mutations.PostRecount(tx, inventory_mutations.Recount{
				WarehouseID: warehouseID,
				PlacementID: rackID,
				ActorID:     actor,
				Description: msg.GetReason(),
				Lines:       []inventory_mutations.RecountLine{{ProductID: productID, Counted: msg.GetOnHand()}},
			})
			if recountErr != nil {
				return recountErr
			}

			var txID uint64
			if len(posted) > 0 {
				txID = posted[0].ID
			}

			line := lines[0]
			movement = adjustMovement(txID, warehouseID, productID, rackID, 0, line.Counted-line.Expected,
				line.Counted, msg.GetReason(), actor)
		}

		return tx.Raw(`SELECT COALESCE(SUM(stock_count), 0) FROM product_placements WHERE warehouse_id = ? AND product_id = ?`,
			warehouseID, productID).Scan(&total).Error
	})
	if err != nil {
		return nil, adjustErr(err)
	}

	// The loss value, written off AFTER the stock left the rack — best-effort, as before (#211).
	if amount := int64(math.Round(loss)); amount > 0 {
		_ = s.expense.PostStockLoss(ctx, warehouseID, amount, lossNote)
	}

	return connect.NewResponse(&inventoryv1.StockAdjustResponse{
		Movement: movement,
		Level:    stockLevelRow{WarehouseID: warehouseID, ProductID: productID, OnHand: total}.proto(),
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

// damageKindOf keeps the three custody movements apart on the ledger (the-ledger-speaks-the-business-words).
func damageKindOf(r inventoryv1.StockAdjustReason) StockDamageKind {
	switch r {
	case inventoryv1.StockAdjustReason_STOCK_ADJUST_REASON_FOUND:
		return StockDamageFound
	case inventoryv1.StockAdjustReason_STOCK_ADJUST_REASON_LOST:
		return StockDamageLost
	default:
		return StockDamageBroken
	}
}

// adjustMovement is the adjust as the old movement shape the screens read: its id is the adjustment transaction.
func adjustMovement(
	txID, warehouseID, productID, rackID, batchID uint64,
	delta, balance int64,
	reason string,
	actor uint64,
) *inventoryv1.StockMovement {
	return &inventoryv1.StockMovement{
		Id:          txID,
		ProductId:   productID,
		WarehouseId: warehouseID,
		RackId:      rackID,
		BatchId:     batchID,
		Delta:       delta,
		Balance:     balance,
		Kind:        inventoryv1.MovementKind_MOVEMENT_KIND_ADJUST,
		Reason:      reason,
		ActorUserId: actor,
		CreatedAt:   time.Now().UTC().Format(time.RFC3339),
	}
}

// adjustErr maps a provisional adjustment's refusal to Connect.
func adjustErr(err error) error {
	var short *inventory_ledgers.NotEnoughStockError

	switch {
	case errors.Is(err, errRackMissing):
		return connect.NewError(connect.CodeNotFound, errRackMissing)
	case errors.Is(err, inventory_mutations.ErrBatchNotHere):
		return connect.NewError(connect.CodeNotFound, inventory_mutations.ErrBatchNotHere)
	case errors.Is(err, inventory_mutations.ErrNeverStockedHere):
		return connect.NewError(connect.CodeFailedPrecondition, err)
	case errors.As(err, &short):
		return connect.NewError(connect.CodeFailedPrecondition,
			fmt.Errorf("product %d: %d wanted, %d held", short.ProductID, short.Wanted, short.Available))
	default:
		return connect.NewError(connect.CodeInternal, err)
	}
}
