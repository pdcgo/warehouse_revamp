package inventory_v1

import (
	"context"
	"fmt"

	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// OrderTakeSupplier is one slice of an order's stock take: the units drawn from batches carrying one supplier, of one
// product, owned by one team (the batch's team, the team that restocked them).
type OrderTakeSupplier struct {
	ProductID  uint64
	SupplierID uint64
	TeamID     uint64
	Units      int64
}

// OrderTakeSuppliers reads what an order's take drew, by supplier, product and owning team. It is an IN-PROCESS seam,
// not an RPC: supplier_service's sales fold asks it when an order is placed or cancelled, so Penjualan counts the same
// goods Terjual does — the batches minted with the supplier's id
// (penjualan-is-the-selling-value-on-the-order-day, a-batch-keeps-its-supplier).
//
//   - GROSS: only the take's own rows (`change_count < 0`), never a release's rollback rows, so a placement folded after
//     its cancel reads the same parts as one folded before.
//   - A batch naming no supplier is left out: those units belong to no supplier's figures.
//   - Transaction 0 (an order that never took stock) reads nothing.
//
// ONE statement on `batch_logs_transaction_idx`.
func (s *Service) OrderTakeSuppliers(ctx context.Context, transactionID uint64) ([]OrderTakeSupplier, error) {
	if transactionID == 0 {
		return nil, nil
	}

	var rows []OrderTakeSupplier

	err := s.db.
		WithContext(ctx).
		Table(inventory_service_models.BatchLog{}.TableName()+" AS l").
		Select("b.product_id, b.supplier_id, b.team_id, -SUM(l.change_count) AS units").
		Joins("JOIN batches b ON b.id = l.batch_id").
		Where("l.transaction_id = ?", transactionID).
		Where("l.change_type = ?", string(inventory_service_models.TxOrder)).
		Where("l.change_count < 0").
		Where("b.supplier_id <> 0").
		Group("b.product_id, b.supplier_id, b.team_id").
		Order("b.product_id, b.supplier_id, b.team_id").
		Scan(&rows).
		Error
	if err != nil {
		return nil, fmt.Errorf("order take suppliers: %w", err)
	}

	return rows, nil
}
