package inventory_v1

import (
	"context"
	"strconv"
	"strings"

	"gorm.io/gorm"

	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// HeldAmong returns, of `productIDs`, those the warehouse `warehouseID` has HELD — a batch there, ever, at 0 today too:
// the set its Products list shows (a-warehouses-products-is-what-it-holds, heldProductIDs narrowed to the ids asked). A
// plain function over inventory's own batches, called in-process by product_service's ProductTagsByIds through the
// composition root (cmd/app_development/product_stock_narrower.go): a warehouse reads the tags of a product it holds
// (products-have-their-own-tag-list, its 🔄 *who sees*), and only inventory knows which it holds (HARD RULE 3). A team
// that is not a warehouse holds nothing, so it gets nothing back. The ids go as ONE array parameter.
func HeldAmong(ctx context.Context, db *gorm.DB, warehouseID uint64, productIDs []uint64) ([]uint64, error) {
	if warehouseID == 0 || len(productIDs) == 0 {
		return nil, nil
	}

	parts := make([]string, 0, len(productIDs))
	for _, id := range productIDs {
		parts = append(parts, strconv.FormatUint(id, 10))
	}

	var ids []uint64

	err := db.
		WithContext(ctx).
		Model(&models.Batch{}).
		Where("warehouse_id = ? AND product_id = ANY(CAST(? AS bigint[]))", warehouseID, "{"+strings.Join(parts, ",")+"}").
		Distinct("product_id").
		Pluck("product_id", &ids).
		Error
	if err != nil {
		return nil, err
	}

	return ids, nil
}
