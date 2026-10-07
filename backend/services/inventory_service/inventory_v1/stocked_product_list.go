package inventory_v1

import (
	"context"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	inventoryv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/inventory/v1"
)

// StockedProductList pages over the products a warehouse actually holds — the list behind the order
// form's product picker.
//
// The GROUPING is the whole design. `stock_levels` has a row per (warehouse, product, place), so a
// product on three shelves is three rows; a caller paging over those rows would meet the same product
// three times and the pager would count it three times. Grouping to one row per product makes a page
// of ten mean ten products.
//
// `HAVING SUM(on_hand) > 0` rather than `WHERE on_hand > 0`. With the CHECK constraint on `on_hand`
// forbidding negatives the two select the same products today, so this is not a correctness fix — it
// is written on the SUM because the sum is the quantity that decides the question. A picked-out
// product keeps its rows at 0, and "can this warehouse sell it" is a fact about the total on hand,
// not about whether some individual shelf happens to be non-empty. The per-row form would start
// lying the day a place is allowed to go negative.
func (s *Service) StockedProductList(
	ctx context.Context,
	req *connect.Request[inventoryv1.StockedProductListRequest],
) (*connect.Response[inventoryv1.StockedProductListResponse], error) {
	page := req.Msg.GetPage()

	grouped := func() *gorm.DB {
		q := s.db.
			WithContext(ctx).
			Table("stock_levels").
			Where("warehouse_id = ?", req.Msg.GetFilter().GetWarehouseId()).
			Group("product_id").
			Having("SUM(on_hand) > 0")

		// The caller's own narrowing — how a search term survives a list this service owns: the term
		// was resolved against the catalogue, which this service cannot read, and arrives as ids.
		if ids := req.Msg.GetFilter().GetProductIds(); len(ids) > 0 {
			q = q.Where("product_id IN ?", ids)
		}

		return q
	}

	// COUNT over the grouped set, not over the rows. `Count` on a grouped query returns one count PER
	// GROUP, so it has to be wrapped — otherwise the pager reads the first group's row count as the
	// total and offers one page of a hundred-product warehouse.
	var total int64

	err := s.db.
		WithContext(ctx).
		Table("(?) AS grouped", grouped().Select("product_id")).
		Count(&total).
		Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	type scan struct {
		ProductID uint64
		Available int64
	}

	var rows []scan

	offset := int((page.GetPage() - 1) * page.GetLimit())

	// Ordered by product id: a stable order is what makes paging repeatable, and this list has no
	// better key to offer — the names it would sort by live in the catalogue, not here.
	err = grouped().
		Select("product_id, COALESCE(SUM(on_hand), 0) AS available").
		Order("product_id").
		Offset(offset).
		Limit(int(page.GetLimit())).
		Scan(&rows).
		Error
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	items := make([]*inventoryv1.StockedProductListItem, 0, len(rows))
	ids := make([]uint64, 0, len(rows))

	for _, row := range rows {
		items = append(items, &inventoryv1.StockedProductListItem{
			ProductId: row.ProductID,
			Available: row.Available,
		})
		ids = append(ids, row.ProductID)
	}

	return connect.NewResponse(&inventoryv1.StockedProductListResponse{
		Items: items,
		Ids:   ids,
		PageInfo: &commonv1.PageInfo{
			CurrentPage: page.GetPage(),
			TotalPage:   stockedTotalPages(total, page.GetLimit()),
			TotalItems:  uint64(total),
		},
	}), nil
}

func stockedTotalPages(total int64, limit uint32) uint32 {
	if limit == 0 || total <= 0 {
		return 0
	}

	pages := uint32(total) / limit
	if uint32(total)%limit != 0 {
		pages++
	}

	return pages
}
