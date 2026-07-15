package selling_v1

import (
	"context"
	"strings"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// ShopList returns the scoped team's active shops, newest first, paginated. `q` filters by name or
// shop code.
func (s *Service) ShopList(
	ctx context.Context,
	req *connect.Request[sellingv1.ShopListRequest],
) (*connect.Response[sellingv1.ShopListResponse], error) {
	page := req.Msg.GetPage()

	query := s.db.
		WithContext(ctx).
		Model(&selling_service_models.Shop{}).
		Where("team_id = ? AND deleted = ?", req.Msg.GetTeamId(), false)

	if q := strings.TrimSpace(req.Msg.GetQ()); q != "" {
		pattern := "%" + escapeLike(q) + "%"
		query = query.Where("name ILIKE ? OR shop_code ILIKE ?", pattern, pattern)
	}

	var total int64

	err := query.Count(&total).Error
	if err != nil {
		return nil, dbError(err)
	}

	var shops []selling_service_models.Shop

	offset := int((page.GetPage() - 1) * page.GetLimit())

	err = query.
		Order("id DESC").
		Offset(offset).
		Limit(int(page.GetLimit())).
		Find(&shops).
		Error
	if err != nil {
		return nil, dbError(err)
	}

	out := make([]*sellingv1.Shop, 0, len(shops))
	for i := range shops {
		out = append(out, toProto(&shops[i]))
	}

	return connect.NewResponse(&sellingv1.ShopListResponse{
		Shops: out,
		PageInfo: &commonv1.PageInfo{
			CurrentPage: page.GetPage(),
			TotalPage:   totalPages(total, page.GetLimit()),
			TotalItems:  uint64(total),
		},
	}), nil
}
