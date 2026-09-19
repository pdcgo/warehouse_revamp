package selling_v1

import (
	"context"
	"errors"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// ShopDetail returns one active shop in the scoped team. The team_id clause is the scope check —
// another team's shop reads as NotFound.
func (s *Service) ShopDetail(
	ctx context.Context,
	req *connect.Request[sellingv1.ShopDetailRequest],
) (*connect.Response[sellingv1.ShopDetailResponse], error) {
	var shop selling_service_models.Shop

	err := s.db.
		WithContext(ctx).
		Where("id = ? AND team_id = ? AND deleted = ?", req.Msg.GetShopId(), req.Msg.GetTeamId(), false).
		First(&shop).
		Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, notFound()
		}

		return nil, dbError(err)
	}

	return connect.NewResponse(&sellingv1.ShopDetailResponse{Shop: toProto(&shop)}), nil
}
