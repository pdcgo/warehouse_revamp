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
		// The history, oldest first — ordered by WHEN IT HAPPENED, with the id only as a tie-break for
		// two events in the same instant. Not by id alone: the 00011 backfill inserts every order's
		// 'placed' row before any later one, so insert order and event order genuinely differ there.
		// This matches idx_order_events_order, so it is an index scan rather than a sort.
		Preload("Events", func(db *gorm.DB) *gorm.DB {
			return db.Order("at ASC, id ASC")
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
