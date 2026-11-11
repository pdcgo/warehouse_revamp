package selling_v1

import (
	"context"
	"errors"
	"log/slog"

	"connectrpc.com/connect"
	"gorm.io/gorm"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// OrderDetail returns one order with its ordered line items, to EITHER END of it (#151): the team that
// placed it, or the warehouse shipping it — and to its team's configured return warehouse while it is a return
// (orderReaders), whose crew opens it to accept it. The warehouse needs it most — the pick list IS the order's
// lines, and nothing else returns them.
//
// It also says where a return of the order goes — the selling team's configured return warehouse, read now
// (only-the-return-warehouse-accepts-a-return) — and, for an order in `return`, the label each borrowed line's units are
// relabelled with at the accept (a-returned-borrowed-unit-is-relabelled-at-the-accept), so the accept page shows the code
// to print before the crew accepts.
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
		Preload("Address").
		Preload("TimelineLogs", func(db *gorm.DB) *gorm.DB {
			return db.Order("created_at ASC, id ASC")
		}).
		Where("id = ?", req.Msg.GetOrderId())

	if !readsEveryTeam(req.Msg.GetTeamId()) {
		// The two ends, and the configured return warehouse for a return only (orderReaders).
		query = query.Where(orderReaders, map[string]any{"team": req.Msg.GetTeamId()})
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

	order.ReturnWarehouseID, err = returnWarehouseOf(s.db.WithContext(ctx), order.TeamID)
	if err != nil {
		return nil, dbError(err)
	}

	res := &sellingv1.OrderDetailResponse{Order: orderToProto(&order)}

	if order.Status == orderStatusReturn {
		res.ReturnLabels = s.returnLabelsBeforeTheAccept(ctx, req.Msg.GetTeamId(), &order)
	}

	return connect.NewResponse(res), nil
}

// returnLabelsBeforeTheAccept is each mapped borrowed line's label at its whole quantity. A READ never fails on it: with
// no catalogue, or the catalogue down, it answers none and says so in the log — the accept itself still refuses an
// unmapped line, and answers the labels again.
func (s *Service) returnLabelsBeforeTheAccept(
	ctx context.Context,
	teamID uint64,
	order *selling_service_models.Order,
) []*sellingv1.OrderReturnLabel {
	if s.catalog == nil {
		return nil
	}

	relabels, _, err := s.borrowedLines(ctx, teamID, order)
	if err != nil {
		slog.WarnContext(ctx, "the return's labels could not be read — the accept page shows none", "order_id", order.ID,
			"error", err)

		return nil
	}

	whole := make([]countedLine, 0, len(order.Items))
	for _, item := range order.Items {
		whole = append(whole, countedLine{item: item})
	}

	return soundLabels(order.Items, whole, relabels)
}
