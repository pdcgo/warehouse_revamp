package inventory_ledgers

import (
	"fmt"
	"strconv"
	"strings"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// SET-BASED WRITES (ledger-writes-are-set-based). A mutation works out every row's change in memory, on rows it has
// already LOCKED, and the ledger then writes them in two statements per ledger — one UPDATE of the state rows and one
// INSERT of the log rows — whatever the number of lines. The arithmetic stays one row at a time, in the order the rules
// give; only the round trips are shared. A row changed twice in one call is updated once, to its last state, and logged
// twice, each log row carrying the state after its own change.

// writeBatchSize keeps a multi-row INSERT under Postgres's 65 535 parameters (a log row has 13 columns).
const writeBatchSize = 1000

// BatchWrites collects changes to LOCKED batches until Flush.
type BatchWrites struct {
	changed map[uint64]*inventory_service_models.Batch
	order   []uint64
	logs    []inventory_service_models.BatchLog
}

// change records a locked batch already carrying its new state, and the log row of the change.
func (w *BatchWrites) change(
	b *inventory_service_models.Batch,
	transactionID uint64,
	changeType string,
	count int64,
	value float64,
	actorID uint64,
	description string,
) {
	if w.changed == nil {
		w.changed = map[uint64]*inventory_service_models.Batch{}
	}

	if _, seen := w.changed[b.ID]; !seen {
		w.order = append(w.order, b.ID)
	}

	w.changed[b.ID] = b
	w.logs = append(w.logs, inventory_service_models.BatchLog{
		WarehouseID:         b.WarehouseID,
		TeamID:              b.TeamID,
		BatchID:             b.ID,
		TransactionID:       transactionID,
		ChangeType:          changeType,
		ChangeCount:         count,
		ChangeValuation:     value,
		StockCountAfter:     b.StockCount,
		StockValuationAfter: b.StockValuation,
		PriceUnitAfter:      b.PriceUnit,
		Description:         description,
		ActorID:             actorID,
	})
}

// Flush writes every changed batch's state in ONE update and every log row in ONE insert, then empties the collector.
func (w *BatchWrites) Flush(tx *gorm.DB) error {
	if len(w.logs) == 0 {
		return nil
	}

	ids := make([]int64, 0, len(w.order))
	counts := make([]int64, 0, len(w.order))
	values := make([]float64, 0, len(w.order))

	for _, id := range w.order {
		b := w.changed[id]
		ids = append(ids, int64(b.ID))
		counts = append(counts, b.StockCount)
		values = append(values, b.StockValuation)
	}

	err := tx.Exec(`
		UPDATE batches AS b
		SET stock_count = v.stock_count, stock_valuation = v.stock_valuation, updated_at = NOW()
		FROM unnest(CAST(? AS bigint[]), CAST(? AS bigint[]), CAST(? AS double precision[]))
		     AS v(id, stock_count, stock_valuation)
		WHERE b.id = v.id`,
		int64Array(ids), int64Array(counts), float64Array(values),
	).Error
	if err != nil {
		return fmt.Errorf("change %d batch(es): %w", len(ids), err)
	}

	err = tx.CreateInBatches(&w.logs, writeBatchSize).Error
	if err != nil {
		return fmt.Errorf("log %d batch change(s): %w", len(w.logs), err)
	}

	*w = BatchWrites{}

	return nil
}

// RackWrites collects changes to LOCKED rack rows until Flush.
type RackWrites struct {
	changed map[uint64]*inventory_service_models.ProductPlacement
	order   []uint64
	logs    []inventory_service_models.ProductPlacementLog
}

// Apply moves a LOCKED rack row by `change` and records its log row with the count after. A change that would take the
// row below zero is refused (a-shelf-never-goes-below-zero) before it is recorded; the database's CHECK is the backstop.
func (w *RackWrites) Apply(
	t inventory_service_models.InventoryTransaction,
	row *inventory_service_models.ProductPlacement,
	change int64,
	changeType string,
	actorID uint64,
	description string,
) (RackChange, error) {
	if row.StockCount+change < 0 {
		return RackChange{}, &NotEnoughStockError{
			ProductID: row.ProductID, Wanted: -change, Available: row.StockCount, Ledger: "placements",
		}
	}

	row.StockCount += change

	if w.changed == nil {
		w.changed = map[uint64]*inventory_service_models.ProductPlacement{}
	}

	if _, seen := w.changed[row.ID]; !seen {
		w.order = append(w.order, row.ID)
	}

	w.changed[row.ID] = row
	w.logs = append(w.logs, inventory_service_models.ProductPlacementLog{
		WarehouseID:   row.WarehouseID,
		TeamID:        row.TeamID,
		ProductID:     row.ProductID,
		PlacementID:   row.PlacementID,
		TransactionID: t.ID,
		ChangeType:    changeType,
		StockChange:   change,
		StockAfter:    row.StockCount,
		Description:   description,
		ActorID:       actorID,
	})

	return RackChange{PlacementID: row.PlacementID, ProductID: row.ProductID, Change: change, After: row.StockCount}, nil
}

// Flush writes every changed rack row's count in ONE update and every log row in ONE insert, then empties the collector.
func (w *RackWrites) Flush(tx *gorm.DB) error {
	if len(w.logs) == 0 {
		return nil
	}

	ids := make([]int64, 0, len(w.order))
	counts := make([]int64, 0, len(w.order))

	for _, id := range w.order {
		row := w.changed[id]
		ids = append(ids, int64(row.ID))
		counts = append(counts, row.StockCount)
	}

	err := tx.Exec(`
		UPDATE product_placements AS p
		SET stock_count = v.stock_count, updated_at = NOW()
		FROM unnest(CAST(? AS bigint[]), CAST(? AS bigint[])) AS v(id, stock_count)
		WHERE p.id = v.id`,
		int64Array(ids), int64Array(counts),
	).Error
	if err != nil {
		return fmt.Errorf("change %d rack row(s): %w", len(ids), err)
	}

	err = tx.CreateInBatches(&w.logs, writeBatchSize).Error
	if err != nil {
		return fmt.Errorf("log %d rack change(s): %w", len(w.logs), err)
	}

	*w = RackWrites{}

	return nil
}

// int64Array is a Postgres array literal, bound as ONE parameter — GORM would expand a Go slice into a list.
func int64Array(values []int64) string {
	parts := make([]string, 0, len(values))
	for _, v := range values {
		parts = append(parts, strconv.FormatInt(v, 10))
	}

	return "{" + strings.Join(parts, ",") + "}"
}

// float64Array is int64Array for money: each value in the shortest form that reads back as the SAME double, so nothing is
// rounded on the way in (stock-money-is-float64-compared-at-4-digits).
func float64Array(values []float64) string {
	parts := make([]string, 0, len(values))
	for _, v := range values {
		parts = append(parts, strconv.FormatFloat(v, 'g', -1, 64))
	}

	return "{" + strings.Join(parts, ",") + "}"
}
