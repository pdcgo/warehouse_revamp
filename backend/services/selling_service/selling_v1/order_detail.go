package selling_v1

import (
	"context"
	"errors"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// OrderDetail returns one order with its ordered line items, to EITHER END of it (#151): the team that
// placed it, or the warehouse shipping it. The warehouse needs it most — the pick list IS the order's
// lines, and nothing else returns them.
//
// The scope check is the match itself: an order belonging to neither of the caller's ends reads as
// NotFound, never PermissionDenied, so a caller cannot probe for which ids exist.
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
		Where("id = ? AND (team_id = ? OR warehouse_id = ?)",
			req.Msg.GetOrderId(), req.Msg.GetTeamId(), req.Msg.GetTeamId()).
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
