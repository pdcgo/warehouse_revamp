package inventory_v1

import (
	"context"
	"fmt"
	"math"
	"time"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_mutations"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// OpnameSessionFinalize posts a count. Finalizing IS the agreement (finalizing-is-the-agreement): whoever finalizes —
// the warehouse's Owner or Admin, or Root and the root Administrator as an override (root-finalizes-only-as-an-override,
// stamped on every transaction it writes) — agrees the debt, and is never a person who counted a row of it
// (nobody-finalizes-their-own-count). Every row must be counted.
//
// ONE database transaction (the-lock-is-the-open-snapshot-row): the session locked FOR UPDATE, so no row write passes it;
// then the settlement posted per product (inventory_mutations.PostCountFinalize) — up to three transactions per owning
// team, `problem`, `found`, `move` (problem-and-found-replace-opname); what the warehouse owes each team for the broken
// and the lost units, and what a claim gives back, posted to liability inside the transaction; the transactions listed
// (a-session-lists-its-final-transactions); every row released; the session `finish`. The stock-loss expense follows the
// commit, once for the count, as every write-off here does.
func (s *Service) OpnameSessionFinalize(
	ctx context.Context,
	req *connect.Request[inventoryv1.OpnameSessionFinalizeRequest],
) (*connect.Response[inventoryv1.OpnameSessionFinalizeResponse], error) {
	warehouseID := req.Msg.GetTeamId()
	actor := actorFrom(ctx)

	if actor == 0 {
		return nil, opnameErr(errOpnameNoPerson)
	}

	var (
		session models.OpnameSession
		posted  inventory_mutations.CountPosted
	)

	err := s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		var lockErr error

		session, lockErr = opnameSessionOf(tx, warehouseID, req.Msg.GetSessionId(), "UPDATE")
		if lockErr != nil {
			return lockErr
		}

		count, readErr := readOpnameCount(tx, session.ID, false)
		if readErr != nil {
			return readErr
		}

		switch opnameFinalizeBlock(session, count, actor) {
		case inventoryv1.OpnameFinalizeBlock_OPNAME_FINALIZE_BLOCK_NOT_ACTIVE:
			return errOpnameNotActive
		case inventoryv1.OpnameFinalizeBlock_OPNAME_FINALIZE_BLOCK_ROWS_NOT_COUNTED:
			return errOpnameRowsLeft
		case inventoryv1.OpnameFinalizeBlock_OPNAME_FINALIZE_BLOCK_OWN_COUNT:
			return errOpnameOwnCount
		}

		var postErr error

		posted, postErr = inventory_mutations.PostCountFinalize(tx, inventory_mutations.CountFinalize{
			WarehouseID: warehouseID,
			ActorID:     actor,
			IsOverride:  overrideFrom(ctx),
			Description: opnameNote(session.ID),
			Products:    count.products,
		})
		if postErr != nil {
			return postErr
		}

		// THE WAREHOUSE OWES THE OWNER for what it threw away and lost, and is owed back what a claim returns
		// (a-loss-in-custody-is-a-stock-problem) — keyed by the transaction, so the broken and the lost of one problem
		// transaction are two entries and a retry is refused by the ledger. A team cannot owe itself.
		for _, ct := range posted.Transactions {
			if ct.Transaction.TeamID == warehouseID {
				continue
			}

			for _, money := range []struct {
				amount float64
				kind   StockDamageKind
			}{{ct.BrokenValue, StockDamageBroken}, {ct.LostValue, StockDamageLost}, {ct.ClaimedValue, StockDamageFound}} {
				amount := int64(math.Round(money.amount))
				if amount <= 0 {
					continue
				}

				damageErr := s.liability.PostStockDamage(ctx, tx, ct.Transaction.TeamID, warehouseID, ct.Transaction.ID,
					actor, amount, money.kind)
				if damageErr != nil {
					return damageErr
				}
			}
		}

		listed := make([]models.OpnameSessionFinalTransaction, 0, len(posted.Transactions))
		for _, ct := range posted.Transactions {
			listed = append(listed, models.OpnameSessionFinalTransaction{OpnameSessionID: session.ID, TransactionID: ct.Transaction.ID})
		}

		if len(listed) > 0 {
			listErr := tx.Create(&listed).Error
			if listErr != nil {
				return listErr
			}
		}

		now := time.Now()
		session.Status = models.OpnameFinish
		session.FinalizedByID = &actor
		session.FinalizedAt = &now

		updateErr := tx.Model(&models.OpnameSession{}).Where("id = ?", session.ID).Updates(map[string]any{
			"status": models.OpnameFinish, "finalized_by_id": actor, "finalized_at": now,
		}).Error
		if updateErr != nil {
			return updateErr
		}

		return tx.Model(&models.OpnameSessionSnapshot{}).
			Where("opname_session_id = ? AND released_at IS NULL", session.ID).
			Update("released_at", now).Error
	})
	if err != nil {
		return nil, opnameErr(err)
	}

	// The warehouse's own loss, written off AFTER the stock left the books — best-effort, one line for the count.
	var loss float64
	for _, ct := range posted.Transactions {
		loss += ct.BrokenValue + ct.LostValue
	}

	if amount := int64(math.Round(loss)); amount > 0 {
		_ = s.expense.PostStockLoss(ctx, warehouseID, amount, opnameNote(session.ID))
	}

	progress, err := opnameProgressOf(s.db.WithContext(ctx), []models.OpnameSession{session})
	if err != nil {
		return nil, opnameErr(err)
	}

	res := &inventoryv1.OpnameSessionFinalizeResponse{Session: opnameSessionProto(session, progress[session.ID], false)}

	for _, ct := range posted.Transactions {
		res.Transactions = append(res.Transactions, &inventoryv1.OpnameTransaction{
			TransactionId: ct.Transaction.ID,
			TeamId:        ct.Transaction.TeamID,
			Type:          opnameTransactionTypeProto(ct.TxType),
		})
	}

	return connect.NewResponse(res), nil
}

// opnameNote is what a count's transactions and its write-off say they were.
func opnameNote(sessionID uint64) string {
	return fmt.Sprintf("stock count #%d", sessionID)
}

func opnameTransactionTypeProto(t models.TxType) inventoryv1.OpnameTransactionType {
	switch t {
	case models.TxProblem:
		return inventoryv1.OpnameTransactionType_OPNAME_TRANSACTION_TYPE_PROBLEM
	case models.TxFound:
		return inventoryv1.OpnameTransactionType_OPNAME_TRANSACTION_TYPE_FOUND
	case models.TxMove:
		return inventoryv1.OpnameTransactionType_OPNAME_TRANSACTION_TYPE_MOVE
	default:
		return inventoryv1.OpnameTransactionType_OPNAME_TRANSACTION_TYPE_UNSPECIFIED
	}
}
