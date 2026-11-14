package main

import (
	"context"
	"fmt"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	inventory_v1 "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
	supplier_v1 "github.com/pdcgo/warehouse_revamp/backend/services/supplier_service/supplier_v1"
)

// supplierGoodsReader answers supplier_service's GoodsReader from inventory's own tables, IN-PROCESS: what an order's
// take drew per supplier (Penjualan, penjualan-is-the-selling-value-on-the-order-day) and which suppliers' Terjual or Siap
// lie in a band (the-range-pills-are-a-fixed-set). Plain methods, not RPCs: the sales fold runs under no caller, and the
// list's band is supplier_service's own question about every team's goods (every-selling-team-sees-every-teams-figures).
// It answers supplier_service's WarehouseGoods too — the list's Gudang filter (the-warehouse-filters-before-the-team) and
// a supplier page's Gudang terkait chip over its Toko and Produk tabs (a-supplier-page-is-scoped-by-its-warehouses) —
// and its ProductGoods — the Produk tab's figures per store and product (the-detail-tabs-show-sold-and-ready) — each from
// inventory's PLAIN function over the shared database (productStockNarrower's shape).
//
// inventory reaches supplier_service over Connect (supplier_deps.go), never through *supplier_v1.Service, so this
// direction adds no cycle to the Wire graph.
type supplierGoodsReader struct {
	inventory *inventory_v1.Service
	db        *gorm.DB
}

var (
	_ supplier_v1.WarehouseGoods = (*supplierGoodsReader)(nil)
	_ supplier_v1.ProductGoods   = (*supplierGoodsReader)(nil)
)

func NewSupplierGoodsReader(inventory *inventory_v1.Service, db *gorm.DB) supplier_v1.GoodsReader {
	return &supplierGoodsReader{inventory: inventory, db: db}
}

// SupplierIDsAtWarehouse is the Gudang filter's set: the suppliers whose page lists the warehouse among Gudang terkait.
func (r *supplierGoodsReader) SupplierIDsAtWarehouse(ctx context.Context, warehouseID uint64) ([]uint64, error) {
	return inventory_v1.SupplierIDsAtWarehouse(ctx, r.db, warehouseID)
}

// StoresAtWarehouse is the Toko tab under a Gudang terkait chip (a-supplier-page-is-scoped-by-its-warehouses): the
// supplier's stores whose goods were received at the warehouse — the chips' own test, inventory's plain function.
func (r *supplierGoodsReader) StoresAtWarehouse(ctx context.Context, supplierID, warehouseID uint64) ([]uint64, error) {
	return inventory_v1.SupplierStoresAtWarehouse(ctx, r.db, supplierID, warehouseID)
}

// StoreProductsAtWarehouse is the Produk tab under the chip: the (store, product) pairs of the supplier's goods received
// at the warehouse, store 0 for a line that named the supplier alone.
func (r *supplierGoodsReader) StoreProductsAtWarehouse(
	ctx context.Context,
	supplierID, warehouseID uint64,
) ([]supplier_v1.StoreProduct, error) {
	rows, err := inventory_v1.SupplierStoreProductsAtWarehouse(ctx, r.db, supplierID, warehouseID)
	if err != nil {
		return nil, err
	}

	out := make([]supplier_v1.StoreProduct, 0, len(rows))
	for _, row := range rows {
		out = append(out, supplier_v1.StoreProduct{StoreID: row.StoreID, ProductID: row.ProductID})
	}

	return out, nil
}

// StoreProductGoods is the Produk tab's Terjual and Siap for one page's (store, product) pairs — inventory's PLAIN
// function over its batches, one statement per page (the-detail-tabs-show-sold-and-ready); under a chip, that
// warehouse's goods only. Every team's goods; the tab's own policy ran at its door.
func (r *supplierGoodsReader) StoreProductGoods(
	ctx context.Context,
	supplierID, warehouseID uint64,
	pairs []supplier_v1.StoreProduct,
) (map[supplier_v1.StoreProduct]supplier_v1.StoreGoods, error) {
	asked := make([]inventory_v1.StoreProduct, 0, len(pairs))
	for _, pair := range pairs {
		asked = append(asked, inventory_v1.StoreProduct{StoreID: pair.StoreID, ProductID: pair.ProductID})
	}

	rows, err := inventory_v1.SupplierStoreProductGoods(ctx, r.db, supplierID, warehouseID, asked)
	if err != nil {
		return nil, err
	}

	out := make(map[supplier_v1.StoreProduct]supplier_v1.StoreGoods, len(rows))
	for _, row := range rows {
		var lastOrder int64
		if row.LastOrder != nil {
			lastOrder = row.LastOrder.Unix()
		}

		out[supplier_v1.StoreProduct{StoreID: row.StoreID, ProductID: row.ProductID}] = supplier_v1.StoreGoods{
			Sold:          row.Sold,
			Ready:         row.Ready,
			Orders:        row.Orders,
			LastOrderUnix: lastOrder,
		}
	}

	return out, nil
}

func (r *supplierGoodsReader) OrderTakeSuppliers(ctx context.Context, transactionID uint64) ([]supplier_v1.SaleTakePart, error) {
	rows, err := r.inventory.OrderTakeSuppliers(ctx, transactionID)
	if err != nil {
		return nil, err
	}

	out := make([]supplier_v1.SaleTakePart, 0, len(rows))
	for _, row := range rows {
		out = append(out, supplier_v1.SaleTakePart{
			ProductID: row.ProductID, SupplierID: row.SupplierID, TeamID: row.TeamID, WarehouseID: row.WarehouseID,
			Units: row.Units,
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

// StoreGoods is the Toko tab's figures per store for one supplier — inventory's SupplierGoods grouped by STORE, called
// in-process: the export's own policy ran at its door, and SupplierGoods' team_id only authorizes (it never narrows the
// figures, every-selling-team-sees-every-teams-figures), so the read here passes none. Under a chip, that warehouse's.
func (r *supplierGoodsReader) StoreGoods(ctx context.Context, supplierID, warehouseID uint64) (map[uint64]supplier_v1.StoreGoods, error) {
	res, err := r.inventory.SupplierGoods(ctx, connect.NewRequest(&inventoryv1.SupplierGoodsRequest{
		SupplierIds: []uint64{supplierID},
		Group:       inventoryv1.SupplierGoodsGroup_SUPPLIER_GOODS_GROUP_STORE,
		WarehouseId: warehouseID,
	}))
	if err != nil {
		return nil, err
	}

	out := make(map[uint64]supplier_v1.StoreGoods, len(res.Msg.GetRows()))
	for _, row := range res.Msg.GetRows() {
		out[row.GetStoreId()] = supplier_v1.StoreGoods{
			Sold:            row.GetSoldUnits(),
			Ready:           row.GetReadyUnits(),
			Orders:          row.GetOrders(),
			LastOrderUnix:   row.GetLastOrderUnix(),
			LastRestockUnix: row.GetLastRestockUnix(),
		}
	}

	return out, nil
}
