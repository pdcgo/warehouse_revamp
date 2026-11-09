package inventory_v1

import (
	"context"
	"fmt"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// SupplierFigure names one of the two figures the supplier list filters by.
type SupplierFigure int

const (
	// SupplierFigureSold is Terjual — every unit an order took from the supplier's batches, all time, a cancel counted
	// back (SupplierGoods' `sold_units`).
	SupplierFigureSold SupplierFigure = iota + 1
	// SupplierFigureReady is Siap — the units on a shelf in the supplier's batches (SupplierGoods' `ready_units`).
	SupplierFigureReady
)

// SupplierIDsByFigure lists the suppliers whose figure lies in [lo, hi) — `hi` 0 is no upper edge — over EVERY
// team's goods (every-selling-team-sees-every-teams-figures), ascending. An IN-PROCESS seam, not an RPC: supplier_service's
// list narrows by the range pills before it pages (the-range-pills-are-a-fixed-set).
//
// ⚠ Only suppliers WITH goods can be listed here: one whose batches never sold (or that has none) reads 0 and is never
// returned for a band from 0. The caller asks for the complement instead — the ids at or above the band's top — and
// keeps everyone else.
//
// ONE statement. Sold sums every `order` row of `batch_logs` (the same netting SupplierGoods does, in one pass for all
// suppliers); Ready sums the batches still holding stock.
func (s *Service) SupplierIDsByFigure(ctx context.Context, figure SupplierFigure, lo, hi int64) ([]uint64, error) {
	db := s.db.WithContext(ctx)

	var (
		query *gorm.DB
		sum   string
	)

	switch figure {
	case SupplierFigureSold:
		sum = "-SUM(l.change_count)"
		query = db.
			Table(inventory_service_models.BatchLog{}.TableName()+" AS l").
			Joins("JOIN batches b ON b.id = l.batch_id").
			Where("l.change_type = ?", string(inventory_service_models.TxOrder))
	case SupplierFigureReady:
		sum = "SUM(b.stock_count)"
		query = db.
			Table(inventory_service_models.Batch{}.TableName() + " AS b").
			Where("b.stock_count > 0")
	default:
		return nil, fmt.Errorf("supplier ids by figure: unknown figure %d", figure)
	}

	query = query.
		Select("b.supplier_id").
		Where("b.supplier_id <> 0").
		Group("b.supplier_id").
		Having(sum+" >= ?", lo)

	if hi > 0 {
		query = query.Having(sum+" < ?", hi)
	}

	var ids []uint64

	err := query.
		Order("b.supplier_id").
		Pluck("b.supplier_id", &ids).
		Error
	if err != nil {
		return nil, fmt.Errorf("supplier ids by figure: %w", err)
	}

	return ids, nil
}
