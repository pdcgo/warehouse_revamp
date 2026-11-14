package inventory_v1

import (
	"context"
	"fmt"

	"gorm.io/gorm"
)

// ShelfAsk is what Discover's Gudang, Stok siap and Harga cross filters ask of the shelves
// (discovers-warehouse-keeps-ready-stock-there, discover-ranges-are-picked, a-cross-band-keeps-a-range-that-touches-it):
// the products holding READY units in one warehouse (or any), optionally with that ready figure inside a range, and
// optionally with a cost spread that MAY price inside a cross band.
type ShelfAsk struct {
	// WarehouseID is the warehouse every figure reads; 0 = every warehouse, summed.
	WarehouseID uint64
	// ReadyMin and ReadyMax bound the ready units, both included; nil = no edge on that side. A product only comes back
	// when it holds at least one ready unit, so a range from 0 asked here keeps no product without stock — that set is
	// ProductsReadyAbove's complement.
	ReadyMin *int64
	ReadyMax *int64
	// CostAtMost and CostAtLeast pre-cut the cost spread for a cross band: keep only MIN(cost) <= CostAtMost and
	// MAX(cost) >= CostAtLeast; nil = no cut on that side. The caller derives them from the band and the markups it holds
	// so that the cut never drops a product its exact cross test would keep — the cut only keeps the answer small.
	CostAtMost  *float64
	CostAtLeast *float64
}

// ShelvedProduct is one product holding ready units in the asked warehouse: its owner, its id and the spread of the unit
// costs of its batches holding units there. The costs stay in-process — the caller turns them into cross prices with
// the product's markup and never sends them (discover-shows-the-cross-price).
type ShelvedProduct struct {
	TeamID    uint64
	ProductID uint64
	CostMin   float64
	CostMax   float64
}

// ShelvedProducts answers a ShelfAsk in ONE grouped read of the live batches: every (owner, product) holding ready units
// in the warehouse (or any), its ready units summed and its cost spread, cut by the ask in the HAVING. The rows come
// back in (team, product) order.
//
// The figures are DiscoverStockByIds' own (discoverShelves): the owner's batches with `stock_count > 0`, ready = their
// units summed, the cost spread = MIN/MAX of their unit price — so a card and the filter that kept it never disagree.
// `stock_count > 0` changes no sum (an emptied batch adds 0), keeps an emptied batch's price out of the spread, and lets
// the planner read the partial indexes (batches_take_idx for one warehouse, batches_owner_product_idx for all).
//
// A plain function over inventory's own table (HARD RULE 3): product_service's Discover asks it through the composition
// root's seam (cmd/app_development/product_stock_narrower.go).
func ShelvedProducts(ctx context.Context, db *gorm.DB, ask ShelfAsk) ([]ShelvedProduct, error) {
	query := db.
		WithContext(ctx).
		Table("batches").
		Select("team_id, product_id, MIN(price_unit) AS cost_min, MAX(price_unit) AS cost_max").
		Where("stock_count > 0")

	if ask.WarehouseID > 0 {
		query = query.Where("warehouse_id = ?", ask.WarehouseID)
	}

	query = query.Group("team_id, product_id")

	if ask.ReadyMin != nil {
		query = query.Having("SUM(stock_count) >= ?", *ask.ReadyMin)
	}

	if ask.ReadyMax != nil {
		query = query.Having("SUM(stock_count) <= ?", *ask.ReadyMax)
	}

	if ask.CostAtMost != nil {
		query = query.Having("MIN(price_unit) <= ?", *ask.CostAtMost)
	}

	if ask.CostAtLeast != nil {
		query = query.Having("MAX(price_unit) >= ?", *ask.CostAtLeast)
	}

	var rows []ShelvedProduct

	err := query.
		Order("team_id, product_id").
		Scan(&rows).
		Error
	if err != nil {
		return nil, fmt.Errorf("shelved products, warehouse %d: %w", ask.WarehouseID, err)
	}

	return rows, nil
}

// ProductsReadyAbove returns every (owner, product) whose ready units across EVERY warehouse are ABOVE `ceiling` — the
// set a Stok siap range from 0 up to `ceiling` leaves out. Asked as the complement because the range keeps the products with no
// stock row at all (0 ready), which no read of the batches can list (the-range-pills-are-a-fixed-set narrows the
// supplier list the same way). Only the ids and owners come back, in (team, product) order.
func ProductsReadyAbove(ctx context.Context, db *gorm.DB, ceiling int64) ([]ShelvedProduct, error) {
	var rows []ShelvedProduct

	err := db.
		WithContext(ctx).
		Table("batches").
		Select("team_id, product_id").
		Where("stock_count > 0").
		Group("team_id, product_id").
		Having("SUM(stock_count) > ?", ceiling).
		Order("team_id, product_id").
		Scan(&rows).
		Error
	if err != nil {
		return nil, fmt.Errorf("products ready above %d: %w", ceiling, err)
	}

	return rows, nil
}
