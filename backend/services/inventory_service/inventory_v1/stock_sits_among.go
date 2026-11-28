package inventory_v1

import (
	"context"
	"strconv"
	"strings"

	"gorm.io/gorm"

	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// ShelvedIn is one product and one warehouse holding units of it on a shelf NOW.
type ShelvedIn struct {
	ProductID   uint64
	WarehouseID uint64
}

// StockSitsAmong returns, of `productIDs`, each product with every warehouse holding units of it on a shelf now — a
// `product_placements` row with stock (a product with nothing on a shelf anywhere is absent). The team code change asks it
// (backlog #149, a-team-code-change-recomposes-its-product-codes): a product whose sticker no longer matches its code is
// tagged `need_reprint_code` and waits for each of these warehouses to reprint its labels — one per shelf spot
// (the-team-code-and-product-tags-prototype-is-accepted: "a product with nothing on a shelf takes the new code, never
// tagged, not on any reprint").
//
// A plain function over inventory's own table, called in-process by product_service through the composition root
// (cmd/app_development/product_stock_narrower.go) on the CALLER'S transaction, so the change reads the shelves it commits
// against. It writes nothing. The ids go as ONE array parameter; the answer is sorted by product, then warehouse.
func StockSitsAmong(ctx context.Context, tx *gorm.DB, productIDs []uint64) ([]ShelvedIn, error) {
	if len(productIDs) == 0 {
		return nil, nil
	}

	parts := make([]string, 0, len(productIDs))
	for _, id := range productIDs {
		parts = append(parts, strconv.FormatUint(id, 10))
	}

	var rows []ShelvedIn

	err := tx.
		WithContext(ctx).
		Model(&models.ProductPlacement{}).
		Select("DISTINCT product_id, warehouse_id").
		Where("product_id = ANY(CAST(? AS bigint[])) AND stock_count > 0", "{"+strings.Join(parts, ",")+"}").
		Order("product_id, warehouse_id").
		Scan(&rows).
		Error
	if err != nil {
		return nil, err
	}

	return rows, nil
}
