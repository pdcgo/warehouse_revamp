package selling_v1

import (
	"context"
	"errors"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// OrderDetail returns one order in the scoped team, with its ordered line items. The team_id clause
// is the scope check — another team's order reads as NotFound.
func (s *Service) OrderDetail(
	ctx context.Context,
	req *connect.Request[sellingv1.OrderDetailRequest],
) (*connect.Response[sellingv1.OrderDetailResponse], error) {
	var order selling_service_models.Order

	err := s.db.
		WithContext(ctx).
		Preload("Items", func(db *gorm.DB) *gorm.DB {
			return db.Order("id ASC")
		}).
		Where("id = ? AND team_id = ?", req.Msg.GetOrderId(), req.Msg.GetTeamId()).
		First(&order).
		Error
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, notFound()
		}

		return nil, dbError(err)
	}

	return connect.NewResponse(&sellingv1.OrderDetailResponse{Order: orderToProto(&order)}), nil
}
