package selling_v1

import (
	"context"

	"connectrpc.com/connect"

	commonv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/common/v1"
	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// ShopUserList returns the (opaque) user ids granted access to a shop, paginated. The shop must
// belong to the scoped team — otherwise NotFound. The caller resolves the ids to names (UserByIDs).
func (s *Service) ShopUserList(
	ctx context.Context,
	req *connect.Request[sellingv1.ShopUserListRequest],
) (*connect.Response[sellingv1.ShopUserListResponse], error) {
	teamID := req.Msg.GetTeamId()
	shopID := req.Msg.GetShopId()
	page := req.Msg.GetPage()

	// The team_id clause is the scope check — a shop in another team reads as NotFound.
	exists, err := shopExists(s.db.WithContext(ctx), teamID, shopID)
	if err != nil {
		return nil, dbError(err)
	}

	if !exists {
		return nil, notFound()
	}

	query := s.db.
		WithContext(ctx).
		Model(&selling_service_models.ShopUser{}).
		Where("shop_id = ?", shopID)

	var total int64

	err = query.Count(&total).Error
	if err != nil {
		return nil, dbError(err)
	}

	var rows []selling_service_models.ShopUser

	offset := int((page.GetPage() - 1) * page.GetLimit())

	err = query.
		Order("id DESC").
		Offset(offset).
		Limit(int(page.GetLimit())).
		Find(&rows).
		Error
	if err != nil {
		return nil, dbError(err)
	}

	userIDs := make([]uint64, 0, len(rows))
	for i := range rows {
		userIDs = append(userIDs, rows[i].UserID)
	}

	return connect.NewResponse(&sellingv1.ShopUserListResponse{
		UserIds: userIDs,
		PageInfo: &commonv1.PageInfo{
			CurrentPage: page.GetPage(),
			TotalPage:   totalPages(total, page.GetLimit()),
			TotalItems:  uint64(total),
		},
	}), nil
}
