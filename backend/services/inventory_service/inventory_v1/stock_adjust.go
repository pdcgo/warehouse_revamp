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
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

var (
	// A stock-take must say WHERE it counted (#139). Proto validation refuses this first; the error exists so a request
	// arriving around it fails loudly.
	errAdjustNoPlace = errors.New("a stock-take must say which rack it counted")
	// Every unit is on a rack (there-is-no-unplaced-pile), so "unplaced" is no place to count.
	errAdjustUnplaced = errors.New("every unit is on a rack — name the rack that was counted")
	// A batch reason (damaged/lost) must name its batch and a positive quantity (#211).
	errAdjustBatchArgs = errors.New("a damaged/lost adjust needs a batch and a positive quantity")
	// A found is not an adjustment any more: it waits for the warehouse Owner or Admin as a request, reported through
	// its one door (an-adjust-found-waits-for-the-owner-or-admin, staff-may-report-a-found).
	errAdjustFound = errors.New("a found is reported with FoundRequestService.FoundRequestCreate — it waits for the " +
		"warehouse Owner or Admin and posts nothing until approved")
)

// StockAdjust corrects a rack's stock — PROVISIONALLY, on the ledgers, keeping what it did before the cut-over
// (old-shelf-corrections-move-onto-the-ledgers-provisionally; its open points are adjustment_clarify.md). The REASON
// drives it:
//
//   - RECOUNT (or unspecified) corrects one product on one rack TO a counted figure: a shortfall leaves the owner's
//     batches oldest first, a surplus is minted at the owner's newest price here, an exact count writes a 0 rack row.
//     A shortfall is written off and owed like a lost unit (a-recount-shortfall-is-written-off-and-owed); a surplus
//     moves no money.
//   - DAMAGED / LOST are a REPORT AT THE SHELF — the stock-problem register's second door
//     (an-adjustment-writes-the-same-problem-row): a `problem` transaction of the batch's owner, its rows saying broken
//     or lost, and one warehouse_stock_problems row for the named batch at its price (post_problem.go). Written off to
//     expense after commit and owed to its owner inside the transaction, as before.
//   - FOUND is REFUSED (InvalidArgument): a found waits for the warehouse Owner or Admin as a request, reported through
//     FoundRequestService.FoundRequestCreate, its one door (an-adjust-found-waits-for-the-owner-or-admin,
//     staff-may-report-a-found). The provisional found into a named batch (`PostBatchFound`) is retired.
//
// Every write is refused on a product a stock count holds on that rack (a-lock-stops-sales-and-cancels-too).
func (s *Service) StockAdjust(
	ctx context.Context,
	req *connect.Request[inventoryv1.StockAdjustRequest],
) (*connect.Response[inventoryv1.StockAdjustResponse], error) {
	msg := req.Msg
	warehouseID := msg.GetWarehouseId()
	productID := msg.GetProductId()
	actor := actorFrom(ctx)
	override := overrideFrom(ctx)

	if msg.GetPlace() == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, errAdjustNoPlace)
	}

	rackID := msg.GetRackId()
	if rackID == 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, errAdjustUnplaced)
	}

	reason := msg.GetReasonType()
	if reason == inventoryv1.StockAdjustReason_STOCK_ADJUST_REASON_FOUND {
		return nil, connect.NewError(connect.CodeInvalidArgument, errAdjustFound)
	}

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
			problemType := inventory_service_models.ProblemBroken
			if reason == inventoryv1.StockAdjustReason_STOCK_ADJUST_REASON_LOST {
				problemType = inventory_service_models.ProblemLost
			}

			reported, reportErr := inventory_mutations.PostShelfProblem(tx, inventory_mutations.ShelfProblem{
				WarehouseID: warehouseID,
				ProductID:   productID,
				PlacementID: rackID,
				BatchID:     msg.GetBatchId(),
				Count:       msg.GetQuantity(),
				Type:        problemType,
				ActorID:     actor,
				IsOverride:  override,
				Description: msg.GetReason(),
			})
			if reportErr != nil {
				return reportErr
			}

			txID, owner, value, rackAfter := reported.Transaction.ID, reported.OwnerTeamID, reported.Value, reported.RackAfter
			loss = value

			movement = adjustMovement(txID, warehouseID, productID, rackID, msg.GetBatchId(),
				-msg.GetQuantity(), rackAfter, msg.GetReason(), actor)

			// THE WAREHOUSE OWES THE OWNER for what it broke or lost (business_level §Warehouse 5) — inside the
			// transaction, keyed by the problem. Turning up again is a found request's approval, which gives it back.
			amount := int64(math.Round(value))
			if amount > 0 && owner != warehouseID {
				damageErr := s.liability.PostStockDamage(ctx, tx, owner, warehouseID, txID, actor, amount, damageKindOf(reason))
				if damageErr != nil {
					return damageErr
				}
			}
		} else {
			posted, lines, recountErr := inventory_mutations.PostRecount(tx, inventory_mutations.Recount{
				WarehouseID: warehouseID,
				PlacementID: rackID,
				ActorID:     actor,
				IsOverride:  override,
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

			// A SHORTFALL COSTS THE SAME WHICHEVER SCREEN RECORDS IT (a-recount-shortfall-is-written-off-and-owed): the
			// missing units left the owner's batches oldest first, at each batch's price, so their value is written off
			// after commit and owed to the owner here — as a stock count and a lost adjust do. A surplus moves no money.
			if line.Counted < line.Expected {
				loss = line.Value

				amount := int64(math.Round(line.Value))
				if amount > 0 && line.OwnerTeamID != warehouseID {
					damageErr := s.liability.PostStockDamage(ctx, tx, line.OwnerTeamID, warehouseID,
						line.TransactionID, actor, amount, StockDamageLost)
					if damageErr != nil {
						return damageErr
					}
				}
			}
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
		inventoryv1.StockAdjustReason_STOCK_ADJUST_REASON_LOST:
		return true
	default:
		return false
	}
}

// damageKindOf keeps the custody movements apart on the ledger (the-ledger-speaks-the-business-words). A found's is
// posted by its approval (postCountDebts).
func damageKindOf(r inventoryv1.StockAdjustReason) StockDamageKind {
	switch r {
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

	if refused := countedRefusal(err); refused != nil {
		return refused
	}

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
