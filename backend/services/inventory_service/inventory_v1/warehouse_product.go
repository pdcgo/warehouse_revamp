package inventory_v1

import (
	"log/slog"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// linkWarehouseProducts records that a warehouse HANDLES each of these products (#142), under the team that owns them
// (the-warehouse-link-names-its-owner-team) — a restock carries only its team's own products
// (a-restock-carries-only-the-teams-own-products), so the owner is the restock's team.
//
// Called from RestockRequestCreate and RestockRequestUpdate, inside their transaction: asking a warehouse to stock
// something is what makes it visible there, and a request whose products the crew cannot see is one nobody can act on.
// The list RPC that once read these rows back (WarehouseProductList) is deleted (warehouse-product-list-is-deleted);
// the rows stay, and ProductHistory still reads them.
//
// Idempotent by design. ON CONFLICT DO NOTHING because linking the same product twice is not a
// condition worth failing a restock request over — the second request for a product is the normal case,
// not an error, and the arrangement is already exactly what the caller wanted.
func linkWarehouseProducts(
	tx *gorm.DB,
	warehouseID uint64,
	ownerTeamID uint64,
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

	return linkWarehouseProductIDs(tx, warehouseID, ownerTeamID, ids)
}

// linkWarehouseProductIDs is linkWarehouseProducts by product id — a transfer's create links its products to the
// RECEIVING warehouse the same way (a-transfer-links-its-products-to-the-receiver), so B's crew can find what is coming,
// and an order's return links the products it comes back as to the return warehouse. ownerTeamID is the products' owner,
// which every caller already holds (the-warehouse-link-names-its-owner-team).
//
// A product has ONE owner, so a link already stored keeps its owner: the upsert never overwrites it. A stored link naming
// ANOTHER team than this writer's is a broken fact somewhere — reported (a warning naming both teams), kept as stored,
// and never a reason to fail the write that hit it (the link is not critical: it says the warehouse handles the product).
func linkWarehouseProductIDs(tx *gorm.DB, warehouseID, ownerTeamID uint64, productIDs []uint64) error {
	if len(productIDs) == 0 {
		return nil
	}

	seen := make(map[uint64]struct{}, len(productIDs))
	links := make([]inventory_service_models.WarehouseProduct, 0, len(productIDs))
	ids := make([]uint64, 0, len(productIDs))

	for _, productID := range productIDs {
		_, already := seen[productID]
		if already {
			continue
		}

		seen[productID] = struct{}{}
		ids = append(ids, productID)

		links = append(links, inventory_service_models.WarehouseProduct{
			WarehouseID: warehouseID,
			ProductID:   productID,
			OwnerTeamID: ownerTeamID,
		})
	}

	insert := tx.
		Clauses(clause.OnConflict{DoNothing: true}).
		Create(&links)
	if insert.Error != nil {
		return insert.Error
	}

	// Every link was new: each carries this writer's owner, and there is nothing stored to disagree with.
	if insert.RowsAffected == int64(len(links)) {
		return nil
	}

	return reportOtherOwners(tx, warehouseID, ownerTeamID, ids)
}

// reportOtherOwners warns about each of these links that is stored under another owner than ownerTeamID — a plain read
// (no lock) on the link's unique key, run only when the upsert met links already there. A row a concurrent writer
// inserted first is seen too: the upsert waited for that writer to finish, and under READ COMMITTED this statement reads
// what it committed.
func reportOtherOwners(tx *gorm.DB, warehouseID, ownerTeamID uint64, productIDs []uint64) error {
	var stored []inventory_service_models.WarehouseProduct

	err := tx.
		Where("warehouse_id = ? AND product_id IN ? AND owner_team_id <> ?", warehouseID, productIDs, ownerTeamID).
		Order("product_id").
		Find(&stored).
		Error
	if err != nil {
		return err
	}

	for _, link := range stored {
		slog.WarnContext(tx.Statement.Context, "warehouse product link: stored under another owner team — kept as stored",
			"warehouse_id", warehouseID,
			"product_id", link.ProductID,
			"stored_owner_team_id", link.OwnerTeamID,
			"writer_owner_team_id", ownerTeamID,
		)
	}

	return nil
}
