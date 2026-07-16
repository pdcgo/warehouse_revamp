package product_v1

import (
	"context"
	"strings"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	productv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/product/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/product_service/product_service_models"
)

// ProductDiscover lists active products across ALL teams (open cross-team discovery, #106), newest
// first, paginated, searchable by name/SKU. Unlike ProductList it does NOT filter by team — the
// request's team_id only authorizes the caller (use_scope). Each returned Product still carries its
// owning team_id.
func (s *Service) ProductDiscover(
	ctx context.Context,
	req *connect.Request[productv1.ProductDiscoverRequest],
) (*connect.Response[productv1.ProductDiscoverResponse], error) {
	page := req.Msg.GetPage()

	query := s.db.
		WithContext(ctx).
		Model(&product_service_models.Product{}).
		Where("deleted = ?", false)

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

	return connect.NewResponse(&productv1.ProductDiscoverResponse{
		Products: out,
		PageInfo: &commonv1.PageInfo{
			CurrentPage: page.GetPage(),
			TotalPage:   totalPages(total, page.GetLimit()),
			TotalItems:  uint64(total),
		},
	}), nil
}
