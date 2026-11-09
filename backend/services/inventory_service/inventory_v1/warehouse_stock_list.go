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
)

var errWarehouseStockListShort = errors.New("type at least 2 characters of a product's name or code, or clear the search")

// WarehouseStockList is the Stock screen (the-stock-screen-lists-what-the-warehouse-has-held): every product with a
// batch in THIS warehouse — any team's, at 0 today or not, archived ones flagged — each with its owner team and its units
// on hand here, by name, searched by name or product code on the server, paged.
//
// The same set the picker searches (WarehouseProductSearch, a-warehouse-picks-only-what-it-has-held), and the same three
// steps, each over its own rows (HARD RULE 3):
//   - which products have been here — the batch ledger's distinct products, inventory's. A batch is never deleted, so a
//     product emptied to 0 stays listed, and can still be found and adjusted;
//   - which of them are on this page — product_service names, searches (or, with no term, lists) and orders them among
//     the held ids, in-process, so the page, its order and its total come from one statement there;
//   - how many of each are here — the placement ledger summed per product, StockList's formula (warehouseOnHand), read
//     for the page's products only. A held product with no shelf row left reads 0.
//
// A warehouse owns no products, so the old screen — the warehouse team's own catalogue — was always empty for a real
// warehouse. Nothing here is the warehouse's catalogue, and no product name is mirrored into inventory.
func (s *Service) WarehouseStockList(
	ctx context.Context,
	req *connect.Request[inventoryv1.WarehouseStockListRequest],
) (*connect.Response[inventoryv1.WarehouseStockListResponse], error) {
	msg := req.Msg
	warehouseID := msg.GetWarehouseId()
	page := msg.GetPage()
	q := strings.TrimSpace(msg.GetFilter().GetQ())

	// No term lists everything held here; a term is the picker's, at least 2 characters — one letter matches most of a
	// warehouse, and the screen sends none until a second is typed.
	if q != "" && utf8.RuneCountInString(q) < warehouseProductSearchMinQ {
		return nil, connect.NewError(connect.CodeInvalidArgument, errWarehouseStockListShort)
	}

	db := s.db.WithContext(ctx)

	held, err := heldProductIDs(db, warehouseID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Nothing has ever been here: an empty list, and no question for product_service.
	if len(held) == 0 {
		items, ids := warehouseStockListItems(warehouseID, nil, nil, msg.GetDataRequest())

		return connect.NewResponse(&inventoryv1.WarehouseStockListResponse{
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
		return nil, connect.NewError(connect.CodeUnavailable, fmt.Errorf("list the products held here: %w", err))
	}

	onHand, err := onHandOf(db, warehouseID, found.Products)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	items, ids := warehouseStockListItems(warehouseID, found.Products, onHand, msg.GetDataRequest())

	return connect.NewResponse(&inventoryv1.WarehouseStockListResponse{
		Items:    items,
		Ids:      ids,
		PageInfo: pageInfo(page, found.Total),
	}), nil
}

// onHandOf is the units on hand here of the page's products, by product id — warehouseOnHand narrowed to them. A product
// with no shelf row is absent, and reads 0.
func onHandOf(db *gorm.DB, warehouseID uint64, products []ProductMatch) (map[uint64]int64, error) {
	onHand := make(map[uint64]int64, len(products))
	if len(products) == 0 {
		return onHand, nil
	}

	ids := make([]uint64, 0, len(products))
	for _, p := range products {
		ids = append(ids, p.ID)
	}

	var levels []stockLevelRow

	err := warehouseOnHand(db, warehouseID).
		Where("product_id IN ?", ids).
		Find(&levels).
		Error
	if err != nil {
		return nil, err
	}

	for _, level := range levels {
		onHand[level.ProductID] = level.OnHand
	}

	return onHand, nil
}

// warehouseStockListItems builds the requested slices — a row of the screen, PRODUCT and STOCK, by default — and the ids
// in the list's order.
func warehouseStockListItems(
	warehouseID uint64,
	products []ProductMatch,
	onHand map[uint64]int64,
	types []inventoryv1.WarehouseStockListDataType,
) ([]*inventoryv1.WarehouseStockListResponseItem, []uint64) {
	if len(types) == 0 {
		types = []inventoryv1.WarehouseStockListDataType{
			inventoryv1.WarehouseStockListDataType_WAREHOUSE_STOCK_LIST_DATA_TYPE_PRODUCT,
			inventoryv1.WarehouseStockListDataType_WAREHOUSE_STOCK_LIST_DATA_TYPE_STOCK,
		}
	}

	ids := make([]uint64, 0, len(products))
	for _, p := range products {
		ids = append(ids, p.ID)
	}

	items := make([]*inventoryv1.WarehouseStockListResponseItem, 0, len(types))

	for _, t := range types {
		switch t {
		case inventoryv1.WarehouseStockListDataType_WAREHOUSE_STOCK_LIST_DATA_TYPE_GENERAL:
			m := make(map[uint64]*commonv1.GeneralItem, len(products))
			for _, p := range products {
				m[p.ID] = &commonv1.GeneralItem{Id: p.ID, Name: p.Name}
			}

			items = append(items, &inventoryv1.WarehouseStockListResponseItem{
				D: &inventoryv1.WarehouseStockListResponseItem_General{General: &commonv1.GeneralMapItem{MapData: m}},
			})
		case inventoryv1.WarehouseStockListDataType_WAREHOUSE_STOCK_LIST_DATA_TYPE_PRODUCT:
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

			items = append(items, &inventoryv1.WarehouseStockListResponseItem{
				D: &inventoryv1.WarehouseStockListResponseItem_Product{
					Product: &inventoryv1.WarehouseProductSearchMapItem{MapData: m},
				},
			})
		case inventoryv1.WarehouseStockListDataType_WAREHOUSE_STOCK_LIST_DATA_TYPE_STOCK:
			m := make(map[uint64]*inventoryv1.StockLevel, len(products))
			for _, p := range products {
				m[p.ID] = stockLevelRow{WarehouseID: warehouseID, ProductID: p.ID, OnHand: onHand[p.ID]}.proto()
			}

			items = append(items, &inventoryv1.WarehouseStockListResponseItem{
				D: &inventoryv1.WarehouseStockListResponseItem_Stock{Stock: &inventoryv1.StockLevelMapItem{MapData: m}},
			})
		}
	}

	return items, ids
}
