package inventory_v1

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"unicode/utf8"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
	models "github.com/pdcgo/warehouse_revamp/backend/services/inventory_service/inventory_service_models"
)

// warehouseProductSearchMinQ is the shortest term searched, after trimming — the proto's min_len, held again here
// because the proto counts the spaces a person typed around it.
const warehouseProductSearchMinQ = 2

var errWarehouseProductSearchShort = errors.New("type at least 2 characters of a product's name or code")

// WarehouseProductSearch is the warehouse's product picker — Report Found, a count's product plan, a count's found
// (a-warehouse-picks-only-what-it-has-held): the products with a batch in THIS warehouse, any team's, at 0 today or
// not, searched by name or product code, by name.
//
// Two halves, each over its own rows (HARD RULE 3):
//   - which products have been here — the batch ledger, inventory's. A batch is never deleted, so an emptied one still
//     says the product was held; a product only asked for (a restock's `warehouse_products` arrangement row) never was;
//   - which of those match the term — product_service's names and codes, asked through the ProductReader with the held
//     ids, so the search, the order and the count of matches are product_service's and the paging is exact.
//
// That is every product a found or a count can take (a-found-never-stocked-here-is-refused-at-the-report,
// a-unit-never-stocked-here-comes-in-by-restock) — a batch carries its product's owner (a-batch-carries-its-owner), so
// "held here" and "its team had a batch here" are one set. ProductDiscover is not widened: a warehouse never browses
// every team's catalogue.
func (s *Service) WarehouseProductSearch(
	ctx context.Context,
	req *connect.Request[inventoryv1.WarehouseProductSearchRequest],
) (*connect.Response[inventoryv1.WarehouseProductSearchResponse], error) {
	msg := req.Msg
	warehouseID := msg.GetWarehouseId()
	page := msg.GetPage()
	q := strings.TrimSpace(msg.GetFilter().GetQ())

	if utf8.RuneCountInString(q) < warehouseProductSearchMinQ {
		return nil, connect.NewError(connect.CodeInvalidArgument, errWarehouseProductSearchShort)
	}

	held, err := heldProductIDs(s.db.WithContext(ctx), warehouseID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Nothing has ever been here: nothing to search among, and no question for product_service.
	if len(held) == 0 {
		items, ids := warehouseProductSearchItems(nil, msg.GetDataRequest())

		return connect.NewResponse(&inventoryv1.WarehouseProductSearchResponse{
			Items:    items,
			Ids:      ids,
			PageInfo: pageInfo(page, 0),
		}), nil
	}

	found, err := s.products.Search(ctx, warehouseID, ProductSearch{
		ProductIDs: held,
		Q:          q,
		Offset:     pageOffset(page),
		Limit:      int(page.GetLimit()),
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeUnavailable, fmt.Errorf("search the products held here: %w", err))
	}

	items, ids := warehouseProductSearchItems(found.Products, msg.GetDataRequest())

	return connect.NewResponse(&inventoryv1.WarehouseProductSearchResponse{
		Items:    items,
		Ids:      ids,
		PageInfo: pageInfo(page, found.Total),
	}), nil
}

// heldProductIDs is every product with a batch in this warehouse — any team's, emptied batches included. Read off the
// batch ledger's (warehouse, team, product) index, never the rows themselves.
func heldProductIDs(db *gorm.DB, warehouseID uint64) ([]uint64, error) {
	var ids []uint64

	err := db.
		Model(&models.Batch{}).
		Where("warehouse_id = ?", warehouseID).
		Distinct("product_id").
		Pluck("product_id", &ids).
		Error

	return ids, err
}

// warehouseProductSearchItems builds the requested slices — the PRODUCT row by default — and the ids in the search's
// order.
func warehouseProductSearchItems(
	products []ProductMatch,
	types []inventoryv1.WarehouseProductSearchDataType,
) ([]*inventoryv1.WarehouseProductSearchResponseItem, []uint64) {
	if len(types) == 0 {
		types = []inventoryv1.WarehouseProductSearchDataType{
			inventoryv1.WarehouseProductSearchDataType_WAREHOUSE_PRODUCT_SEARCH_DATA_TYPE_PRODUCT,
		}
	}

	ids := make([]uint64, 0, len(products))
	for _, p := range products {
		ids = append(ids, p.ID)
	}

	items := make([]*inventoryv1.WarehouseProductSearchResponseItem, 0, len(types))

	for _, t := range types {
		switch t {
		case inventoryv1.WarehouseProductSearchDataType_WAREHOUSE_PRODUCT_SEARCH_DATA_TYPE_GENERAL:
			m := make(map[uint64]*commonv1.GeneralItem, len(products))
			for _, p := range products {
				m[p.ID] = &commonv1.GeneralItem{Id: p.ID, Name: p.Name}
			}

			items = append(items, &inventoryv1.WarehouseProductSearchResponseItem{
				D: &inventoryv1.WarehouseProductSearchResponseItem_General{General: &commonv1.GeneralMapItem{MapData: m}},
			})
		case inventoryv1.WarehouseProductSearchDataType_WAREHOUSE_PRODUCT_SEARCH_DATA_TYPE_PRODUCT:
			m := make(map[uint64]*inventoryv1.WarehouseProductSearchItem, len(products))
			for _, p := range products {
				m[p.ID] = &inventoryv1.WarehouseProductSearchItem{
					Id:          p.ID,
					TeamId:      p.TeamID,
					ProductCode: p.ProductCode,
					Name:        p.Name,
					Archived:    p.Archived,
				}
			}

			items = append(items, &inventoryv1.WarehouseProductSearchResponseItem{
				D: &inventoryv1.WarehouseProductSearchResponseItem_Product{
					Product: &inventoryv1.WarehouseProductSearchMapItem{MapData: m},
				},
			})
		}
	}

	return items, ids
}
