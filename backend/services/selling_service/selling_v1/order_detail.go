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
// NotFound, never PermissionDenied, so a caller cannot probe for which ids exist. The root team opens
// any order (readsEveryTeam), as its list shows every team's.
func (s *Service) OrderDetail(
	ctx context.Context,
	req *connect.Request[sellingv1.OrderDetailRequest],
) (*connect.Response[sellingv1.OrderDetailResponse], error) {
	var order selling_service_models.Order

	query := s.db.
		WithContext(ctx).
		Preload("Items", func(db *gorm.DB) *gorm.DB {
			return db.Order("id ASC")
		}).
		// The timeline, oldest first, the id breaking a tie between two rows of one instant. It matches
		// order_timeline_logs_order_idx, so it is an index scan rather than a sort.
		Preload("TimelineLogs", func(db *gorm.DB) *gorm.DB {
			return db.Order("created_at ASC, id ASC")
		}).
		Where("id = ?", req.Msg.GetOrderId())

	if !readsEveryTeam(req.Msg.GetTeamId()) {
		query = query.Where("(team_id = ? OR warehouse_id = ?)", req.Msg.GetTeamId(), req.Msg.GetTeamId())
	}

	err := query.
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
