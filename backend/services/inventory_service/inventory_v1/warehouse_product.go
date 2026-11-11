package inventory_v1

import (
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// linkWarehouseProducts records that a warehouse HANDLES each of these products (#142).
//
// Called from RestockRequestCreate, inside its transaction: asking a warehouse to stock something is
// what makes it visible there, and a request whose products the crew cannot see is one nobody can act
// on. The list RPC that once read these rows back (WarehouseProductList) is deleted
// (warehouse-product-list-is-deleted); the rows stay, and ProductHistory still reads them.
//
// Idempotent by design. ON CONFLICT DO NOTHING because linking the same product twice is not a
// condition worth failing a restock request over — the second request for a product is the normal case,
// not an error, and the arrangement is already exactly what the caller wanted.
func linkWarehouseProducts(
	tx *gorm.DB,
	warehouseID uint64,
	items []inventory_service_models.RestockItem,
) error {
	if len(items) == 0 {
		return nil
	}

	// De-duplicated here as well as in the database, because one request may list the same product on
	// two lines.
	//
	// NOT load-bearing, and worth saying so: ON CONFLICT DO NOTHING already tolerates duplicate rows
	// inside a single INSERT — it is DO UPDATE that raises "cannot affect row a second time". Verified
	// by removing this block and watching the tests still pass. It stays because sending the database
	// rows we already know are redundant is wasteful, and because the day this becomes a DO UPDATE
	// (say, to stamp a "last requested" time) the absence of this would be a runtime error rather than
	// a review comment.
	ids := make([]uint64, 0, len(items))
	for i := range items {
		ids = append(ids, items[i].ProductID)
	}

	return linkWarehouseProductIDs(tx, warehouseID, ids)
}

// linkWarehouseProductIDs is linkWarehouseProducts by product id — a transfer's create links its products to the
// RECEIVING warehouse the same way (a-transfer-links-its-products-to-the-receiver), so B's crew can find what is coming.
func linkWarehouseProductIDs(tx *gorm.DB, warehouseID uint64, productIDs []uint64) error {
	if len(productIDs) == 0 {
		return nil
	}

	seen := make(map[uint64]struct{}, len(productIDs))
	links := make([]inventory_service_models.WarehouseProduct, 0, len(productIDs))

	for _, productID := range productIDs {
		_, already := seen[productID]
		if already {
			continue
		}

		seen[productID] = struct{}{}

		links = append(links, inventory_service_models.WarehouseProduct{
			WarehouseID: warehouseID,
			ProductID:   productID,
		})
	}

	return tx.
		Clauses(clause.OnConflict{DoNothing: true}).
		Create(&links).
		Error
}
