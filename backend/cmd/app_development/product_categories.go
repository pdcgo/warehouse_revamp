package main

import (
	"context"

	"gorm.io/gorm"

	"github.com/pdcgo/warehouse_revamp/backend/services/category_service/category_v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_v1"
)

// productCategoryTree answers product_service's CategoryTree from category_service's own table, IN-PROCESS: a category
// and every category below it — Discover's Kategori (a-picked-branch-keeps-its-whole-subtree). A plain function over the
// shared database, as productStockNarrower is: product_service never joins to `categories` (HARD RULE 3).
type productCategoryTree struct {
	db *gorm.DB
}

func NewProductCategoryTree(db *gorm.DB) product_v1.CategoryTree {
	return productCategoryTree{db: db}
}

func (c productCategoryTree) SubtreeIDs(ctx context.Context, categoryID uint64) ([]uint64, error) {
	return category_v1.SubtreeIDs(ctx, c.db, categoryID)
}
