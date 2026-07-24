package revenue_v1

import (
	"context"

	"connectrpc.com/connect"

	revenuev1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/revenue/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/revenue_service/revenue_service_models"
)

// RevenueRecord freezes what an order is expected to make, at the moment it is placed (#75).
//
// The margin is computed HERE and stored, rather than left to be derived on read: #76 will reconcile
// it against what the payout actually was, and a number you reconcile against has to be the one you
// actually promised — not one recomputed later from inputs that may since have been corrected.
//
// The figures are COPIED, not referenced. If the order is later edited, or #74's cost rule is replaced
// (it is explicitly replaceable), this row must still say what was expected AT THE TIME — which is the
// only thing it is for.
//
// Recording an order twice is refused. A duplicate would DOUBLE every total computed from this table,
// which is the kind of error that looks like good news.
func (s *Service) RevenueRecord(
	ctx context.Context,
	req *connect.Request[revenuev1.RevenueRecordRequest],
) (*connect.Response[revenuev1.RevenueRecordResponse], error) {
	row := revenue_service_models.OrderRevenue{
		TeamID:       req.Msg.GetTeamId(),
		OrderID:      req.Msg.GetOrderId(),
		Revenue:      req.Msg.GetRevenue(),
		COGS:         req.Msg.GetCogs(),
		ShippingCost: req.Msg.GetShippingCost(),
		// What the order was expected to leave us with.
		ExpectedMargin: req.Msg.GetRevenue() - req.Msg.GetCogs() - req.Msg.GetShippingCost(),
		// The caller knows whether the cost is real; this service cannot work it out, because 0 is a
		// legitimate cost as well as the "unknown" marker (#74).
		CostKnown: req.Msg.GetCostKnown(),
	}

	// The unique index on order_id is what enforces once-per-order — a check-then-insert would race.
	err := s.db.WithContext(ctx).Create(&row).Error
	if err != nil {
		return nil, revenueErr(err)
	}

	return connect.NewResponse(&revenuev1.RevenueRecordResponse{
		Revenue: orderRevenueToProto(&row),
	}), nil
}
