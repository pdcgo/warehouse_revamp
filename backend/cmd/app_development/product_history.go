package main

import (
	"context"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_v1"
)

// productHistory joins inventory and the order side for product_service's Delete
// (a-used-product-is-archived-never-deleted): a product with history in EITHER is archived, never deleted.
//
// The composition root is the one place allowed to know several services at once. Each service answers for its own
// rows through a plain function over the shared database — not its Service, which would close a cycle: inventory
// already reads products through product_service.
type productHistory struct {
	db *gorm.DB
}

func NewProductHistory(db *gorm.DB) product_v1.ProductHistory {
	return productHistory{db: db}
}

func (h productHistory) ProductHasHistory(ctx context.Context, productID uint64) (bool, error) {
	used, err := inventory_v1.ProductHasHistory(ctx, h.db, productID)
	if err != nil || used {
		return used, err
	}

	return selling_v1.ProductHasHistory(ctx, h.db, productID)
}
