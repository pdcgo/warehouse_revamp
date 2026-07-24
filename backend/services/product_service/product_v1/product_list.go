package product_v1

import (
	"context"
	"math"
	"strings"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_service_models"
)

// ProductList returns the scoped team's active products, newest first, paginated. `q` filters by
// name or SKU.
func (s *Service) ProductList(
	ctx context.Context,
	req *connect.Request[productv1.ProductListRequest],
) (*connect.Response[productv1.ProductListResponse], error) {
	page := req.Msg.GetPage()

	query := s.db.
		WithContext(ctx).
		Model(&product_service_models.Product{}).
		Where("team_id = ? AND deleted = ?", req.Msg.GetTeamId(), false)

	if q := strings.TrimSpace(req.Msg.GetQ()); q != "" {
		pattern := "%" + escapeLike(q) + "%"
		query = query.Where("name ILIKE ? OR sku ILIKE ?", pattern, pattern)
	}

	var total int64

	err := query.Count(&total).Error
	if err != nil {
		return nil, dbError(err)
	}

	var products []product_service_models.Product

	offset := int((page.GetPage() - 1) * page.GetLimit())

	err = query.
		Order("id DESC").
		Offset(offset).
		Limit(int(page.GetLimit())).
		Find(&products).
		Error
	if err != nil {
		return nil, dbError(err)
	}

	out := make([]*productv1.Product, 0, len(products))
	for i := range products {
		out = append(out, toProto(&products[i]))
	}

	return connect.NewResponse(&productv1.ProductListResponse{
		Products: out,
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
