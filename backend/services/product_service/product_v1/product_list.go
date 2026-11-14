package product_v1

import (
	"context"
	"math"
	"strings"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_service_models"
)

// ProductList returns one half of the scoped team's catalogue, paginated — ACTIVE by default, or the
// ARCHIVED half when the filter asks for it (the two tabs on the product list). The filter's `q`
// filters by name or product code; `lock` by the lock's way or the minimums in force now, and `stock_age_min_days` by
// how long the oldest ready units have sat (lock-and-stock-age-filter-ahead-of-the-contract); `sort` orders the page
// (default newest-first); `data_request` selects which slices the response carries per product. See the guideline list
// shape in guidelines/service-guideline.md.
//
// The two filters that hang on STOCK ask inventory for ids through the StockNarrower seam BEFORE the count and the page
// (stock_narrower.go), so `total_items`, the sort and the paging describe the narrowed list.
func (s *Service) ProductList(
	ctx context.Context,
	req *connect.Request[productv1.ProductListRequest],
) (*connect.Response[productv1.ProductListResponse], error) {
	page := req.Msg.GetPage()

	// UNSPECIFIED is ACTIVE, not "both": every caller that predates the status filter sends nothing,
	// and an archived product must not reappear in a picker because a field was left unset.
	filter := req.Msg.GetFilter()
	archived := filter.GetStatus() == productv1.ProductStatus_PRODUCT_STATUS_ARCHIVED
	q := strings.TrimSpace(filter.GetQ())

	// The list's own narrowing — team, archive, search — built fresh on each call: the lock-now filter reads its
	// candidates through a copy of it.
	scope := func() *gorm.DB {
		query := s.db.
			WithContext(ctx).
			Model(&product_service_models.Product{}).
			Where("team_id = ? AND archived = ?", req.Msg.GetTeamId(), archived)

		if q != "" {
			pattern := "%" + escapeLike(q) + "%"
			query = query.Where("name ILIKE ? OR product_code ILIKE ?", pattern, pattern)
		}

		return query
	}

	query, err := s.narrowByLock(ctx, scope(), scope, filter.GetLock())
	if err != nil {
		return nil, err
	}

	query, err = s.narrowByStockAge(ctx, query, req.Msg.GetTeamId(), req.Msg.GetStockWarehouseId(), filter.GetStockAgeMinDays())
	if err != nil {
		return nil, err
	}

	var (
		products []product_service_models.Product
		total    int64
	)

	offset := int((page.GetPage() - 1) * page.GetLimit())
	order := productOrderClause(req.Msg.GetSort())

	if narrowedByStock(filter) {
		// An id list is bound: it travels once, the page and the count in one statement (stock_narrower.go).
		products, total, err = pageWithCount(query, order, offset, int(page.GetLimit()))
		if err != nil {
			return nil, dbError(err)
		}
	} else {
		err = query.Count(&total).Error
		if err != nil {
			return nil, dbError(err)
		}

		err = query.
			Order(order).
			Offset(offset).
			Limit(int(page.GetLimit())).
			Find(&products).
			Error
		if err != nil {
			return nil, dbError(err)
		}
	}

	items, ids := productListItems(products, req.Msg.GetDataRequest())

	return connect.NewResponse(&productv1.ProductListResponse{
		Items: items,
		Ids:   ids,
		PageInfo: &commonv1.PageInfo{
			CurrentPage: page.GetPage(),
			TotalPage:   totalPages(total, page.GetLimit()),
			TotalItems:  uint64(total),
		},
	}), nil
}

// escapeLike neutralises LIKE wildcards so a search for "%" doesn't match everything (the value is
// bound, so this is about search correctness, not injection).
func escapeLike(q string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(q)
}

func totalPages(total int64, limit uint32) uint32 {
	if limit == 0 {
		return 0
	}

	return uint32(math.Ceil(float64(total) / float64(limit)))
}
