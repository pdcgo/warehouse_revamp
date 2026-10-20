package inventory_ledgers

import (
	"fmt"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// Mint is a new batch: a restock line's good units, a transfer's source batch at the receiver, or a found surplus with
// no loss left to claim.
type Mint struct {
	Transaction inventory_service_models.InventoryTransaction
	// The owner, written now and never changed (a-batch-carries-its-owner).
	TeamID    uint64
	ProductID uint64
	Count     int64
	PriceUnit float64
	// Copied from the restock line or the source batch (a-batch-keeps-its-supplier).
	SupplierID        uint64
	SupplierChannelID uint64
	ExpiredAt         *time.Time
	ChangeType        string
	ActorID           uint64
	Description       string
}

// MintBatch is MintBatches for one batch.
func MintBatch(tx *gorm.DB, m Mint) (inventory_service_models.Batch, error) {
	batches, err := MintBatches(tx, []Mint{m})
	if err != nil {
		return inventory_service_models.Batch{}, err
	}

	return batches[0], nil
}

// MintBatches writes the batches, each one's first log row and its first price (batch-logs-carry-price-unit-after) —
// three statements for any number of batches (ledger-writes-are-set-based). The minted value is count × price; init_*
// keep it for ever. The batches come back in the order given, with their ids.
func MintBatches(tx *gorm.DB, mints []Mint) ([]inventory_service_models.Batch, error) {
	if len(mints) == 0 {
		return nil, nil
	}

	batches := make([]inventory_service_models.Batch, 0, len(mints))

	for _, m := range mints {
		if m.Count <= 0 {
			return nil, fmt.Errorf("mint batch of product %d: count %d is not positive", m.ProductID, m.Count)
		}

		valuation := float64(m.Count) * m.PriceUnit

		batches = append(batches, inventory_service_models.Batch{
			WarehouseID:        m.Transaction.WarehouseID,
			TeamID:             m.TeamID,
			ProductID:          m.ProductID,
			TransactionID:      m.Transaction.ID,
			PriceUnit:          m.PriceUnit,
			StockCount:         m.Count,
			StockValuation:     valuation,
			InitStockCount:     m.Count,
			InitStockValuation: valuation,
			SupplierID:         m.SupplierID,
			SupplierChannelID:  m.SupplierChannelID,
			ExpiredAt:          m.ExpiredAt,
		})
	}

	err := tx.CreateInBatches(&batches, writeBatchSize).Error
	if err != nil {
		return nil, fmt.Errorf("mint %d batch(es): %w", len(batches), err)
	}

	logs := make([]inventory_service_models.BatchLog, 0, len(batches))
	prices := make([]inventory_service_models.BatchPriceLog, 0, len(batches))

	for i, batch := range batches {
		m := mints[i]

		logs = append(logs, inventory_service_models.BatchLog{
			WarehouseID:         batch.WarehouseID,
			TeamID:              batch.TeamID,
			BatchID:             batch.ID,
			TransactionID:       batch.TransactionID,
			ChangeType:          m.ChangeType,
			ChangeCount:         m.Count,
			ChangeValuation:     batch.StockValuation,
			StockCountAfter:     batch.StockCount,
			StockValuationAfter: batch.StockValuation,
			PriceUnitAfter:      batch.PriceUnit,
			Description:         m.Description,
			ActorID:             m.ActorID,
		})

		// A mint is the first price, so its delta is the whole price.
		prices = append(prices, inventory_service_models.BatchPriceLog{
			BatchID:        batch.ID,
			NewPriceUnit:   batch.PriceUnit,
			DeltaPriceUnit: batch.PriceUnit,
			Description:    m.Description,
			ActorID:        m.ActorID,
		})
	}

	err = tx.CreateInBatches(&logs, writeBatchSize).Error
	if err != nil {
		return nil, fmt.Errorf("mint batch logs: %w", err)
	}

	err = tx.CreateInBatches(&prices, writeBatchSize).Error
	if err != nil {
		return nil, fmt.Errorf("mint batch price logs: %w", err)
	}

	return batches, nil
}

// ProductOwner names one owner's stock of one product — the scope a take reaches.
type ProductOwner struct {
	TeamID    uint64
	ProductID uint64
}

// LockedBatches is the owners' batches with units left of some products in one warehouse, LOCKED, each product's
// oldest (lowest id) first. A take reads and changes them in memory; BatchWrites stores the result.
type LockedBatches struct {
	locked  map[ProductOwner]bool
	byOwner map[ProductOwner][]*inventory_service_models.Batch
}

// LockBatches locks every batch with units left of the given owners' products in the warehouse, in ONE statement in id
// order (batches-lock-before-shelves-by-id), so two takes over the same stock queue on the same rows in the same order
// whatever their lines. A take that must name EVERY short line before it writes anything
// (a-refusal-names-its-reason-and-every-line) counts each line from it with Available.
func LockBatches(tx *gorm.DB, warehouseID uint64, owners []ProductOwner) (*LockedBatches, error) {
	out := &LockedBatches{
		locked:  map[ProductOwner]bool{},
		byOwner: map[ProductOwner][]*inventory_service_models.Batch{},
	}

	pairs := make([][]any, 0, len(owners))

	for _, o := range owners {
		if out.locked[o] {
			continue
		}

		out.locked[o] = true
		pairs = append(pairs, []any{o.TeamID, o.ProductID})
	}

	if len(pairs) == 0 {
		return out, nil
	}

	var rows []inventory_service_models.Batch

	err := tx.
		Clauses(clause.Locking{Strength: "UPDATE"}).
		Where("warehouse_id = ? AND (team_id, product_id) IN ? AND stock_count > 0", warehouseID, pairs).
		Order("id").
		Find(&rows).Error
	if err != nil {
		return nil, fmt.Errorf("lock batches of %d product(s): %w", len(pairs), err)
	}

	for i := range rows {
		b := &rows[i]
		key := ProductOwner{TeamID: b.TeamID, ProductID: b.ProductID}
		out.byOwner[key] = append(out.byOwner[key], b)
	}

	return out, nil
}

// Available is the units left in the owner's locked batches of the product.
func (l *LockedBatches) Available(teamID, productID uint64) int64 {
	var available int64
	for _, b := range l.byOwner[ProductOwner{TeamID: teamID, ProductID: productID}] {
		available += b.StockCount
	}

	return available
}

// Take is units leaving the owner's batches of one product in the transaction's warehouse: an order line, a sample, a
// transfer's out-leg, a problem.
type Take struct {
	Transaction inventory_service_models.InventoryTransaction
	// The product's OWNER — whose batches are taken, which for a borrowed order line is not the transaction's team.
	TeamID      uint64
	ProductID   uint64
	Count       int64
	ChangeType  string
	ActorID     uint64
	Description string
}

// BatchTaken is what one batch gave up.
type BatchTaken struct {
	BatchID   uint64
	Count     int64
	Valuation float64
}

// TakeOldestFirst takes units from the owner's LOCKED batches oldest (lowest id) first
// (an-order-takes-from-the-lowest-shelf-first), recording each change in w. A take of n with units left removes value × n
// ÷ units; the take that empties a batch removes all its value, so an emptied batch is worth exactly 0
// (an-emptying-take-takes-all-the-value). Too few units is refused before anything is recorded.
func TakeOldestFirst(locked *LockedBatches, w *BatchWrites, t Take) ([]BatchTaken, error) {
	if t.Count <= 0 {
		return nil, fmt.Errorf("take of product %d: count %d is not positive", t.ProductID, t.Count)
	}

	key := ProductOwner{TeamID: t.TeamID, ProductID: t.ProductID}
	if !locked.locked[key] {
		return nil, fmt.Errorf("take of product %d: its batches of team %d were not locked", t.ProductID, t.TeamID)
	}

	available := locked.Available(t.TeamID, t.ProductID)
	if available < t.Count {
		return nil, &NotEnoughStockError{ProductID: t.ProductID, Wanted: t.Count, Available: available, Ledger: "batches"}
	}

	left := t.Count
	batches := locked.byOwner[key]
	taken := make([]BatchTaken, 0, len(batches))

	for _, b := range batches {
		if left == 0 {
			break
		}

		if b.StockCount == 0 {
			continue
		}

		n := min(left, b.StockCount)
		value := takenValue(b, n)

		b.StockCount -= n
		b.StockValuation -= value
		if b.StockCount == 0 {
			// The emptying take took everything; whatever float dust the subtraction left is not value.
			b.StockValuation = 0
		}

		w.change(b, t.Transaction.ID, t.ChangeType, -n, -value, t.ActorID, t.Description)

		taken = append(taken, BatchTaken{BatchID: b.ID, Count: n, Valuation: value})
		left -= n
	}

	return taken, nil
}

// takenValue is what n units take out of a batch: value × n ÷ units, or all of it when they empty it.
func takenValue(b *inventory_service_models.Batch, n int64) float64 {
	if n >= b.StockCount {
		return b.StockValuation
	}

	return b.StockValuation * float64(n) / float64(b.StockCount)
}

// TotalTaken sums what a take gave up — an item's quantity and total (an-item-equals-its-batch-rows).
func TotalTaken(taken []BatchTaken) (int64, float64) {
	var count int64
	var value float64

	for _, b := range taken {
		count += b.Count
		value += b.Valuation
	}

	return count, value
}

// BatchChange is units leaving or returning to ONE named batch — a provisional adjustment's damaged, lost or found
// (old-shelf-corrections-move-onto-the-ledgers-provisionally).
type BatchChange struct {
	Transaction inventory_service_models.InventoryTransaction
	BatchID     uint64
	Count       int64
	ChangeType  string
	ActorID     uint64
	Description string
}

// TakeFromBatch takes units from one named batch, locked first: n of its units remove value × n ÷ units, and the take
// that empties it removes all its value (an-emptying-take-takes-all-the-value). More than it holds is refused before
// anything is written.
func TakeFromBatch(tx *gorm.DB, c BatchChange) (BatchTaken, error) {
	if c.Count <= 0 {
		return BatchTaken{}, fmt.Errorf("take from batch %d: count %d is not positive", c.BatchID, c.Count)
	}

	b, err := lockBatch(tx, c.BatchID)
	if err != nil {
		return BatchTaken{}, err
	}

	if b.StockCount < c.Count {
		return BatchTaken{}, &NotEnoughStockError{ProductID: b.ProductID, Wanted: c.Count, Available: b.StockCount, Ledger: "batches"}
	}

	value := takenValue(&b, c.Count)

	b.StockCount -= c.Count
	b.StockValuation -= value
	if b.StockCount == 0 {
		b.StockValuation = 0
	}

	var w BatchWrites
	w.change(&b, c.Transaction.ID, c.ChangeType, -c.Count, -value, c.ActorID, c.Description)

	err = w.Flush(tx)
	if err != nil {
		return BatchTaken{}, err
	}

	return BatchTaken{BatchID: b.ID, Count: c.Count, Valuation: value}, nil
}

// AddToBatch returns units to one named batch at its price, locked first — a found unit going back where it was lost
// from. Returns the value added.
func AddToBatch(tx *gorm.DB, c BatchChange) (BatchTaken, error) {
	if c.Count <= 0 {
		return BatchTaken{}, fmt.Errorf("add to batch %d: count %d is not positive", c.BatchID, c.Count)
	}

	b, err := lockBatch(tx, c.BatchID)
	if err != nil {
		return BatchTaken{}, err
	}

	value := float64(c.Count) * b.PriceUnit

	b.StockCount += c.Count
	b.StockValuation += value

	var w BatchWrites
	w.change(&b, c.Transaction.ID, c.ChangeType, c.Count, value, c.ActorID, c.Description)

	err = w.Flush(tx)
	if err != nil {
		return BatchTaken{}, err
	}

	return BatchTaken{BatchID: b.ID, Count: c.Count, Valuation: value}, nil
}

func lockBatch(tx *gorm.DB, batchID uint64) (inventory_service_models.Batch, error) {
	var b inventory_service_models.Batch

	err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&b, batchID).Error
	if err != nil {
		return b, fmt.Errorf("lock batch %d: %w", batchID, err)
	}

	return b, nil
}
