package inventory_ledgers

import (
	"fmt"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/pkgs/san_money"
)

// Verify checks the two invariants every mutation's unit test asserts, for one transaction that has not been rolled
// back:
//
//   - both ledgers count the same units: per product, the batch rows' change and the rack rows' change are equal
//     (both-ledgers-count-the-same-units). A move nets 0 on racks with no batch rows; a revaluation moves 0 on both.
//   - an item equals its batch rows: its quantity is the units they moved, its total their value
//     (an-item-equals-its-batch-rows). A move has no batch rows, so its item counts the units off the source rack and
//     totals 0 (a-move-lists-its-units-at-zero-value).
//
// It returns the first broken invariant, naming the product and both numbers.
func Verify(tx *gorm.DB, transactionID uint64) error {
	type side struct {
		ProductID uint64
		Units     int64
		Value     float64
		Out       int64
	}

	var batchSides []side

	err := tx.Raw(`
		SELECT b.product_id, SUM(l.change_count) AS units, SUM(l.change_valuation) AS value, 0 AS out
		FROM batch_logs l
		JOIN batches b ON b.id = l.batch_id
		WHERE l.transaction_id = ?
		GROUP BY b.product_id`, transactionID).Scan(&batchSides).Error
	if err != nil {
		return fmt.Errorf("verify transaction %d, batch rows: %w", transactionID, err)
	}

	var rackSides []side

	err = tx.Raw(`
		SELECT product_id, SUM(stock_change) AS units, 0 AS value,
		       SUM(CASE WHEN stock_change < 0 THEN -stock_change ELSE 0 END) AS out
		FROM product_placement_logs
		WHERE transaction_id = ?
		GROUP BY product_id`, transactionID).Scan(&rackSides).Error
	if err != nil {
		return fmt.Errorf("verify transaction %d, rack rows: %w", transactionID, err)
	}

	type item struct {
		ProductID uint64
		Quantity  int64
		Total     float64
	}

	var items []item

	err = tx.Raw(`SELECT product_id, quantity, total FROM inventory_transaction_items WHERE transaction_id = ?`,
		transactionID).Scan(&items).Error
	if err != nil {
		return fmt.Errorf("verify transaction %d, items: %w", transactionID, err)
	}

	batches := map[uint64]side{}
	for _, s := range batchSides {
		batches[s.ProductID] = s
	}

	racks := map[uint64]side{}
	for _, s := range rackSides {
		racks[s.ProductID] = s
	}

	products := map[uint64]bool{}
	for id := range batches {
		products[id] = true
	}
	for id := range racks {
		products[id] = true
	}

	for id := range products {
		if batches[id].Units != racks[id].Units {
			return fmt.Errorf("transaction %d, product %d: batch rows move %d units, rack rows %d",
				transactionID, id, batches[id].Units, racks[id].Units)
		}
	}

	itemOf := map[uint64]item{}
	for _, it := range items {
		itemOf[it.ProductID] = it
	}

	for id := range products {
		it, ok := itemOf[id]
		if !ok {
			return fmt.Errorf("transaction %d, product %d: moved stock and has no item", transactionID, id)
		}

		b, hasBatchRows := batches[id]

		wantUnits := abs(b.Units)
		wantTotal := abs(b.Value)
		if !hasBatchRows {
			// A move: the units off the source rack, at zero value.
			wantUnits = racks[id].Out
			wantTotal = 0
		}

		if it.Quantity != wantUnits {
			return fmt.Errorf("transaction %d, product %d: item quantity %d, its rows moved %d",
				transactionID, id, it.Quantity, wantUnits)
		}

		if !san_money.Equal(it.Total, wantTotal) {
			return fmt.Errorf("transaction %d, product %d: item total %v, its batch rows hold %v",
				transactionID, id, it.Total, wantTotal)
		}
	}

	for _, it := range items {
		if !products[it.ProductID] {
			return fmt.Errorf("transaction %d, product %d: an item with no rows under it", transactionID, it.ProductID)
		}
	}

	return nil
}

func abs[T int64 | float64](v T) T {
	if v < 0 {
		return -v
	}

	return v
}
