package supplier_v1

import (
	"context"
	"errors"
)

// GoodsReader is what supplier_service asks inventory about a supplier's GOODS — the batches minted with its id
// (a-batch-keeps-its-supplier). Answered IN-PROCESS by the composition root (cmd/app_development/supplier_goods_reader.go)
// from inventory's own tables, so this service holds no copy of the stock ledger.
type GoodsReader interface {
	// OrderTakeSuppliers is what an order's stock take drew, per product, supplier, owning team and warehouse — gross, a
	// release's rollback not subtracted. Penjualan's units (penjualan-is-the-selling-value-on-the-order-day), in the
	// warehouse they were taken from (the-supplier-reports-carry-the-warehouse).
	OrderTakeSuppliers(ctx context.Context, transactionID uint64) ([]SaleTakePart, error)

	// SupplierIDsByFigure lists the suppliers whose all-time figure lies in [lo, hi), `hi` 0 open-ended — only
	// suppliers WITH goods, so a band from 0 is asked as its complement (the-range-pills-are-a-fixed-set).
	SupplierIDsByFigure(ctx context.Context, figure GoodsFigure, lo, hi int64) ([]uint64, error)

	// StoreGoods is what one supplier's goods did per STORE, all time — the Toko tab's Terjual and Siap with their dates
	// (the-detail-tabs-show-sold-and-ready), the figures its export writes beside each store. Every team's goods
	// (every-selling-team-sees-every-teams-figures); a store none of whose goods ever arrived is absent. `warehouseID` is
	// the page's Gudang terkait chip: only the goods in that warehouse (0 = every warehouse).
	StoreGoods(ctx context.Context, supplierID, warehouseID uint64) (map[uint64]StoreGoods, error)
}

// WarehouseGoods is the Gudang filter's question, asked of the same GoodsReader: the suppliers whose goods were received at
// a warehouse, in id order — exactly the suppliers whose page lists it among its Gudang terkait chips, every team's goods
// (the-warehouse-filters-before-the-team). The composition root's reader answers it; a reader without it (the operations
// tool's, which never lists suppliers) makes a list with a warehouse picked an error, never an empty page. Kept apart
// from GoodsReader so that reader needs no new method.
//
// A supplier page's Gudang terkait chip asks it too (a-supplier-page-is-scoped-by-its-warehouses), by the same test: the
// supplier's stores whose goods were received at the warehouse (the Toko tab), and the (store, product) pairs of its goods
// received there — store 0 for a line that named the supplier alone (the Produk tab). Both narrow a tab BEFORE its count
// and page.
type WarehouseGoods interface {
	SupplierIDsAtWarehouse(ctx context.Context, warehouseID uint64) ([]uint64, error)
	StoresAtWarehouse(ctx context.Context, supplierID, warehouseID uint64) ([]uint64, error)
	StoreProductsAtWarehouse(ctx context.Context, supplierID, warehouseID uint64) ([]StoreProduct, error)
}

// ProductGoods is the Produk tab's question, asked of the same GoodsReader by type assertion: what one supplier's goods
// did per STORE AND PRODUCT, all time — only for the pairs of one page (the-detail-tabs-show-sold-and-ready), so a page
// costs one read whatever its size, never one per row. Every team's goods (every-selling-team-sees-every-teams-figures);
// a pair none of whose goods ever arrived is absent. Kept apart from GoodsReader, as WarehouseGoods is, so the operations
// tool's reader needs no new method; a reader without it makes the tab an error, never a page of dashes. `warehouseID` is
// the page's Gudang terkait chip: each figure counts only the goods in that warehouse (0 = every warehouse).
type ProductGoods interface {
	StoreProductGoods(ctx context.Context, supplierID, warehouseID uint64, pairs []StoreProduct) (map[StoreProduct]StoreGoods, error)
}

// StoreProduct is one row's key on the Produk tab: a store (0 = bought with no store) and a product.
type StoreProduct struct {
	StoreID, ProductID uint64
}

// StoreGoods is one store's figures (or one product's at a store): units sold (a cancel counted back) and ready, the
// orders the units went out on, the last order and the last restock in unix seconds — 0 when there was none.
type StoreGoods struct {
	Sold, Ready                    int64
	Orders                         int64
	LastOrderUnix, LastRestockUnix int64
}

// SaleTakePart is one slice of an order's take: units of one product from batches of one supplier, owned by one team,
// in one warehouse — the warehouse they were TAKEN from, Penjualan's warehouse (the-supplier-reports-carry-the-warehouse).
type SaleTakePart struct {
	ProductID   uint64
	SupplierID  uint64
	TeamID      uint64
	WarehouseID uint64
	Units       int64
}

// GoodsFigure is one of the list's two figures.
type GoodsFigure int

const (
	// GoodsSold is Terjual — every unit sold, all time, a cancel counted back.
	GoodsSold GoodsFigure = iota + 1
	// GoodsReady is Siap — the units on a shelf.
	GoodsReady
)

var (
	errNoGoodsReader    = errors.New("no inventory to ask about a supplier's goods")
	errNoWarehouseGoods = errors.New("no inventory to ask where a supplier's goods were received")
	errNoProductGoods   = errors.New("no inventory to ask what a supplier's goods did per store and product")
)

// noGoods is what a Service built without inventory uses: every question is an ERROR, never an empty answer — a sale
// folded as "no goods" would be acknowledged and lost, and a band read as "nobody" would empty the list.
type noGoods struct{}

func (noGoods) OrderTakeSuppliers(context.Context, uint64) ([]SaleTakePart, error) {
	return nil, errNoGoodsReader
}

func (noGoods) SupplierIDsByFigure(context.Context, GoodsFigure, int64, int64) ([]uint64, error) {
	return nil, errNoGoodsReader
}

func (noGoods) StoreGoods(context.Context, uint64, uint64) (map[uint64]StoreGoods, error) {
	return nil, errNoGoodsReader
}
