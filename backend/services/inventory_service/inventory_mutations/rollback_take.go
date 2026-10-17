package inventory_mutations

import (
	"errors"
	"fmt"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_ledgers"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// ErrNotATake refuses rolling back anything but a take: a wrong stock-in is corrected by an adjustment, never undone
// (a-rollback-only-undoes-a-take).
var ErrNotATake = errors.New("only an order or a transfer's out-leg is rolled back")

// RollbackTake undoes a take ONCE (an-undo-rolls-the-transaction-back-once): the transaction row is locked first; one
// already rolled back does nothing; otherwise every batch and rack row it wrote is reversed under the same transaction
// (a-rollback-reverses-its-log-rows) and `is_rollback` is set. Returns whether this call rolled it back. The items are
// left as they are — the summary of what the take did, which is still true.
func RollbackTake(tx *gorm.DB, transactionID, actorID uint64) (bool, error) {
	var t models.InventoryTransaction

	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&t, transactionID).Error
	if err != nil {
		return false, fmt.Errorf("lock transaction %d: %w", transactionID, err)
	}

	if t.IsRollback {
		return false, nil
	}

	if t.TxType != models.TxOrder && t.TxType != models.TxTransferOut {
		return false, fmt.Errorf("%w: transaction %d is %s", ErrNotATake, t.ID, t.TxType)
	}

	// BATCHES before racks (batches-lock-before-shelves-by-id).
	err = inventory_ledgers.ReverseBatchLogs(tx, t, actorID)
	if err != nil {
		return false, err
	}

	err = inventory_ledgers.ReversePlacementLogs(tx, t, actorID)
	if err != nil {
		return false, err
	}

	err = tx.Model(&t).Updates(map[string]any{"is_rollback": true, "updated_at": gorm.Expr("NOW()")}).Error
	if err != nil {
		return false, fmt.Errorf("mark transaction %d rolled back: %w", t.ID, err)
	}

	return true, nil
}
