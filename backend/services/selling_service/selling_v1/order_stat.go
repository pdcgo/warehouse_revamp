package selling_v1

import (
	"context"
	"time"

	"connectrpc.com/connect"

	sellingv1 "github.com/pdcgo/warehouse_revamp/backend/gen/warehouse/selling/v1"
	"github.com/pdcgo/warehouse_revamp/backend/services/selling_service/selling_service_models"
)

// The rolling window the preview's money figures use. Thirty days, the same span
// OrderProductActivityByIds calls "lately" — two windows on one screen would be read as one.
const orderStatWindow = 30 * 24 * time.Hour

// OrderStat is the header above the order list: a live census by status, and the money over the last
// thirty days.
//
// ONE query, not two. The 30-day figures are a SUBSET of the rows the census already reads, so they
// ride along as FILTER aggregates rather than costing a second scan of the same table — the same
// shape OrderProductActivityByIds uses for its own window.
func (s *Service) OrderStat(
	ctx context.Context,
	req *connect.Request[sellingv1.OrderStatRequest],
) (*connect.Response[sellingv1.OrderStatResponse], error) {
	type scan struct {
		Status   string
		Count    int64
		Value    int64
		Count30D int64
		Value30D int64
	}

	var rows []scan

	since := time.Now().Add(-orderStatWindow)

	// The SAME builder the list uses, given the stat's own filter — see scopedOrders. The search, the
	// shop and the date window narrow both; only `status` is the list's alone, because this groups by it.
	query := scopedOrders(
		s.db.WithContext(ctx).Model(&selling_service_models.Order{}),
		req.Msg.GetTeamId(),
		req.Msg.GetFilter(),
	)

	err := query.
		Select(`status,
		        COUNT(*) AS count,
		        COALESCE(SUM(total), 0) AS value,
		        COUNT(*) FILTER (WHERE created_at >= ?) AS count30_d,
		        COALESCE(SUM(total) FILTER (WHERE created_at >= ?), 0) AS value30_d`,
			since, since).
		Group("status").
		Scan(&rows).
		Error
	if err != nil {
		return nil, dbError(err)
	}

	byStatus := make([]*sellingv1.OrderStatusCount, 0, len(rows))
	preview := &sellingv1.OrderStatPreview{}

	for _, row := range rows {
		status := orderStatusFromText(row.Status)

		// A status this service does not recognise is dropped rather than reported as UNSPECIFIED.
		// UNSPECIFIED means "no filter" everywhere else in this contract, so a bucket carrying that
		// value would read to a client as "all orders" — a row that lies rather than one that is
		// merely unhelpful. Nothing writes such a status today; this is what keeps that true.
		if status == sellingv1.OrderStatus_ORDER_STATUS_UNSPECIFIED {
			continue
		}

		byStatus = append(byStatus, &sellingv1.OrderStatusCount{
			Status: status,
			Count:  row.Count,
			Value:  row.Value,
		})

		// CANCELLED is counted in the census but never in the money: it is a real thing sitting in a
		// real state, and it is not revenue. Excluding it HERE — one place, over grouped rows — is why
		// the rule cannot end up applied to the count and forgotten on the sum.
		if row.Status == orderStatusCancelled {
			continue
		}

		preview.Orders_30D += row.Count30D
		preview.Revenue_30D += row.Value30D
	}

	return connect.NewResponse(&sellingv1.OrderStatResponse{
		Preview:  preview,
		ByStatus: byStatus,
	}), nil
}
