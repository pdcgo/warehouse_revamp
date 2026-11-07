package supplier_v1

import (
	"context"
	"errors"
)

// GoodsReader is what supplier_service asks inventory about a supplier's GOODS — the batches minted with its id
// (a-batch-keeps-its-supplier). Answered IN-PROCESS by the composition root (cmd/app_development/supplier_goods_reader.go)
// from inventory's own tables, so this service holds no copy of the stock ledger.
type GoodsReader interface {
	// OrderTakeSuppliers is what an order's stock take drew, per product, supplier and owning team — gross, a release's
	// rollback not subtracted. Penjualan's units (penjualan-is-the-selling-value-on-the-order-day).
	OrderTakeSuppliers(ctx context.Context, transactionID uint64) ([]SaleTakePart, error)

	// SupplierIDsByFigure lists the suppliers whose all-time figure lies in [lo, hi), `hi` 0 open-ended — only
	// suppliers WITH goods, so a band from 0 is asked as its complement (the-range-pills-are-a-fixed-set).
	SupplierIDsByFigure(ctx context.Context, figure GoodsFigure, lo, hi int64) ([]uint64, error)

	// StoreGoods is what one supplier's goods did per STORE, all time — the Toko tab's Terjual and Siap with their dates
	// (the-detail-tabs-show-sold-and-ready), the figures its export writes beside each store. Every team's goods
	// (every-selling-team-sees-every-teams-figures); a store none of whose goods ever arrived is absent.
	StoreGoods(ctx context.Context, supplierID uint64) (map[uint64]StoreGoods, error)
}

// StoreGoods is one store's figures: units sold (a cancel counted back) and ready, the last order and the last restock
// in unix seconds — 0 when there was none.
type StoreGoods struct {
	Sold, Ready                    int64
	LastOrderUnix, LastRestockUnix int64
}

// SaleTakePart is one slice of an order's take: units of one product from batches of one supplier, owned by one team.
type SaleTakePart struct {
	ProductID  uint64
	SupplierID uint64
	TeamID     uint64
	Units      int64
}

// GoodsFigure is one of the list's two figures.
type GoodsFigure int

const (
	// GoodsSold is Terjual — every unit sold, all time, a cancel counted back.
	GoodsSold GoodsFigure = iota + 1
	// GoodsReady is Siap — the units on a shelf.
	GoodsReady
)

var errNoGoodsReader = errors.New("no inventory to ask about a supplier's goods")

// noGoods is what a Service built without inventory uses: every question is an ERROR, never an empty answer — a sale
// folded as "no goods" would be acknowledged and lost, and a band read as "nobody" would empty the list.
type noGoods struct{}

func (noGoods) OrderTakeSuppliers(context.Context, uint64) ([]SaleTakePart, error) {
	return nil, errNoGoodsReader
}

func (noGoods) SupplierIDsByFigure(context.Context, GoodsFigure, int64, int64) ([]uint64, error) {
	return nil, errNoGoodsReader
}

func (noGoods) StoreGoods(context.Context, uint64) (map[uint64]StoreGoods, error) {
	return nil, errNoGoodsReader
}
