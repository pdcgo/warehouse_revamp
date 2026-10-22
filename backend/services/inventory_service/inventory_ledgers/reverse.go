package inventory_ledgers

import (
	"fmt"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// ReverseBatchLogs writes, under the SAME transaction, one new batch row per row the transaction wrote, its sign flipped
// — same batch, same value (a-rollback-reverses-its-log-rows). The batches are locked in id order first, and every
// reversal is stored in one update and one log insert (ledger-writes-are-set-based). An emptied batch gets back exactly
// the value it gave up.
func ReverseBatchLogs(tx *gorm.DB, t inventory_service_models.InventoryTransaction, actorID uint64) error {
	var logs []inventory_service_models.BatchLog

	err := tx.Where("transaction_id = ?", t.ID).Order("id").Find(&logs).Error
	if err != nil {
		return fmt.Errorf("read batch rows of transaction %d: %w", t.ID, err)
	}

	if len(logs) == 0 {
		return nil
	}

	ids := make([]uint64, 0, len(logs))
	for _, l := range logs {
		ids = append(ids, l.BatchID)
	}

	var batches []inventory_service_models.Batch

	err = tx.Clauses(clause.Locking{Strength: "UPDATE"}).Where("id IN ?", ids).Order("id").Find(&batches).Error
	if err != nil {
		return fmt.Errorf("lock batches of transaction %d: %w", t.ID, err)
	}

	byID := make(map[uint64]*inventory_service_models.Batch, len(batches))
	for i := range batches {
		byID[batches[i].ID] = &batches[i]
	}

	var w BatchWrites

	for _, l := range logs {
		b := byID[l.BatchID]

		b.StockCount -= l.ChangeCount
		b.StockValuation -= l.ChangeValuation
		if b.StockCount == 0 {
			b.StockValuation = 0
		}

		if b.StockCount < 0 {
			return fmt.Errorf("reversing transaction %d would take batch %d below zero", t.ID, b.ID)
		}

		w.change(b, t.ID, l.ChangeType, -l.ChangeCount, -l.ChangeValuation, actorID, "rollback")
	}

	return w.Flush(tx)
}

// ReversePlacementLogs is ReverseBatchLogs for the racks: one flipped row per rack row the transaction wrote, the rack
// rows locked in id order first.
func ReversePlacementLogs(tx *gorm.DB, t inventory_service_models.InventoryTransaction, actorID uint64) error {
	var logs []inventory_service_models.ProductPlacementLog

	err := tx.Where("transaction_id = ?", t.ID).Order("id").Find(&logs).Error
	if err != nil {
		return fmt.Errorf("read rack rows of transaction %d: %w", t.ID, err)
	}

	if len(logs) == 0 {
		return nil
	}

	pairs := make([][]any, 0, len(logs))
	for _, l := range logs {
		pairs = append(pairs, []any{l.ProductID, l.PlacementID})
	}

	var rows []inventory_service_models.ProductPlacement

	err = tx.Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("(product_id, placement_id) IN ?", pairs).
		Order("id").
		Find(&rows).Error
	if err != nil {
		return fmt.Errorf("lock rack rows of transaction %d: %w", t.ID, err)
	}

	byKey := make(map[RackKey]*inventory_service_models.ProductPlacement, len(rows))
	for i := range rows {
		byKey[RackKey{rows[i].ProductID, rows[i].PlacementID}] = &rows[i]
	}

	var w RackWrites

	for _, l := range logs {
		row := byKey[RackKey{l.ProductID, l.PlacementID}]

		if row.StockCount-l.StockChange < 0 {
			return fmt.Errorf("reversing transaction %d would take rack %d below zero", t.ID, row.PlacementID)
		}

		_, err = w.Apply(t, row, -l.StockChange, l.ChangeType, actorID, "rollback")
		if err != nil {
			return err
		}
	}

	return w.Flush(tx)
}
