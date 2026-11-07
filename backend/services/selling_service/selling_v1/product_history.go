package selling_v1

import (
	"context"

	"gorm.io/gorm"
)

// ProductHasHistory answers, for product_service's Delete, whether the order side ever named a product
// (a-used-product-is-archived-never-deleted): an order line in ANY team's order — a borrowed line names the owner's
// product — or a return map on either side. Any one is history, and the product is archived instead. A draft line names
// no product since selling 00047 (a-draft-stores-no-mapping), so drafts are no history.
//
// A plain function over selling's own tables, not an RPC: the composition root calls it (HARD RULE 3).
func ProductHasHistory(ctx context.Context, db *gorm.DB, productID uint64) (bool, error) {
	var used bool

	err := db.WithContext(ctx).Raw(`
SELECT EXISTS (SELECT 1 FROM order_items WHERE product_id = @id)
    OR EXISTS (SELECT 1 FROM product_return_maps WHERE shared_product_id = @id OR own_product_id = @id)`,
		map[string]any{"id": productID},
	).Scan(&used).Error

	return used, err
}
