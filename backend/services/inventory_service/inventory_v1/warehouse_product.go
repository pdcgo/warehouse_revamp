package inventory_v1

import (
	"context"

	"connectrpc.com/connect"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// linkWarehouseProducts records that a warehouse HANDLES each of these products (#142).
//
// Called from RestockRequestCreate, inside its transaction: asking a warehouse to stock something is
// what makes it visible there, and a request whose products the crew cannot see is one nobody can act
// on.
//
// Idempotent by design. ON CONFLICT DO NOTHING because linking the same product twice is not a
// condition worth failing a restock request over — the second request for a product is the normal case,
// not an error, and the arrangement is already exactly what the caller wanted.
func linkWarehouseProducts(
	tx *gorm.DB,
	warehouseID uint64,
	items []inventory_service_models.RestockRequestItem,
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
	seen := make(map[uint64]struct{}, len(items))
	links := make([]inventory_service_models.WarehouseProduct, 0, len(items))

	for i := range items {
		productID := items[i].ProductID

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

// WarehouseProductList returns the products THIS WAREHOUSE HANDLES (#142).
//
// The warehouse's catalogue is not the whole catalogue. A warehouse team holds no products of its own —
// products belong to selling teams — so a team-scoped ProductList shows it nothing useful. What it
// should see is what somebody has asked it to hold, which is this list.
//
// It returns product IDS, not products. inventory_service does not own the catalogue and must not
// mirror it (HARD RULE 3): the names and SKUs come from product_service, which the caller resolves in
// one follow-up call to ProductByIds. That keeps a product's name in exactly one place, so renaming it
// does not leave a stale copy here.
func (s *Service) WarehouseProductList(
	ctx context.Context,
	req *connect.Request[inventoryv1.WarehouseProductListRequest],
) (*connect.Response[inventoryv1.WarehouseProductListResponse], error) {
	page := req.Msg.GetPage()

	query := s.db.
		WithContext(ctx).
		Model(&inventory_service_models.WarehouseProduct{}).
		Where("warehouse_id = ?", req.Msg.GetWarehouseId())

	var total int64

	err := query.Count(&total).Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	var rows []inventory_service_models.WarehouseProduct

	err = query.
		// Newest arrangement first — the product somebody just asked for is the one they are looking for.
		Order("id DESC").
		Offset(pageOffset(page)).
		Limit(int(page.GetLimit())).
		Find(&rows).
		Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	productIDs := make([]uint64, 0, len(rows))
	for i := range rows {
		productIDs = append(productIDs, rows[i].ProductID)
	}

	return connect.NewResponse(&inventoryv1.WarehouseProductListResponse{
		ProductIds: productIDs,
		PageInfo:   pageInfo(page, total),
	}), nil
}
