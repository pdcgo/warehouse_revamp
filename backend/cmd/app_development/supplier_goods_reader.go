package main

import (
	"context"
	"fmt"

	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
	supplier_v1 "github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_v1"
)

// supplierGoodsReader answers supplier_service's GoodsReader from inventory's own tables, IN-PROCESS: what an order's
// take drew per supplier (Penjualan, penjualan-is-the-selling-value-on-the-order-day) and which suppliers' Terjual or Siap
// lie in a band (the-range-pills-are-a-fixed-set). Plain methods, not RPCs: the sales fold runs under no caller, and the
// list's band is supplier_service's own question about every team's goods (every-selling-team-sees-every-teams-figures).
//
// inventory reaches supplier_service over Connect (supplier_deps.go), never through *supplier_v1.Service, so this
// direction adds no cycle to the Wire graph.
type supplierGoodsReader struct {
	inventory *inventory_v1.Service
}

func NewSupplierGoodsReader(inventory *inventory_v1.Service) supplier_v1.GoodsReader {
	return &supplierGoodsReader{inventory: inventory}
}

func (r *supplierGoodsReader) OrderTakeSuppliers(ctx context.Context, transactionID uint64) ([]supplier_v1.SaleTakePart, error) {
	rows, err := r.inventory.OrderTakeSuppliers(ctx, transactionID)
	if err != nil {
		return nil, err
	}

	out := make([]supplier_v1.SaleTakePart, 0, len(rows))
	for _, row := range rows {
		out = append(out, supplier_v1.SaleTakePart{
			ProductID: row.ProductID, SupplierID: row.SupplierID, TeamID: row.TeamID, Units: row.Units,
		})
	}

	return out, nil
}

func (r *supplierGoodsReader) SupplierIDsByFigure(
	ctx context.Context,
	figure supplier_v1.GoodsFigure,
	lo, hi int64,
) ([]uint64, error) {
	var asked inventory_v1.SupplierFigure

	switch figure {
	case supplier_v1.GoodsSold:
		asked = inventory_v1.SupplierFigureSold
	case supplier_v1.GoodsReady:
		asked = inventory_v1.SupplierFigureReady
	default:
		return nil, fmt.Errorf("supplier goods reader: unknown figure %d", figure)
	}

	return r.inventory.SupplierIDsByFigure(ctx, asked, lo, hi)
}
