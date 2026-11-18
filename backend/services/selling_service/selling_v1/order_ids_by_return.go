package selling_v1

import (
	"context"

	"gorm.io/gorm"
)

// OrderIDsByReturnTransactions answers, for inventory's batch screens (a-returns-batch-opens-its-order), which order each
// `return` stock transaction put back on the shelf: the order naming it as `orders.return_transaction_id`, written by
// OrderReturnAccept in the move to return_completed. A transaction no order names — its stock went in and the order's move
// has not landed yet, or it is no return at all — is absent from the map.
//
// ONE statement for a whole page of batches, never one per row, by the partial index on the column (selling 00050). Only
// order ids leave: no money, no status, nothing of the selling team's. The batch read that asks is already scoped to the
// warehouse holding the batches, and only that warehouse accepted those returns.
//
// A plain function over selling's own table, not an RPC: the composition root calls it (HARD RULE 3), as
// ProductHasHistory — a *Service there would close a cycle, since selling already takes stock through inventory.
func OrderIDsByReturnTransactions(ctx context.Context, db *gorm.DB, transactionIDs []uint64) (map[uint64]uint64, error) {
	orders := make(map[uint64]uint64, len(transactionIDs))
	if len(transactionIDs) == 0 {
		return orders, nil
	}

	var rows []struct {
		ID                  uint64
		ReturnTransactionID uint64
	}

	err := db.
		WithContext(ctx).
		Table("orders").
		Select("id, return_transaction_id").
		Where("return_transaction_id IN ?", transactionIDs).
		Scan(&rows).
		Error
	if err != nil {
		return nil, err
	}

	for _, row := range rows {
		orders[row.ReturnTransactionID] = row.ID
	}

	return orders, nil
}
