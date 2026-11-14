package main

import (
	"context"
	"time"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_v1"
)

// productStockNarrower answers product_service's StockNarrower from inventory's own batches, IN-PROCESS: which products
// a minimum closes now (a-minimum-closes-only-under-it) and which have stock at least N days old (the-dates-read-as-ages)
// — the product list's Kunci *Terkunci sekarang* and Umur stok filters (lock-and-stock-age-filter-ahead-of-the-contract)
// and Discover's Kunci — and which products the shelves hold, how many ready and at what cost spread: Discover's Gudang,
// Stok siap and Harga cross (discovers-warehouse-keeps-ready-stock-there, a-cross-band-keeps-a-range-that-touches-it).
// The cost spread crosses only this in-process seam; product_service prices it with the markup and never sends it.
//
// Plain functions over the shared database, as productHistory is — not *inventory_v1.Service: inventory already reads
// products through product_service (product_reader.go), so a Service dep here would close a cycle in the Wire graph.
type productStockNarrower struct {
	db *gorm.DB
	// now is the clock the age is counted from — time.Now, a fixed instant in tests.
	now func() time.Time
}

func NewProductStockNarrower(db *gorm.DB) product_v1.StockNarrower {
	return productStockNarrower{db: db, now: time.Now}
}

func (n productStockNarrower) ClosedByMinimum(ctx context.Context, candidates []product_v1.MinimumCandidate) ([]uint64, error) {
	asked := make([]inventory_v1.MinimumCandidate, 0, len(candidates))
	for _, c := range candidates {
		asked = append(asked, inventory_v1.MinimumCandidate{TeamID: c.TeamID, ProductID: c.ProductID, Minimum: int64(c.Minimum)})
	}

	return inventory_v1.ClosedByMinimum(ctx, n.db, asked)
}

// AgedAtLeast turns whole days into the arrival cutoff: an age of N days is N elapsed 24 h periods since the oldest ready
// batch arrived (the screen's daysAgo floors the same way), so "at least N days" is "arrived at or before now − N × 24 h".
func (n productStockNarrower) AgedAtLeast(ctx context.Context, teamID, warehouseID uint64, days uint32) ([]uint64, error) {
	cutoff := n.now().Add(-time.Duration(days) * 24 * time.Hour)

	return inventory_v1.ProductIDsAgedSince(ctx, n.db, teamID, warehouseID, cutoff)
}

func (n productStockNarrower) ShelvedProducts(ctx context.Context, ask product_v1.ShelfAsk) ([]product_v1.ShelvedProduct, error) {
	rows, err := inventory_v1.ShelvedProducts(ctx, n.db, inventory_v1.ShelfAsk{
		WarehouseID: ask.WarehouseID,
		ReadyMin:    ask.ReadyMin,
		ReadyMax:    ask.ReadyMax,
		CostAtMost:  ask.CostAtMost,
		CostAtLeast: ask.CostAtLeast,
	})
	if err != nil {
		return nil, err
	}

	return shelvedForProducts(rows), nil
}

func (n productStockNarrower) ProductsReadyAbove(ctx context.Context, ceiling int64) ([]product_v1.ShelvedProduct, error) {
	rows, err := inventory_v1.ProductsReadyAbove(ctx, n.db, ceiling)
	if err != nil {
		return nil, err
	}

	return shelvedForProducts(rows), nil
}

func shelvedForProducts(rows []inventory_v1.ShelvedProduct) []product_v1.ShelvedProduct {
	out := make([]product_v1.ShelvedProduct, 0, len(rows))
	for _, r := range rows {
		out = append(out, product_v1.ShelvedProduct{TeamID: r.TeamID, ProductID: r.ProductID, CostMin: r.CostMin, CostMax: r.CostMax})
	}

	return out
}
