package inventory_v1

import (
	"context"
	"errors"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_ledgers"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_mutations"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// FoundRequestApprove approves a waiting found request: ONE `found` transaction that claims the oldest open losses of the
// product back into their batches at their price and mints the rest at the team's newest batch price here — the stock
// count's own found, run for one product on one rack (inventory_mutations.PostFoundApproval), so the ledgers, the
// register and the money are what a count's surplus of the same units posts (an-adjust-found-waits-for-the-owner-or-admin).
// What a claim gives back is posted to liability inside the transaction, as a count's finalize does (postCountDebts); a
// mint moves no money.
//
// Never by the person who reported it (nobody-finalizes-their-own-count, by the same rule), never while a stock count
// holds the product on the rack (a-lock-stops-sales-and-cancels-too), never twice: ONE database transaction that locks,
// in order,
//
//	the request FOR UPDATE → (the count lock, read early to refuse fast) → the register's open losses → the batches →
//	the rack row → the count lock again, in a statement of its own (the one that decides)
//
// — the order a count's finalize keeps after its session and its waiting requests, so the two cannot deadlock. A
// second approval or a rejection waits on the request row and then finds it no longer waiting.
func (s *Service) FoundRequestApprove(
	ctx context.Context,
	req *connect.Request[inventoryv1.FoundRequestApproveRequest],
) (*connect.Response[inventoryv1.FoundRequestApproveResponse], error) {
	warehouseID := req.Msg.GetTeamId()
	actor := actorFrom(ctx)

	if actor == 0 {
		return nil, foundErr(errFoundNoPerson)
	}

	var (
		row      models.FoundRequest
		approved inventory_mutations.FoundApproved
	)

	db := s.db.WithContext(ctx)

	err := inventory_ledgers.StockTransaction(db, func(tx *gorm.DB) error {
		var lockErr error

		row, lockErr = foundRequestOf(tx, warehouseID, req.Msg.GetFoundRequestId(), "UPDATE")
		if lockErr != nil {
			return lockErr
		}

		switch foundApproveBlock(row, actor, nil) {
		case inventoryv1.FoundRequestApproveBlock_FOUND_REQUEST_APPROVE_BLOCK_NOT_WAITING:
			return errFoundNotWaiting
		case inventoryv1.FoundRequestApproveBlock_FOUND_REQUEST_APPROVE_BLOCK_OWN_REPORT:
			return errFoundOwnReport
		}

		key := inventory_ledgers.RackKey{ProductID: row.ProductID, PlacementID: row.PlacementID}

		countedErr := inventory_ledgers.RefuseCounted(tx, []inventory_ledgers.RackKey{key})
		if countedErr != nil {
			return countedErr
		}

		exists, rackErr := rackExists(tx, warehouseID, row.PlacementID)
		if rackErr != nil {
			return rackErr
		}

		if !exists {
			return errFoundRackGone
		}

		codes, codeErr := placementCodesOf(tx, []uint64{row.PlacementID})
		if codeErr != nil {
			return codeErr
		}

		var postErr error

		approved, postErr = inventory_mutations.PostFoundApproval(tx, inventory_mutations.FoundApproval{
			FoundUnits: inventory_mutations.FoundUnits{
				WarehouseID: warehouseID, TeamID: row.TeamID, ProductID: row.ProductID, PlacementID: row.PlacementID,
				PlacementCode: codes[row.PlacementID], Count: row.StockCount,
			},
			ActorID:     actor,
			IsOverride:  overrideFrom(ctx),
			Description: foundNote(row.ID),
		})
		if errors.Is(postErr, inventory_mutations.ErrNeverStockedHere) {
			return errFoundNoPrice
		}

		if postErr != nil {
			return postErr
		}

		debtErr := s.postCountDebts(ctx, tx, warehouseID, actor, []inventory_mutations.CountTransaction{approved.Transaction})
		if debtErr != nil {
			return debtErr
		}

		now := time.Now()
		txID := approved.Transaction.Transaction.ID

		row.Status = models.FoundApproved
		row.DecidedByID = &actor
		row.DecidedAt = &now
		row.TransactionID = &txID

		updates := map[string]any{
			"status": models.FoundApproved, "decided_by_id": actor, "decided_at": now, "transaction_id": txID,
		}

		if approved.MintedBatchID != 0 {
			minted := approved.MintedBatchID
			row.MintedBatchID = &minted
			updates["minted_batch_id"] = minted
		}

		return tx.Model(&models.FoundRequest{}).Where("id = ?", row.ID).Updates(updates).Error
	})
	if err != nil {
		return nil, foundErr(err)
	}

	mapped, err := foundRequestsProto(db, actor, []models.FoundRequest{row})
	if err != nil {
		return nil, foundErr(err)
	}

	return connect.NewResponse(&inventoryv1.FoundRequestApproveResponse{
		FoundRequest:  mapped[row.ID],
		TransactionId: approved.Transaction.Transaction.ID,
	}), nil
}
