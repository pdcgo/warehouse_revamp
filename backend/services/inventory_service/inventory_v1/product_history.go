package inventory_v1

import (
	"context"

	"gorm.io/gorm"
)

// ProductHasHistory answers, for product_service's Delete, whether inventory ever held or moved a product
// (a-used-product-is-archived-never-deleted): a restock line, a problem unit, a batch, a placement or its log, a stock
// transaction, a transfer line, or the product registered at a warehouse. Any one is history — the product is archived,
// never deleted, so nothing here is ever left naming a product that is gone.
//
// A plain function over inventory's own tables, not an RPC: the composition root calls it, and it reads nothing but
// inventory's rows (HARD RULE 3).
func ProductHasHistory(ctx context.Context, db *gorm.DB, productID uint64) (bool, error) {
	var used bool

	err := db.WithContext(ctx).Raw(`
SELECT EXISTS (SELECT 1 FROM restock_items WHERE product_id = @id)
    OR EXISTS (SELECT 1 FROM restock_problem_items WHERE product_id = @id)
    OR EXISTS (SELECT 1 FROM batches WHERE product_id = @id)
    OR EXISTS (SELECT 1 FROM product_placements WHERE product_id = @id)
    OR EXISTS (SELECT 1 FROM product_placement_logs WHERE product_id = @id)
    OR EXISTS (SELECT 1 FROM inventory_transaction_items WHERE product_id = @id)
    OR EXISTS (SELECT 1 FROM warehouse_transfer_items WHERE product_id = @id)
    OR EXISTS (SELECT 1 FROM warehouse_transfer_problem_items WHERE product_id = @id)
    OR EXISTS (SELECT 1 FROM warehouse_products WHERE product_id = @id)`,
		map[string]any{"id": productID},
	).Scan(&used).Error

	return used, err
}
