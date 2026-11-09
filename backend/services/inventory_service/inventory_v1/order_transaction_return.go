package inventory_v1

import (
	"context"
	"errors"
	"fmt"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_mutations"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

var errReturnTakeMissing = errors.New("no order take with that id for this selling team")

// OrderTransactionReturn is an order's returned parcel back on the return warehouse's shelves
// (docs/business/inventory/return_decision.md), called in process by the order's return accept BEFORE it moves the
// order (only-the-return-warehouse-accepts-a-return: the accept has already checked this is the team's return
// warehouse). In one database transaction, after the take's row lock:
//
//  1. ONCE PER TAKE. A take already returned answers its return (posted = false) and writes nothing — a retried or raced
//     accept never stocks the parcel twice (order_return_checks, claimed in the same transaction).
//  2. The racks are the return warehouse's (another's reads NotFound); PostReturn mints one batch per layer the take drew
//     (a-return-mints-one-batch-per-batch-the-order-took) and puts the sound units on the racks named — refused whole
//     under a count lock (a-lock-stops-sales-and-cancels-too).
//  3. The broken and missing units are the return's door rows with the crew's note, the selling team's
//     (a-short-return-is-missing-at-the-door, a-broken-returned-unit-is-thrown-away-at-the-door,
//     a-return-door-row-carries-an-optional-note) — no payable, no claim, no Inventory Lost: nothing else reads them.
//  4. The products the sound units come back as are linked to the return warehouse
//     (a-transfer-links-its-products-to-the-receiver — every way a product reaches a warehouse links it there).
func (s *Service) OrderTransactionReturn(
	ctx context.Context,
	req *connect.Request[inventoryv1.OrderTransactionReturnRequest],
) (*connect.Response[inventoryv1.OrderTransactionReturnResponse], error) {
	msg := req.Msg
	warehouseID := msg.GetTeamId()
	takeID := msg.GetTakeTransactionId()

	// 1. THE KEY FIRST — a plain read; the lock below is the check that counts.
	done, err := returnOfTake(s.db.WithContext(ctx), takeID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	if done != 0 {
		return returnAnswer(s.db.WithContext(ctx), done, false)
	}

	r := inventory_mutations.Return{
		WarehouseID:       warehouseID,
		TeamID:            msg.GetSellingTeamId(),
		TakeTransactionID: takeID,
		ActorID:           actorFrom(ctx),
		IsOverride:        overrideFrom(ctx),
		Description:       msg.GetDescription(),
	}

	notes := map[uint64]string{}
	racks := []uint64{}
	linked := []uint64{}

	for _, line := range msg.GetLines() {
		out := inventory_mutations.ReturnLine{
			ProductID:       line.GetProductId(),
			ReturnProductID: line.GetReturnProductId(),
			MarkupRate:      line.GetMarkupRate(),
			Sound:           line.GetSound(),
			Broken:          line.GetBroken(),
			Missing:         line.GetMissing(),
		}

		for _, p := range line.GetPlacements() {
			racks = append(racks, p.GetPlacementId())
			out.Placements = append(out.Placements, inventory_mutations.RestockPlacement{
				PlacementID: p.GetPlacementId(), Count: p.GetQuantity(),
			})
		}

		if line.GetSound() > 0 {
			linked = append(linked, line.GetReturnProductId())
		}

		notes[line.GetProductId()] = line.GetNote()
		r.Lines = append(r.Lines, out)
	}

	var (
		returned uint64
		posted   bool
	)

	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		// The take's row, locked: two accepts of one parcel in the same second queue here, and the second reads the
		// first's claim instead of minting again. It is also the check that the take is this selling team's order, and
		// still stands — a rolled-back take (a cancelled order) gave its units back already.
		var take models.InventoryTransaction

		lockErr := tx.
			Clauses(clause.Locking{Strength: "UPDATE"}).
			Where("id = ? AND tx_type = ? AND team_id = ? AND NOT is_rollback", takeID, models.TxOrder, r.TeamID).
			Take(&take).
			Error
		if errors.Is(lockErr, gorm.ErrRecordNotFound) {
			return errReturnTakeMissing
		}

		if lockErr != nil {
			return lockErr
		}

		claimed, claimErr := returnOfTake(tx, takeID)
		if claimErr != nil {
			return claimErr
		}

		if claimed != 0 {
			returned = claimed
			return nil
		}

		exists, rackErr := racksExist(tx, warehouseID, racks)
		if rackErr != nil {
			return rackErr
		}

		if !exists {
			return errRackMissing
		}

		t, problems, postErr := inventory_mutations.PostReturn(tx, r)
		if postErr != nil {
			return postErr
		}

		if len(problems) > 0 {
			rows := make([]models.OrderReturnProblemItem, 0, len(problems))
			for _, p := range problems {
				rows = append(rows, models.OrderReturnProblemItem{
					TransactionID: t.ID,
					ProductID:     p.ProductID,
					ProblemType:   p.Type,
					Note:          notes[p.ProductID],
					Count:         p.Count,
					PriceUnit:     p.Total / float64(p.Count),
					Total:         p.Total,
				})
			}

			createErr := tx.Create(&rows).Error
			if createErr != nil {
				return createErr
			}
		}

		linkErr := linkWarehouseProductIDs(tx, warehouseID, linked)
		if linkErr != nil {
			return linkErr
		}

		returned = t.ID
		posted = true

		return tx.Create(&models.OrderReturnCheck{TakeTransactionID: takeID, TransactionID: t.ID}).Error
	})
	if err != nil {
		return nil, returnErr(err)
	}

	return returnAnswer(s.db.WithContext(ctx), returned, posted)
}

// returnOfTake is the return transaction a take was returned in, 0 when it has not been.
func returnOfTake(db *gorm.DB, takeID uint64) (uint64, error) {
	var rows []models.OrderReturnCheck

	err := db.Where("take_transaction_id = ?", takeID).Limit(1).Find(&rows).Error
	if err != nil {
		return 0, fmt.Errorf("look up the take's return: %w", err)
	}

	if len(rows) == 0 {
		return 0, nil
	}

	return rows[0].TransactionID, nil
}

// returnAnswer is the return as written: its transaction and its door rows, broken before missing per product.
func returnAnswer(db *gorm.DB, transactionID uint64, posted bool) (*connect.Response[inventoryv1.OrderTransactionReturnResponse], error) {
	var rows []models.OrderReturnProblemItem

	err := db.
		Where("transaction_id = ?", transactionID).
		Order("product_id, problem_type").
		Find(&rows).
		Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("read the return's door rows: %w", err))
	}

	res := &inventoryv1.OrderTransactionReturnResponse{TransactionId: transactionID, Posted: posted}

	for _, row := range rows {
		kind := inventoryv1.OrderTransactionReturnProblemType_ORDER_TRANSACTION_RETURN_PROBLEM_TYPE_MISSING
		if row.ProblemType == models.TransferProblemBroken {
			kind = inventoryv1.OrderTransactionReturnProblemType_ORDER_TRANSACTION_RETURN_PROBLEM_TYPE_BROKEN
		}

		res.Problems = append(res.Problems, &inventoryv1.OrderTransactionReturnProblem{
			ProductId: row.ProductID,
			Type:      kind,
			Count:     row.Count,
			Total:     row.Total,
			Note:      row.Note,
		})
	}

	return connect.NewResponse(res), nil
}

// returnErr maps a refused return to Connect: a count holding a rack is FailedPrecondition naming the count; a rack that
// is not the return warehouse's, or a take that is not the team's order, NotFound; a count that does not fit the take
// InvalidArgument; a twin's claim met at commit AlreadyExists.
func returnErr(err error) error {
	if refused := countedRefusal(err); refused != nil {
		return refused
	}

	switch {
	case errors.Is(err, errRackMissing):
		return connect.NewError(connect.CodeNotFound, errRackMissing)
	case errors.Is(err, errReturnTakeMissing):
		return connect.NewError(connect.CodeNotFound, errReturnTakeMissing)
	case errors.Is(err, inventory_mutations.ErrReturnCount):
		return connect.NewError(connect.CodeInvalidArgument, err)
	case isUniqueViolation(err):
		return connect.NewError(connect.CodeAlreadyExists, errors.New("this order's return is already on the shelf"))
	default:
		return connect.NewError(connect.CodeInternal, err)
	}
}
